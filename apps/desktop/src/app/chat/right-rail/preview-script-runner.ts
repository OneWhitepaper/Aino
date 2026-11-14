/**
 * PREVIEW SCRIPT RUNNER REGISTRY — the one way anything in the app reaches into
 * the preview pane's guest page, the script analog of preview-nav's handle
 * registry.
 *
 * A live browser pane registers its webview's `executeJavaScript` here, keyed
 * by tab id; `activePreviewScriptRunner` resolves the ACTIVE tab among the
 * requesting session's tabs. Both guest-page features ride it — the tour tool (preview-tour.ts)
 * and the interaction tool (preview-act.ts) — so their heavy payloads stay out
 * of the pane component's static import graph and only load when used.
 *
 * Each registration also tracks its guest DOCUMENT (generation, ready): vault
 * fills (preview-vault.ts) pin one document and refuse once it is replaced.
 */

import type { PreviewOwner } from '@/store/preview-ownership'

import type { PreviewBrowserInteractionRequest, PreviewBrowserInteractionResult } from '../../../../shared/preview-browser-interactions'

import { activePreviewTabFor } from './preview-active-tab'
import type { PreviewApproval } from './preview-approval'

/** Runs JS source in the pane's guest page, resolving its completion value. */
export interface PreviewScriptRunner {
  (code: string, signal?: AbortSignal): Promise<unknown>
  /** Capture the same guest's visible viewport through the native bridge. */
  capture?: (signal?: AbortSignal) => Promise<string>
  /** Keep the same guest awake between a driven action's script/input trips. */
  withActivity?: <T>(operation: () => Promise<T>, signal?: AbortSignal) => Promise<T>
  nativeAction?: (request: Omit<PreviewBrowserInteractionRequest, 'scope'>,
    signal?: AbortSignal) => Promise<PreviewBrowserInteractionResult>
  setNativeAuthority?: (owner?: PreviewOwner) => void
  beginApproval?: (signal?: AbortSignal) => Promise<PreviewApproval>
}

export interface ActivePreviewScriptRunner {
  generation: number
  runner: PreviewScriptRunner
  tabId: string
}

export interface PreviewLoadFailure {
  code?: number
  description: string
  url: string
}

interface RegisteredRunner {
  failure?: PreviewLoadFailure
  generation: number
  ready: boolean
  runner: PreviewScriptRunner
}

const runners = new Map<string, RegisteredRunner>()
let nextDocumentGeneration = 0

/** Register a live preview's script runner; returns an idempotent unregister. */
export function registerPreviewScriptRunner(
  tabId: string,
  runner: PreviewScriptRunner,
  options: { initiallyReady?: boolean } = {}
): () => void {
  const registration = { generation: ++nextDocumentGeneration, ready: options.initiallyReady ?? true, runner }

  runners.set(tabId, registration)

  return () => {
    if (runners.get(tabId) === registration) {
      runners.delete(tabId)
    }
  }
}

/** The script runner of the ACTIVE tab among those `owner` (the requesting
 *  session's stored id; omitted = the focused session) may see. Null = no live
 *  page behind it. */
export function activePreviewScriptRunner(owner?: PreviewOwner): PreviewScriptRunner | null {
  const tab = activePreviewTabFor(owner)

  return (tab && runners.get(tab.id)?.runner) || null
}

/** Retire bindings to the current guest document before its replacement loads. */
export function invalidatePreviewScriptRunner(tabId: string): void {
  const registration = runners.get(tabId)

  if (registration) {
    registration.ready = false
    registration.generation = ++nextDocumentGeneration
  }
}

/** Keep native/pane load failures on the existing tab registration, never in a second page registry. */
export function setPreviewLoadFailure(tabId: string, failure: PreviewLoadFailure | null): void {
  const registration = runners.get(tabId)

  if (!registration) {
    return
  }

  registration.failure = failure ?? undefined

  if (failure) {
    registration.ready = false
    registration.generation = ++nextDocumentGeneration
  }
}

export function previewLoadFailureFor(tabId: string): PreviewLoadFailure | undefined {
  return runners.get(tabId)?.failure
}

