import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { CanonicalDesktopProtocol } from '@/api/canonical-protocol'
import type { HermesGateway } from '@/hermes'
import { I18nProvider } from '@/i18n/context'
import { en } from '@/i18n/en'
import { $taskPauses, claimTaskContinuation } from '@/store/task-pause'

import { TASK_CONTINUATION_TEXT, TaskPauseNotice } from './task-pause-notice'

vi.mock('@/app/session/hooks/use-prompt-actions/submission-destination', () => ({
  captureSubmissionDestination: (_sessionId: string, requestGateway: unknown) => ({ requestGateway, scopeKey: 'owner' })
}))

beforeEach(() => $taskPauses.set({}))
afterEach(cleanup)

test('Continue waits for Stop settlement, submits once with exact hidden token, and survives a temporary navigation', async () => {
  const protocol = new CanonicalDesktopProtocol()
  const params = { session_id: 'session', profile: 'work' }

  const gateway = {
    request: vi.fn(),
    taskPauseKey: (sid: string, profile: string) => protocol.taskPauseKey(sid, profile)
  } as unknown as HermesGateway

  let finish: ((accepted: boolean) => void) | undefined

  const onSubmit = vi.fn(
    () =>
      new Promise<boolean>(resolve => {
        finish = resolve
      })
  )

  const view = (sessionId = 'session') => (
    <I18nProvider configClient={{ getConfig: async () => ({}), saveConfig: async () => ({ ok: true }) }}>
      <TaskPauseNotice disabled={false} gateway={gateway} onSubmit={onSubmit} profile="work" sessionId={sessionId} />
    </I18nProvider>
  )

  protocol.event({ type: 'message.start', ...params, execution_generation: 3, payload: {} })
  const interrupt = protocol.prepare('session.interrupt', params)
  let rendered: ReturnType<typeof render>
  await act(async () => {
    rendered = render(view())
  })
  expect((screen.getByRole('button', { name: en.common.continue }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(en.composer.taskPausing)).toBeTruthy()
  await act(async () => {
    protocol.result('session.interrupt', interrupt, { execution_generation: 3 })
    protocol.event({
      type: 'message.complete',
      ...params,
      execution_generation: 3,
      payload: { status: 'interrupted', admission_id: 'original' }
    })
    protocol.event({
      type: 'session.info',
      ...params,
      payload: { execution_generation: 3, revision: 9, running: false, pending: [] }
    })
  })
  rendered!.rerender(view('other-session'))
  expect(screen.queryByRole('button', { name: en.common.continue })).toBeNull()
  rendered!.rerender(view())
  const button = screen.getByRole('button', { name: en.common.continue })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit).toHaveBeenCalledWith(
    TASK_CONTINUATION_TEXT,
    expect.objectContaining({
      sessionId: 'session',
      submission_id: 'continue:original:3',
      attachments: [],
      displayKind: 'hidden',
      continuationOf: { admission_id: 'original', execution_generation: 3, revision: 9 }
    })
  )
  await act(async () => {
    finish!(true)
  })
  expect(screen.queryByRole('button', { name: en.common.continue })).toBeNull()
})

test.each(['accepted', 'refused', 'rejected'])(
  'a delayed %s Continue promise preserves a newer continuation claim',
  async outcome => {
    const protocol = new CanonicalDesktopProtocol()
    const params = { session_id: 'session', profile: 'work' }

    const gateway = {
      request: vi.fn(),
      taskPauseKey: (sid: string, profile: string) => protocol.taskPauseKey(sid, profile)
    } as unknown as HermesGateway

    let resolve: ((accepted: boolean) => void) | undefined
    let reject: ((reason: Error) => void) | undefined

    const onSubmit = vi.fn(
      () =>
        new Promise<boolean>((done, failed) => {
          resolve = done
          reject = failed
        })
    )

    const key = protocol.taskPauseKey('session', 'work')

    const pause = (generation: number, admissionId: string, revision: number) => {
      protocol.event({ type: 'message.start', ...params, execution_generation: generation, payload: {} })
      const interrupt = protocol.prepare('session.interrupt', params)
      protocol.result('session.interrupt', interrupt, { execution_generation: generation })
      protocol.event({
        type: 'message.complete',
        ...params,
        execution_generation: generation,
        payload: { status: 'interrupted', admission_id: admissionId }
      })
      protocol.event({
        type: 'session.info',
        ...params,
        payload: { execution_generation: generation, revision, running: false, pending: [] }
      })
    }

    pause(3, 'original', 9)
    await act(async () => {
      render(
        <I18nProvider configClient={{ getConfig: async () => ({}), saveConfig: async () => ({ ok: true }) }}>
          <TaskPauseNotice disabled={false} gateway={gateway} onSubmit={onSubmit} profile="work" sessionId="session" />
        </I18nProvider>
      )
    })
    fireEvent.click(screen.getByRole('button', { name: en.common.continue }))
    await act(async () => {
      pause(4, 'next', 10)
      claimTaskContinuation(key)
    })
    const nextPause = $taskPauses.get()[key]
    expect(nextPause).toMatchObject({ phase: 'continuing', admissionId: 'next', generation: 4 })
    await act(async () => {
      if (outcome === 'rejected') {
        reject!(new Error('old continuation failed'))
      } else {
        resolve!(outcome === 'accepted')
      }
    })
    expect($taskPauses.get()[key]).toBe(nextPause)
  }
)
