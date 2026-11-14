import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { abortPreviewTyping } from '@/app/chat/right-rail/preview-typing-abort'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $previewTabs, setPreviewScope } from '@/store/preview'
import { dropSessionState, publishSessionState } from '@/store/session-states'

import { handleServerRequest, type ServerRequestContext } from './server-requests'

const run = vi.hoisted(() => vi.fn())
const hasLiveSurface = vi.hoisted(() => vi.fn(() => true))
const forward = vi.hoisted(() => vi.fn())

vi.mock('@/app/chat/right-rail/preview-agent', () => ({ runPreviewAgentAction: run }))
vi.mock('@/app/chat/right-rail/preview-popout-bridge', () => ({
  hasLivePreviewSurface: hasLiveSurface,
  requestPopoutPreviewAct: forward,
  requestPopoutPreviewRead: vi.fn(),
  requestPopoutPreviewVault: vi.fn()
}))

const deps = {
  activeSessionIdRef: { current: 'runtime-a' },
  sessionInterrupted: () => false,
  sessionStateByRuntimeIdRef: { current: new Map() },
  updateSessionState: (_sessionId, update) => update(createClientSessionState('stored-a')),
  upsertToolCall: () => undefined
} as ServerRequestContext['deps']

function request(params: Record<string, unknown>) {
  const respond = vi.fn()
  const decline = vi.fn()

  const handled = handleServerRequest(
    {
      decline,
      fail: vi.fn(),
      id: 'preview-agent-integration',
      method: 'preview.act',
      params: { ...params, session_id: 'runtime-a' },
      profile: 'default',
      respond
    },
    deps,
    'runtime-a'
  )

  expect(handled).toBe(true)
  expect(decline).not.toHaveBeenCalled()

  return respond
}

beforeEach(() => {
  run.mockReset().mockResolvedValue({ success: true, tab_id: 'tab-browser' })
  forward.mockReset().mockResolvedValue({ success: true, tab_id: 'tab-browser' })
  hasLiveSurface.mockReturnValue(false)
  publishSessionState('runtime-a', createClientSessionState('stored-a'))
  setPreviewScope('default')
  $previewTabs.set([
    {
      id: 'url:owned',
      pinned: false,
      sessionId: 'stored-a',
      target: { kind: 'url', label: 'Owned browser', source: 'https://example.test', url: 'https://example.test' }
    }
  ])
})

afterEach(() => {
  abortPreviewTyping('preview-agent-integration')
  dropSessionState('runtime-a')
  $previewTabs.set([])
})

describe('browser agent server transport', () => {
  it.each(['tabs', 'select_tab'])(
    'keeps %s discovery/selection in the owning chat window even without a ready guest',
    async action => {
      const respond = request({ action, tab_id: action === 'select_tab' ? 'url:owned' : undefined })
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce())
      expect(JSON.parse(respond.mock.calls[0][0].value)).not.toHaveProperty('error')
      expect(forward).not.toHaveBeenCalled()
      expect(JSON.parse(respond.mock.calls[0][0].value).success).toBe(true)
    }
  )

  it('preserves native feature identifiers, false dialog responses and local file paths', async () => {
    const respond = request({
      action: 'dialog_respond',
      tab_id: 'tab-browser',
      dialog_id: 'dialog-1',
      accept: false,
      prompt_text: 'Synthetic answer',
      paths: ['/tmp/fixture.txt'],
      download_id: 'download-1',
      download_path: '/tmp/export.csv',
      chooser_id: 'chooser-1'
    })

    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce())
    expect(JSON.parse(respond.mock.calls[0][0].value)).not.toHaveProperty('error')
    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        dialogId: 'dialog-1',
        accept: false,
        promptText: 'Synthetic answer',
        paths: ['/tmp/fixture.txt'],
        downloadId: 'download-1',
        downloadPath: '/tmp/export.csv',
        chooserId: 'chooser-1'
      }),
      expect.objectContaining({ sessionId: 'stored-a' }),
      expect.any(AbortSignal)
    )
  })

  it('delivers explicit page, observation and visual action parameters to the owning browser transport', async () => {
    const respond = request({
      action: 'drag',
      allow_shortcut: true,
      coordinate: [120, 180],
      full: true,
      observation_id: 'observation-7',
      sensitive: true,
      tab_id: 'tab-browser',
      to_coordinate: [300, 400]
    })

    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce())
    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        allowShortcut: true,
        coordinate: [120, 180],
        full: true,
        kind: 'drag',
        observationId: 'observation-7',
        sensitive: true,
        tabId: 'tab-browser',
        toCoordinate: [300, 400]
      }),
      { profile: 'default', runtimeId: 'runtime-a', sessionId: 'stored-a' },
      expect.any(AbortSignal)
    )
    expect(JSON.parse(respond.mock.calls[0][0].value)).toEqual({ success: true, tab_id: 'tab-browser' })
  })

  it('does not interpret string flags as permission or shortcut approval', async () => {
    const respond = request({ action: 'press', allow_shortcut: 'true', key: 'Enter', sensitive: 'true' })

    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce())
    expect(forward.mock.calls[0][0]).toMatchObject({ allowShortcut: false, sensitive: false })
  })

  it('returns a claimed pop-out failure without replaying the action locally', async () => {
    hasLiveSurface.mockReturnValue(false)
    forward.mockResolvedValue({ error: 'The browser action timed out and was cancelled.', success: false })
    const respond = request({ action: 'click', observation_id: 'observation-7', tab_id: 'tab-browser' })

    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce())
    expect(run).not.toHaveBeenCalled()
    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', observationId: 'observation-7', tabId: 'tab-browser' }),
      { profile: 'default', runtimeId: 'runtime-a', sessionId: 'stored-a' },
      expect.any(AbortSignal)
    )
    expect(JSON.parse(respond.mock.calls[0][0].value)).toMatchObject({
      success: false,
      error: expect.stringContaining('timed out')
    })
  })
})
