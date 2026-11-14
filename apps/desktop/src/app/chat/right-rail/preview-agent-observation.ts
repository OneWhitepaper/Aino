import { randomUuid } from '@hermes/shared'

import {
  $activeTreeGroup,
  $hoveredTreeGroup,
  $layoutTree,
  $paneVisible,
  isPaneVisible
} from '@/components/pane-shell/tree/store'
import type { PreviewActAction } from '@/lib/preview-act/types'
import { $rightRailActiveTabId } from '@/store/layout'
import type { PreviewOwner } from '@/store/preview-ownership'
import { $focusedStoredSessionId } from '@/store/session-focus'
import { isBrowserWindow, windowBrowserTabId } from '@/store/windows'

import { activePreviewTabFor } from './preview-active-tab'
import { previewControlEpoch } from './preview-agent-control'
import { type ActivePreviewScriptRunner, isSamePreviewDocument, isSamePreviewNativeRunner } from './preview-script-runner'

export interface PreviewPageState {
  url: string
  title: string
  width: number
  height: number
  scrollX: number
  scrollY: number
  revision: number
}

export interface PreviewObservation {
  id: string
  document: ActivePreviewScriptRunner
  state: PreviewPageState
  owner: string
  requestOwner?: PreviewOwner
  epoch: number
  expiresAt: number
  image?: { width: number; height: number }
}

const observations = new Map<string, PreviewObservation>()
const selectionSignals = [$rightRailActiveTabId, $activeTreeGroup, $hoveredTreeGroup, $layoutTree]
const ownerKey = (owner?: PreviewOwner) => JSON.stringify(owner === undefined ? $focusedStoredSessionId.get() : owner)

const stopSelectionWatchers = selectionSignals.map(store =>
  store.listen(() => {
    for (const [tabId, seen] of observations) {
      if (activePreviewTabFor(seen.requestOwner)?.id !== tabId) {
        observations.delete(tabId)
      }
    }
  })
)

import.meta.hot?.dispose(() => stopSelectionWatchers.forEach(stop => stop()))

export function assertPreviewVisible(tabId: string): void {
  // Pop-outs render their own guest outside the main window's persisted pane tree.
  if (isBrowserWindow() && windowBrowserTabId() === tabId) {
    return
  }

  if ($layoutTree.get() && !isPaneVisible(`preview-tile:${tabId}`)) {
    throw new Error(
      'The browser is hidden. Use desktop_preview open to explicitly show the page, or ask the user to display its Browser tab before acting.'
    )
  }
}

/** Switching away permanently retires this operation, even after switching back. */
export function bindPreviewTarget(binding: ActivePreviewScriptRunner, owner?: PreviewOwner, requireVisible = false, nativeOnly = false) {
  let changed = false
  let hidden = false

  const validate = () => {
    if (hidden) {
      throw new Error(
        'The browser was hidden during this operation. Use desktop_preview open to show it and observe again before acting.'
      )
    }

    if (changed) {
      throw new Error('The selected browser page changed. Observe the page again before acting.')
    }

    if (nativeOnly) {
      if (!isSamePreviewNativeRunner(binding) || activePreviewTabFor(owner)?.id !== binding.tabId) {
        throw new Error('The selected browser page changed. Observe the page again before acting.')
      }
    } else {
      assertPreviewTarget(binding, owner)
    }

    if (requireVisible) {
      assertPreviewVisible(binding.tabId)
    }
  }

  const stops = selectionSignals.map(store =>
    store.listen(() => {
      changed ||= activePreviewTabFor(owner)?.id !== binding.tabId
    })
  )

  if (requireVisible && !isBrowserWindow()) {
    stops.push(
      $paneVisible(`preview-tile:${binding.tabId}`).listen(visible => {
        hidden ||= Boolean($layoutTree.get()) && !visible
      })
    )
  }

  return { validate, release: () => stops.forEach(stop => stop()) }
}

