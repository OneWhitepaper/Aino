/** Creation warnings follow their draft owner and survive adoption into Aino's existing Bot flow. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createAgentHarness } from './create-agent-test-utils'
import { translateBots } from './i18n-test-helper'
import type { RosterRow } from './types'

const mocks = await vi.hoisted(async () => (await import('./create-agent-test-utils')).createMocks())
vi.mock('@hermes/plugin-sdk', async original =>
  (await import('./create-agent-test-utils')).sdkMock(await original(), mocks, () => translateBots)
)
vi.mock('./roster-actions', () => ({ openRosterBot: vi.fn(async () => true) }))
vi.mock('./profile-ops', () => ({ deleteBot: mocks.deleteBot, mergeServerMeta: vi.fn() }))
vi.mock('./data', async original => ({ ...(await original<object>()), saveBotMeta: mocks.saveBotMeta }))
const { createCalls, renderDialog } = createAgentHarness(mocks)
const warnings = ['Subscription logins stay with default.', 'A plugin could not be copied.']

const warningNotices = () =>
  mocks.notify.mock.calls.map(([notice]) => notice).filter(notice => notice.message === warnings.join('\n'))

const submit = () => fireEvent.click(screen.getByRole('button', { name: /^Create bot$/i }))

function creationReply(reply: object, readiness: object = { ok: true }) {
  const base = mocks.request.getMockImplementation()!
  mocks.request.mockImplementation(async (method: string, params?: unknown) =>
    method === 'profiles.create' ? reply : method === 'setup.runtime_check' ? readiness : base(method, params)
  )
}

describe('profile creation warnings', () => {
  it.each(['pending', 'ready'])('publishes a %s lazy draft warning once, when Create adopts it', async state => {
    const base = mocks.request.getMockImplementation()!
    let finish!: () => void
    mocks.request.mockImplementation((method: string, params?: unknown) =>
      method === 'profiles.create'
        ? new Promise(resolve => {
            finish = () => resolve({ warnings })
          })
        : base(method, params)
    )
    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() => expect(createCalls()).toHaveLength(1))
    expect(warningNotices()).toEqual([])

    if (state === 'ready') {
      await act(async () => finish())
      await waitFor(() => expect(mocks.skillsView.at(-1)).toMatchObject({ fixedProfile: 'inbox-triage' }))
    }

    submit()

    if (state === 'pending') {
      await act(async () => finish())
    }

    await waitFor(() =>
      expect(warningNotices()).toEqual([expect.objectContaining({ title: 'inbox-triage — local', persistent: true })])
    )
    expect(createCalls()).toHaveLength(1)
  })

  it('keeps adopted warnings after unmount while readiness is in flight', async () => {
    const base = mocks.request.getMockImplementation()!
    let finish!: () => void
    mocks.request.mockImplementation((method: string, params?: unknown) =>
      method === 'profiles.create'
        ? Promise.resolve({ warnings })
        : method === 'setup.runtime_check'
          ? new Promise(resolve => {
              finish = () => resolve({ ok: true })
            })
          : base(method, params)
    )
    const dialog = await renderDialog(true)
    submit()
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    dialog.unmount()
    await act(async () => finish())
    await waitFor(() => expect(warningNotices()).toHaveLength(1))
  })

  it('preserves warnings and model recovery through a resume clear, with its captured owner', async () => {
    mocks.activeConnection.value = 'gateway-a'
    creationReply({ warnings }, { ok: false, error: 'No credentials.' })
    const configure = vi.fn()
    const dialog = await renderDialog(true, configure)
    const { notify, $notifications } = await import('@/store/notifications')
    mocks.notify.mockImplementation(notify)
    submit()
    await waitFor(() => expect(warningNotices()).toHaveLength(1))
    const recovery = $notifications.get().find(notice => notice.action?.label === 'Configure model')!
    expect(recovery).toMatchObject({ kind: 'warning', persistent: true })
    dialog.unmount()
    const { clearResumeToasts } = await import('@/app/session/hooks/use-session-actions/resume-latches')
    await act(async () => clearResumeToasts(undefined))
    expect($notifications.get().filter(notice => notice.persistent)).toHaveLength(2)
    mocks.activeConnection.value = 'gateway-b'
    const { $lastRoster } = await import('./data')

    const live: RosterRow = {
      name: 'inbox-triage',
      connectionId: 'gateway-a',
      sourceScoped: true,
      route: { connectionId: 'gateway-a', profile: 'inbox-triage', targetProfile: 'inbox-triage', mode: 'remote' }
    }

    const previous = $lastRoster.get()
    $lastRoster.set([{ ...live, connectionId: 'gateway-b' }, live])

    try {
      await recovery.action!.onClick()
      expect(configure).toHaveBeenCalledWith(live)
    } finally {
      $lastRoster.set(previous)
    }
  })

  it('drops warnings when an unadopted create is canceled before it returns', async () => {
    const base = mocks.request.getMockImplementation()!
    let finish!: () => void
    mocks.request.mockImplementation((method: string, params?: unknown) =>
      method === 'profiles.create'
        ? new Promise(resolve => {
            finish = () => resolve({ warnings })
          })
        : base(method, params)
    )
    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() => expect(createCalls()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => finish())
    await waitFor(() => expect(mocks.deleteBot).toHaveBeenCalled())
    expect(warningNotices()).toEqual([])
  })

  it.each([{}, { warnings: [] }])('keeps warning-free creation quiet: %j', async reply => {
    creationReply(reply)
    await renderDialog(true)
    submit()
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })))
    expect(mocks.notify.mock.calls.filter(([notice]) => notice.kind === 'warning')).toEqual([])
  })
})
