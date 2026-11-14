import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $layoutTree, noteActiveTreeGroup, noteHoveredTreeGroup } from '@/components/pane-shell/tree/store'
import { $rightRailActiveTabId, selectRightRailTab } from '@/store/layout'
import { $browserPages, $previewTabs, markBrowserTabPopped, setPreviewScope } from '@/store/preview'

import { runPreviewAgentAction } from './preview-agent'
import { resumePreview, takeOverPreview } from './preview-agent-control'
import { rememberPreviewObservation } from './preview-agent-observation'
import { previewScriptRunnerFor, registerPreviewScriptRunner } from './preview-script-runner'

const target = (id: string, sessionId = 'session-a', pinned = false) => ({
  id: `url:${id}` as const,
  sessionId,
  pinned,
  target: { kind: 'url' as const, label: id, source: `https://${id}.example`, url: `https://${id}.example` }
})

beforeEach(() => {
  setPreviewScope('default')
  $layoutTree.set(null)
  noteActiveTreeGroup(null)
  noteHoveredTreeGroup(null)
  $previewTabs.set([
    target('first'),
    target('second'),
    target('foreign', 'session-b'),
    target('pin', 'session-b', true)
  ])
  selectRightRailTab('url:first')
  $browserPages.set({ 'url:second': { title: 'Second live page', url: 'https://second.example/current' } })
})

afterEach(() => {
  resumePreview('url:second')
  markBrowserTabPopped('url:second', false)
  $previewTabs.set([])
  $browserPages.set({})
  vi.restoreAllMocks()
})

it('lists only this session’s Browser tabs and profile pins without requiring a ready page', async () => {
  const result = await runPreviewAgentAction({ kind: 'tabs' }, undefined, 'session-a')
  expect(result.success).toBe(true)
  expect(result.tabs?.map(tab => tab.tab_id)).toEqual(['url:first', 'url:second', 'url:pin'])
  expect(result.tabs?.find(tab => tab.tab_id === 'url:second')).toMatchObject({
    title: 'Second live page',
    url: 'https://second.example/current',
    selected: false
  })
  expect(result.tabs?.[0].selected).toBe(true)
})

it('selects an owned existing tab without changing its page or creating a new tab', async () => {
  const before = $previewTabs.get()
  const result = await runPreviewAgentAction({ kind: 'select_tab', tabId: 'url:second' }, undefined, 'session-a')
  expect(result).toMatchObject({ success: true, tab_id: 'url:second', url: 'https://second.example/current' })
  expect($rightRailActiveTabId.get()).toBe('url:second')
  expect($previewTabs.get()).toBe(before)
  expect(result.note).toMatch(/observ/i)
})

it('refuses a foreign tab or a user-controlled target and leaves the selection unchanged', async () => {
  const foreign = await runPreviewAgentAction({ kind: 'select_tab', tabId: 'url:foreign' }, undefined, 'session-a')
  expect(foreign.success).toBe(false)
  takeOverPreview('url:second')
  const human = await runPreviewAgentAction({ kind: 'select_tab', tabId: 'url:second' }, undefined, 'session-a')
  expect(human.success).toBe(false)
  expect(human.error).toMatch(/user/i)
  expect($rightRailActiveTabId.get()).toBe('url:first')
})

it('does not expose another profile’s Browser tabs', async () => {
  setPreviewScope('other-profile')

  const result = await runPreviewAgentAction({ kind: 'tabs' }, undefined, {
    profile: 'other-profile',
    runtimeId: null,
    sessionId: 'session-a'
  })

  expect(result).toMatchObject({ success: true, tabs: [] })
})

it('retires the old observation after selecting away and returning to the same live page', async () => {
  const stop = registerPreviewScriptRunner('url:first', async () => ({
    url: 'https://first.example',
    title: 'First',
    width: 800,
    height: 600,
    scrollX: 0,
    scrollY: 0,
    revision: 0
  }))

  const seen = rememberPreviewObservation(
    previewScriptRunnerFor('url:first')!,
    {
      url: 'https://first.example',
      title: 'First',
      width: 800,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      revision: 0
    },
    'session-a',
    { width: 800, height: 600 }
  )

  try {
    expect(
      (await runPreviewAgentAction({ kind: 'select_tab', tabId: 'url:second' }, undefined, 'session-a')).success
    ).toBe(true)
    expect(
      (await runPreviewAgentAction({ kind: 'select_tab', tabId: 'url:first' }, undefined, 'session-a')).success
    ).toBe(true)

    const stale = await runPreviewAgentAction(
      { kind: 'click', tabId: 'url:first', coordinate: [10, 10], observationId: seen.id },
      undefined,
      'session-a'
    )

    expect(stale.success).toBe(false)
    expect(stale.error).toMatch(/stale/i)
  } finally {
    stop()
  }
})

it('focuses an existing popped-out tab and preserves the native tab state', async () => {
  const previous = window.hermesDesktop
  const focus = vi.fn(async () => ({ ok: true }))
  window.hermesDesktop = { ...previous, openBrowserWindow: focus }
  markBrowserTabPopped('url:second', true)
  const before = $previewTabs.get()

  try {
    const selected = await runPreviewAgentAction({ kind: 'select_tab', tabId: 'url:second' }, undefined, 'session-a')
    expect(selected.success).toBe(true)
    expect(focus).toHaveBeenCalledExactlyOnceWith('url:second')
    expect($previewTabs.get()).toBe(before)
    expect(selected.tabs?.find(tab => tab.tab_id === 'url:second')).toMatchObject({ selected: true, popped_out: true })
  } finally {
    window.hermesDesktop = previous
  }
})