export async function readPreviewPageState(
  binding: ActivePreviewScriptRunner,
  signal?: AbortSignal
): Promise<PreviewPageState> {
  signal?.throwIfAborted()

  const state = (await binding.runner(
    `(function () {
    var holder = window.__hermesPreviewObservation;
    if (!holder) {
      holder = window.__hermesPreviewObservation = { revision: 0 };
      var relevant = function (node) {
        var el = node.nodeType === 1 ? node : node.parentElement;
        return !el || !(el.closest && el.closest('hermes-watch'));
      };
      holder.observer = new MutationObserver(function (records) {
        if (records.some(function (record) {
          if (!relevant(record.target)) return false;
          if (record.type !== 'childList') return true;
          return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(relevant);
        })) holder.revision++;
      });
      holder.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    return { url: location.href, title: document.title, width: innerWidth, height: innerHeight,
      scrollX: scrollX, scrollY: scrollY, revision: holder.revision };
  })()`,
    signal
  )) as PreviewPageState

  if (!state || typeof state.url !== 'string' || !Number.isFinite(state.width) || !Number.isFinite(state.height)) {
    throw new Error('The browser did not return its current page state.')
  }

  signal?.throwIfAborted()

  return state
}

export function assertPreviewTarget(binding: ActivePreviewScriptRunner, owner?: PreviewOwner): void {
  if (!isSamePreviewDocument(binding) || activePreviewTabFor(owner)?.id !== binding.tabId) {
    throw new Error('The selected browser page changed. Observe the page again before acting.')
  }
}

export function rememberPreviewObservation(
  binding: ActivePreviewScriptRunner,
  state: PreviewPageState,
  owner?: PreviewOwner,
  image?: { width: number; height: number }
): PreviewObservation {
  for (const [tabId, seen] of observations) {
    if (seen.expiresAt < Date.now() || !isSamePreviewDocument(seen.document)) {
      observations.delete(tabId)
    }
  }

  if (observations.size >= 32) {
    observations.delete(observations.keys().next().value!)
  }

  const observation = {
    id: randomUuid(),
    document: binding,
    state,
    owner: ownerKey(owner),
    requestOwner: owner,
    image,
    epoch: previewControlEpoch(binding.tabId),
    expiresAt: Date.now() + 5 * 60_000
  }

  observations.set(binding.tabId, observation)

  return observation
}

export function requirePreviewObservation(
  action: Omit<PreviewActAction, 'kind'> & { kind: string },
  binding: ActivePreviewScriptRunner,
  state: PreviewPageState,
  owner?: PreviewOwner
): PreviewObservation {
  const seen = observations.get(binding.tabId)

  if (
    !seen ||
    !action.tabId ||
    action.observationId !== seen.id ||
    seen.owner !== ownerKey(owner) ||
    seen.expiresAt < Date.now() ||
    seen.epoch !== previewControlEpoch(binding.tabId) ||
    seen.document.generation !== binding.generation ||
    seen.document.runner !== binding.runner ||
    ['url', 'width', 'height', 'scrollX', 'scrollY', 'revision'].some(
      key => state[key as keyof PreviewPageState] !== seen.state[key as keyof PreviewPageState]
    )
  ) {
    throw new Error('The browser observation is missing or stale. Request elements or a screenshot again.')
  }

  return seen
}

export function pngSize(dataUrl: string): { width: number; height: number } {
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 12 * 1024 * 1024) {
    throw new Error('The browser returned an invalid or oversized PNG capture.')
  }

  const bytes = atob(dataUrl.slice(22, 22 + 32))

  if (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes.charCodeAt(index) !== byte)) {
    throw new Error('The browser capture has an invalid PNG header.')
  }

  const numberAt = (offset: number) =>
    new DataView(Uint8Array.from(bytes, char => char.charCodeAt(0)).buffer).getUint32(offset)

  const width = numberAt(16),
    height = numberAt(20)

  if (!width || !height || width > 16384 || height > 16384 || width * height > 64_000_000) {
    throw new Error('The browser capture dimensions are unsupported.')
  }

  return { width, height }
}

export function observationMeta(seen: PreviewObservation) {
  return {
    observation_id: seen.id,
    tab_id: seen.document.tabId,
    title: seen.state.title,
    url: seen.state.url,
    viewport: { width: seen.state.width, height: seen.state.height }
  }
}