export function previewLoadFailureMessage(failure: PreviewLoadFailure): string {
  const code = failure.code === undefined ? '' : ` (${failure.code})`

  return `Browser page failed to load: ${failure.description}${code} at ${failure.url}. This is a load failure, not a page still loading. Do not repeat observations expecting it to finish; report the failure or retry navigation when appropriate.`
}

/** Mark the live renderer as ready after Electron created its new document. */
export function markPreviewDocumentReady(tabId: string): void {
  const registration = runners.get(tabId)

  if (registration) {
    registration.ready = !registration.failure
    registration.generation = ++nextDocumentGeneration
  }
}

/** Follow the Electron guest's main-frame replacement and ready boundaries, so
 *  a vault fill pinned to one document refuses once it is replaced. */
export function watchPreviewDocumentLifecycle(target: EventTarget, tabId: string | undefined): () => void {
  if (!tabId) {
    return () => {}
  }

  const onStartNavigation = (event: Event) => {
    const detail = event as Event & { isInPlace?: boolean; isMainFrame?: boolean }

    if (detail.isMainFrame === true) {
      setPreviewLoadFailure(tabId, null)

      if (detail.isInPlace === true) {
        // SPA/hash navigation has no later dom-ready event, but still retires
        // an approval or screenshot bound to the previous page location.
        markPreviewDocumentReady(tabId)
      } else {
        invalidatePreviewScriptRunner(tabId)
      }
    }
  }

  const onReady = () => markPreviewDocumentReady(tabId)

  const onPageZoom = () => {
    const registration = runners.get(tabId)

    if (registration) {
      registration.generation = ++nextDocumentGeneration
    }
  }

  const onFail = (event: Event) => {
    const detail = event as Event & {
      errorCode?: number
      errorDescription?: string
      isMainFrame?: boolean
      validatedURL?: string
    }

    if (detail.isMainFrame === false || detail.errorCode === -3) {
      return
    }

    setPreviewLoadFailure(tabId, {
      code: detail.errorCode,
      description: detail.errorDescription || 'Page could not be loaded',
      url: detail.validatedURL || ''
    })
  }

  target.addEventListener('did-start-navigation', onStartNavigation)
  target.addEventListener('dom-ready', onReady)
  target.addEventListener('page-zoom-changed', onPageZoom)
  target.addEventListener('did-fail-load', onFail)

  return () => {
    target.removeEventListener('did-start-navigation', onStartNavigation)
    target.removeEventListener('dom-ready', onReady)
    target.removeEventListener('page-zoom-changed', onPageZoom)
    target.removeEventListener('did-fail-load', onFail)
  }
}

/** The live document of `tabId`, or null while it is loading / not registered. */
export function previewScriptRunnerFor(tabId: string): ActivePreviewScriptRunner | null {
  const registration = runners.get(tabId)

  return registration?.ready ? { generation: registration.generation, runner: registration.runner, tabId } : null
}

/** The page an agent tool for `owner` acts on, paired with its exact live document. */
export function resolveActivePreviewScriptRunner(owner?: PreviewOwner): ActivePreviewScriptRunner | null {
  const tab = activePreviewTabFor(owner)

  return tab ? previewScriptRunnerFor(tab.id) : null
}

/** Native dialogs/download receipts remain reachable while JavaScript or navigation is suspended. */
export function resolveActivePreviewNativeRunner(owner?: PreviewOwner): ActivePreviewScriptRunner | null {
  const tab = activePreviewTabFor(owner)
  const registration = tab && runners.get(tab.id)

  return registration ? { generation: registration.generation, runner: registration.runner, tabId: tab!.id } : null
}

export function isSamePreviewNativeRunner(binding: ActivePreviewScriptRunner): boolean {
  const registration = runners.get(binding.tabId)

  return registration?.runner === binding.runner && registration.generation === binding.generation
}

/** True only while `binding`'s tab still shows the same document through the same runner. */
export function isSamePreviewDocument(binding: ActivePreviewScriptRunner): boolean {
  const live = previewScriptRunnerFor(binding.tabId)

  return live?.runner === binding.runner && live.generation === binding.generation
}
