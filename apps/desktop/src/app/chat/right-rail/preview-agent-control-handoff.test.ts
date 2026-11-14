import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const previousDesktop = window.hermesDesktop
const relayListeners = new Set<(payload: unknown) => void>()

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  relayListeners.clear()
  window.hermesDesktop = {
    ...previousDesktop,
    windowRelay: {
      send: payload => relayListeners.forEach(listener => listener(payload)),
      onMessage: listener => {
        relayListeners.add(listener)

        return () => void relayListeners.delete(listener)
      }
    }
  }
})

afterEach(() => {
  relayListeners.clear()
  window.localStorage.clear()
  window.hermesDesktop = previousDesktop
})

describe('browser control across renderer handoffs', () => {
  it('keeps takeover when popped out and redocked until the user explicitly returns control', async () => {
    const tabId = 'url:browser-handoff'
    const main = await import('./preview-agent-control')
    main.takeOverPreview(tabId)

    // A pop-out is a fresh renderer with fresh module state and the same tab identity.
    vi.resetModules()
    const popout = await import('./preview-agent-control')
    expect(popout.$previewAgentActivity.get()[tabId]).toBe('human')
    expect(() => popout.beginPreviewOperation(tabId, 'acting')).toThrow(/user/i)

    popout.resumePreview(tabId)
    expect(main.$previewAgentActivity.get()[tabId] ?? 'idle').toBe('idle')
    const operation = main.beginPreviewOperation(tabId, 'acting')
    popout.takeOverPreview(tabId)
    expect(operation.signal.aborted).toBe(true)
    operation.release()
    expect(main.$previewAgentActivity.get()[tabId]).toBe('human')
    expect(() => main.beginPreviewOperation(tabId, 'acting')).toThrow(/user/i)

    // Redocking into another fresh renderer also preserves human mode.
    vi.resetModules()
    const redocked = await import('./preview-agent-control')
    expect(redocked.$previewAgentActivity.get()[tabId]).toBe('human')
    redocked.resumePreview(tabId)
    expect(popout.$previewAgentActivity.get()[tabId] ?? 'idle').toBe('idle')
    expect(main.$previewAgentActivity.get()[tabId] ?? 'idle').toBe('idle')
    redocked.beginPreviewOperation(tabId, 'observing').release()
  })

  it('preserves control when a profile hides the tab and cleans up only when the tab closes', async () => {
    const preview = await import('@/store/preview')
    preview.newBrowserTab()
    const tabId = preview.$previewTabs.get()[0]!.id
    const main = await import('./preview-agent-control')
    main.takeOverPreview(tabId)
    vi.resetModules()
    const popout = await import('./preview-agent-control')

    preview.setPreviewScope('another-profile')
    expect(main.$previewAgentActivity.get()[tabId]).toBe('human')
    expect(popout.$previewAgentActivity.get()[tabId]).toBe('human')
    preview.setPreviewScope('default')
    preview.closeRightRailTab(tabId)
    expect(main.$previewAgentActivity.get()[tabId] ?? 'idle').toBe('idle')
    expect(popout.$previewAgentActivity.get()[tabId] ?? 'idle').toBe('idle')

    vi.resetModules()
    const reopened = await import('./preview-agent-control')
    expect(reopened.$previewAgentActivity.get()[tabId] ?? 'idle').toBe('idle')
  })
})
