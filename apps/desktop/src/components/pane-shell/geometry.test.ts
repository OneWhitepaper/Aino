import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubResizeObserver } from '@/test/jsdom'

import { publishWorkspaceGeometry } from './geometry'
import { group } from './tree/model'
import { $layoutTree } from './tree/store'

describe('publishWorkspaceGeometry', () => {
  let mutationCallback: MutationCallback | undefined
  const initialTree = $layoutTree.get()

  afterEach(() => {
    cleanup()
    $layoutTree.set(initialTree)
    document.body.replaceChildren()
    document.documentElement.style.removeProperty('--workspace-left')
    document.documentElement.style.removeProperty('--workspace-right')
    vi.unstubAllGlobals()
  })

  it('measures the main zone when a session tab replaces or hides its workspace surface', () => {
    stubResizeObserver()
    const zone = document.createElement('main')
    zone.dataset.treeGroup = 'main-test'
    const tile = document.createElement('div')
    tile.dataset.sessionAnchor = 'session-tile:selected'
    zone.append(tile)
    document.body.append(zone)
    const parkedHost = document.createElement('div')
    parkedHost.dataset.treeGroup = 'main-test'
    parkedHost.dataset.paneHost = 'terminal'
    document.body.prepend(parkedHost)
    $layoutTree.set(group(['workspace', 'session-tile:selected'], { id: 'main-test', active: 'session-tile:selected' }))
    let left = 245
    let right = window.innerWidth
    zone.getBoundingClientRect = () =>
      ({ left, right, width: right - left, top: 43, bottom: 900, height: 857, x: left, y: 43 }) as DOMRect

    const dispose = publishWorkspaceGeometry()

    try {
      const style = document.documentElement.style
      expect(style.getPropertyValue('--workspace-left')).toBe(`${left}px`)
      expect(style.getPropertyValue('--workspace-right')).toBe('0px')

      // Background keep-alive surfaces have no layout box and cannot own chrome.
      const inactive = document.createElement('div')
      inactive.dataset.sessionAnchor = 'workspace'
      inactive.hidden = true
      document.body.prepend(inactive)
      window.dispatchEvent(new Event('resize'))
      expect(style.getPropertyValue('--workspace-left')).toBe(`${left}px`)

      // Sidebar collapse and a mirrored layout use the same zone measurement.
      left = 0
      window.dispatchEvent(new Event('resize'))
      expect(style.getPropertyValue('--workspace-left')).toBe('0px')
      right = window.innerWidth - 245
      window.dispatchEvent(new Event('resize'))
      expect(style.getPropertyValue('--workspace-right')).toBe(`${window.innerWidth - right}px`)
    } finally {
      dispose()
    }
  })

  it('measures the workspace zone when it mounts after the publisher starts', () => {
    class TestResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}

      disconnect() {}
      observe() {}
      unobserve() {}
    }

    class TestMutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback
      }

      disconnect() {}
      observe = vi.fn()
      takeRecords(): MutationRecord[] {
        return []
      }
    }

    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.stubGlobal('MutationObserver', TestMutationObserver)

    $layoutTree.set(group(['workspace'], { id: 'late-workspace' }))
    const dispose = publishWorkspaceGeometry()
    const workspace = document.createElement('main')
    workspace.dataset.treeGroup = 'late-workspace'
    const workspaceRight = window.innerWidth
    workspace.getBoundingClientRect = () =>
      ({
        bottom: 900,
        height: 857,
        left: 245,
        right: workspaceRight,
        top: 43,
        width: workspaceRight - 245,
        x: 245,
        y: 43
      }) as DOMRect
    document.body.append(workspace)

    mutationCallback?.([], {} as MutationObserver)

    expect(document.documentElement.style.getPropertyValue('--workspace-left')).toBe('245px')
    expect(document.documentElement.style.getPropertyValue('--workspace-right')).toBe('0px')

    dispose()
  })

  it('keeps flipped navigation chrome aligned when a summary reserves the window right edge', () => {
    stubResizeObserver()
    const { container } = render(createElement('div'))
    const ownerDocument = container.ownerDocument
    const viewportWidth = ownerDocument.defaultView!.innerWidth

    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect

    const titlebar = ownerDocument.createElement('div')
    titlebar.dataset.slot = 'app-titlebar'
    titlebar.getBoundingClientRect = () => rect(0, 0, viewportWidth, 43)
    const layout = ownerDocument.createElement('div')
    layout.dataset.slot = 'summary-workspace-main'
    layout.getBoundingClientRect = () => rect(0, 43, viewportWidth - 344, 800)
    const navigation = ownerDocument.createElement('aside')
    navigation.dataset.navigationRail = ''
    navigation.getBoundingClientRect = () => rect(viewportWidth - 344 - 245, 43, 245, 800)
    layout.append(navigation)
    container.append(titlebar, layout)

    const dispose = publishWorkspaceGeometry()

    try {
      expect(titlebar.dataset.titlebarRail).toBe('right')
      expect(titlebar.style.getPropertyValue('--titlebar-rail-left')).toBe(`${viewportWidth - 344 - 245}px`)
      expect(titlebar.style.getPropertyValue('--titlebar-rail-width')).toBe('245px')
    } finally {
      dispose()
    }
  })
})
