import { act, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { preparePlatformSessionRequest } from '@/api/platform-session-binding'
import { TRANSLATIONS } from '@/i18n'
import type { ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { errorCardActions } from '@/lib/error-surface'
import { errorCardText } from '@/lib/error-surface-copy'
import { $composerDraft } from '@/store/composer'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $modelPickerOpen } from '@/store/session'
import { dropSessionState, publishSessionState } from '@/store/session-states'

import { actRender, Harness, type HarnessHandle, RUNTIME_SESSION_ID } from './index-test-utils'
import { clearSingleFlightSessionResumeState } from './single-flight-resume'

vi.mock('@/hermes', () => ({
  getLatestSessionMessages: vi.fn(async () => ({ messages: [], session_id: 'session' })),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  getSession: vi.fn(),
  PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000,
  setApiRequestProfile: vi.fn(),
  transcribeAudio: vi.fn()
}))

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForSessionTurn: vi.fn(async () => () => undefined)
}))

afterEach(() => {
  cleanup()
  dropSessionState(RUNTIME_SESSION_ID)
  $composerDraft.set('')
  $modelPickerOpen.set(false)
  clearNotifications()
  clearSingleFlightSessionResumeState()
})

it('keeps an unavailable-model draft and offers model selection before delivering any request', async () => {
  clearSingleFlightSessionResumeState()
  window.localStorage.removeItem('hermes.desktop.preparedSubmissions.v1')
  window.localStorage.removeItem('hermes.desktop.composerQueue.v1')
  $composerDraft.set('Keep this unsent draft')
  publishSessionState(RUNTIME_SESSION_ID, { ...createClientSessionState(), provider: 'aino' })
  const wireRequest = vi.fn(async () => ({}) as never)

  const requestGateway = async <T,>(method: string, params?: Record<string, unknown>): Promise<T> => {
    await preparePlatformSessionRequest('default', method, params ?? {}, wireRequest)

    return wireRequest()
  }

  let handle: HarnessHandle | null = null
  await actRender(
    <Harness
      onReady={value => (handle = value)}
      refreshSessions={async () => undefined}
      requestGateway={requestGateway}
    />
  )

  expect(await handle!.submitText('Keep this unsent draft')).toBe(false)
  expect(wireRequest).not.toHaveBeenCalled()
  expect($composerDraft.get()).toBe('Keep this unsent draft')
  const error = (handle!.state().messages as ChatMessage[]).at(-1)
  const copy = errorCardText(TRANSLATIONS.zh.assistant.thread, error?.errorSurface)
  expect(copy.title).toContain('不可用')
  expect(copy.body).toContain('Aino')
  expect(copy.body).toContain('请选择其他模型')
  expect(copy.body).not.toContain('内部错误')
  expect(errorCardActions(error?.errorSurface)).toEqual({ primary: 'choose_model' })
  const recovery = $notifications.get().at(-1)?.action
  expect(recovery?.label).toBe('Choose model')
  act(() => recovery?.onClick())
  expect($modelPickerOpen.get()).toBe(true)
  expect(wireRequest).not.toHaveBeenCalled()
})
