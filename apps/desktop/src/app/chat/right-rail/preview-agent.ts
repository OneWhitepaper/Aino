import { getRuntimeI18nLocale } from '@/i18n/runtime'
/** Session-owned browser actions reuse the existing semantic engine and native guest. */
import type { PreviewActAction, PreviewActResult } from '@/lib/preview-act/types'
import type { PreviewOwner } from '@/store/preview-ownership'

import { actOnActivePreview } from './preview-act'
import { activePreviewTabFor } from './preview-active-tab'
import { beginPreviewOperation, confirmPreviewOperation } from './preview-agent-control'
import { previewAgentActionLabel, previewAgentCopy } from './preview-agent-i18n'
import {
  assertPreviewVisible,
  bindPreviewTarget,
  observationMeta,
  pngSize,
  type PreviewObservation,
  type PreviewPageState,
  readPreviewPageState,
  rememberPreviewObservation,
  requirePreviewObservation
} from './preview-agent-observation'
import { runPreviewTabAction } from './preview-agent-tabs'
import {
  inspectPreviewAction,
  performVisualPreviewAction,
  type PreviewTargetInfo,
  screenshotPoint,
  sensitivePreviewAction
} from './preview-agent-visual'
import type { PreviewApproval } from './preview-approval'
import { parsePreviewKey } from './preview-drive'
import { activePreviewInput } from './preview-input'
import { activePreviewNav } from './preview-nav'
import { hasPendingPreviewNative, observeAfterPreviewInput } from './preview-pending-native'
import {
  type ActivePreviewScriptRunner,
  previewLoadFailureFor,
  previewLoadFailureMessage,
  resolveActivePreviewScriptRunner
} from './preview-script-runner'

type Action = Omit<PreviewActAction, 'kind'> & { kind: string }
const READ_ONLY = new Set(['elements', 'screenshot', 'locate', 'pin', 'unpin', 'hold', 'strobe'])
const TARGETED = new Set(['click', 'double_click', 'hover', 'press', 'type', 'drag'])
const ACTIONS = new Set([...READ_ONLY, ...TARGETED, 'scroll', 'back', 'forward', 'reload'])
const SENT_NOTE = 'Input was sent and the page or selection changed. Observe the page again; do not repeat the action.'
const HISTORY = new Set(['back', 'forward', 'reload'])

interface OperationContext {
  action: Action
  binding: ActivePreviewScriptRunner
  owner?: PreviewOwner
  signal: AbortSignal
  guard: () => void
  operation: ReturnType<typeof beginPreviewOperation>
  approval?: PreviewApproval
}

const unchanged = (a: PreviewPageState, b: PreviewPageState) =>
  ['url', 'width', 'height', 'scrollX', 'scrollY', 'revision'].every(
    key => a[key as keyof PreviewPageState] === b[key as keyof PreviewPageState]
  )

function validateAction(action: Action): void {
  if (!ACTIONS.has(action.kind)) {
    throw new Error('Unknown browser action.')
  }

  if (action.coordinate !== undefined) {
    if (!TARGETED.has(action.kind) || action.ref || action.selector) {
      throw new Error('Choose a semantic target or visual target for a supported input action.')
    }

    if (!Array.isArray(action.coordinate) || action.coordinate.length !== 2) {
      throw new Error('A visual target requires two screenshot coordinates.')
    }
  }

  if (action.kind === 'drag' && (!action.coordinate || !action.toCoordinate)) {
    throw new Error('Drag requires start and destination coordinates.')
  }

  if (action.toCoordinate !== undefined && action.kind !== 'drag') {
    throw new Error('A destination coordinate is only valid for drag.')
  }

  if (action.kind === 'type' && typeof action.text !== 'string') {
    throw new Error('Typing requires text.')
  }

  if (action.kind === 'press' && typeof action.key !== 'string') {
    throw new Error('Press requires a key.')
  }

  if (action.kind === 'press') {
    parsePreviewKey(action.key!)
  }
}

async function captureObservation(
  binding: ActivePreviewScriptRunner,
  owner: PreviewOwner | undefined,
  signal: AbortSignal,
  guard: () => void
): Promise<PreviewActResult> {
  if (!binding.runner.capture) {
    throw new Error('Screenshot observation requires the native Aino desktop browser.')
  }

  guard()
  const before = await readPreviewPageState(binding, signal)
  guard()
  const data = await binding.runner.capture(signal)
  guard()
  const after = await readPreviewPageState(binding, signal)
  guard()

  if (!unchanged(before, after)) {
    throw new Error('The page moved during capture. Take another screenshot.')
  }

  const image = pngSize(data)
  const seen = rememberPreviewObservation(binding, after, owner, image)

  return { ...observationMeta(seen), image: { data_url: data, ...image }, success: true }
}

async function approveTarget(ctx: OperationContext, seen?: PreviewObservation): Promise<boolean> {
  const { action, binding, signal, guard, operation } = ctx
  const point = action.coordinate && seen ? screenshotPoint(action.coordinate, seen) : undefined
  const target: PreviewTargetInfo = await inspectPreviewAction(binding.runner, action, point, signal)
  guard()

  if (!sensitivePreviewAction(action, target)) {
    return true
  }

  if (!binding.runner.beginApproval) {
    throw new Error('Native browser approval observation is unavailable. Use manual control.')
  }

  await prepareApprovalTarget(ctx, point)
  const prepared = await inspectPreviewAction(binding.runner, action, point, signal, action.kind === 'press')
  guard()

  if (JSON.stringify(target) !== JSON.stringify(prepared)) {
    throw new Error('The website or target changed while positioning the pointer. Observe the browser again.')
  }

  ctx.approval = await binding.runner.beginApproval(signal)
  guard()

  const copy = previewAgentCopy(getRuntimeI18nLocale())
  // Locating can scroll. Bind approval to the now-visible target.
  const state = await readPreviewPageState(binding, signal)
  guard()
  operation.setPhase('confirmation')
  const origin = new URL(state.url).origin

  const accepted = await confirmPreviewOperation(
    binding.tabId,
    {
      title: copy.confirmTitle,
      description: copy.confirmDescription,
      details: [
        { label: copy.siteLabel, value: origin === 'null' ? state.url : origin },
        { label: copy.actionLabel, value: previewAgentActionLabel(getRuntimeI18nLocale(), action.kind) },
        { label: copy.targetLabel, value: target.label || target.tag || 'Visual target' }
      ],
      confirmLabel: copy.allowLabel
    },
    signal
  )

  if (!accepted) {
    return false
  }

  guard()
  const nextTarget = await inspectPreviewAction(binding.runner, action, point, signal)
  const current = await readPreviewPageState(binding, signal)
  await ctx.approval.validate()
  guard()

  if (!unchanged(state, current) || JSON.stringify(target) !== JSON.stringify(nextTarget)) {
    throw new Error('The website or target changed while confirmation was open. Observe and confirm again.')
  }

  operation.setPhase('acting')

  return true
}

/** Hover/focus is observation; settle it before binding the confirmed DOM and styles. */
async function prepareApprovalTarget(ctx: OperationContext, point?: { x: number; y: number }): Promise<void> {
  const { action, signal, owner, guard } = ctx
  const input = activePreviewInput(owner)

  if (!input) {
    throw new Error('Native browser input is unavailable. Use manual control.')
  }

  if (point) {
    input.send({ type: 'mouseMove', ...point })
  } else if (action.ref || action.selector) {
    const result = await actOnActivePreview(
      { kind: 'hover', ref: action.ref, selector: action.selector },
      signal,
      owner,
      guard
    )

    if (!result.success) {
      throw new Error(result.error || 'The browser target could not be prepared.')
    }
  }

  await input.settle?.()
  guard()
}

async function performSemantic(ctx: OperationContext): Promise<PreviewActResult> {
  const { action, binding, signal, owner, guard } = ctx
  const result = await actOnActivePreview(action, signal, owner, guard, ctx.approval?.input)
  await ctx.approval?.input.settle?.()

  if (!result.success || hasPendingPreviewNative(result)) {
    return { ...result, tab_id: binding.tabId }
  }

  // History actions intentionally retire the document.
  if (HISTORY.has(action.kind)) {
    return { ...result, tab_id: binding.tabId }
  }

  try {
    guard()

    const receipt = await observeAfterPreviewInput(binding.runner, owner, signal, nextSignal =>
      readPreviewPageState(binding, nextSignal)
    )

    guard()

    if ('pending' in receipt) {
      return { ...result, ...receipt.pending, tab_id: binding.tabId }
    }

    const observed = rememberPreviewObservation(binding, receipt.observed, owner)

    return { ...result, ...observationMeta(observed) }
  } catch (error) {
    if (READ_ONLY.has(action.kind)) {
      throw error
    }

    return { ...result, tab_id: binding.tabId, note: SENT_NOTE }
  }
}

async function performVisual(ctx: OperationContext, seen?: PreviewObservation): Promise<PreviewActResult> {
  const { action, binding, signal, owner, guard } = ctx
  const input = ctx.approval?.input ?? activePreviewInput(owner)

  if (!input || !seen || !action.coordinate) {
    throw new Error('Visual input requires a screenshot and a native browser input channel.')
  }

  await performVisualPreviewAction(action, seen, input, guard, signal, binding.runner)
  await input.settle?.()

  await new Promise(resolve => requestAnimationFrame(resolve))

  const receipt = await observeAfterPreviewInput(binding.runner, owner, signal, async observeSignal =>
    verifyVisualInput(ctx, observeSignal ?? signal)
  )

  return 'pending' in receipt ? { ...receipt.pending, acted: action.kind, tab_id: binding.tabId } : receipt.observed
}

async function verifyVisualInput(ctx: OperationContext, signal: AbortSignal): Promise<PreviewActResult> {
  const { action, binding, owner, guard } = ctx

  try {
    guard()
    const inventory = await actOnActivePreview({ kind: 'elements' }, signal, owner, guard)
    const observation = await captureObservation(binding, owner, signal, guard)

    return { ...inventory, ...observation, acted: action.kind, success: true }
  } catch {
    // Observation failure after input must not invite a duplicate click.
    return { acted: action.kind, tab_id: binding.tabId, success: true, note: SENT_NOTE }
  }
}

async function performOwnedAction(ctx: OperationContext): Promise<PreviewActResult> {
  const { action, binding, signal, owner, guard } = ctx
  guard()

  if (action.kind === 'screenshot') {
    return captureObservation(binding, owner, signal, guard)
  }

  if (TARGETED.has(action.kind) && binding.runner.nativeAction) {
    const capability = await binding.runner.nativeAction({ action: 'watch' }, signal)

    if (capability.dialog_control === 'system') {
      throw new Error('Automated dialog control is unavailable in this Electron build. Use the Browser manually.')
    }
  }

  const state = await readPreviewPageState(binding, signal)
  guard()
  const visual = action.coordinate !== undefined || action.kind === 'drag'
  const seen = visual || action.observationId ? requirePreviewObservation(action, binding, state, owner) : undefined

  try {
    if (TARGETED.has(action.kind) && !(await approveTarget(ctx, seen))) {
      return { error: previewAgentCopy(getRuntimeI18nLocale()).deniedText, success: false }
    }

    guard()

    return await (visual ? performVisual(ctx, seen) : performSemantic(ctx))
  } finally {
    await ctx.approval?.release()
  }
}

async function runLoadingHistory(
  action: Action,
  signal?: AbortSignal,
  owner?: PreviewOwner
): Promise<PreviewActResult> {
  const tab = activePreviewTabFor(owner)
  const nav = activePreviewNav(owner)

  if (!HISTORY.has(action.kind) || !tab || !nav) {
    const failure = tab && (!action.tabId || action.tabId === tab.id) ? previewLoadFailureFor(tab.id) : undefined

    return {
      success: false,
      error: failure
        ? previewLoadFailureMessage(failure)
        : 'No ready native browser page is selected. Wait for loading, then observe the browser again.'
    }
  }

  let operation: ReturnType<typeof beginPreviewOperation> | undefined

  try {
    if (action.tabId && action.tabId !== tab.id) {
      throw new Error('The requested browser tab is no longer selected.')
    }

    assertPreviewVisible(tab.id)
    operation = beginPreviewOperation(tab.id, 'acting')
    const liveSignal = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal

    const guard = () => {
      liveSignal.throwIfAborted()
      assertPreviewVisible(tab.id)

      if (activePreviewTabFor(owner)?.id !== tab.id || activePreviewNav(owner) !== nav) {
        throw new Error('The selected browser page changed. Observe the page again.')
      }
    }

    return await actOnActivePreview(action, liveSignal, owner, guard)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    operation?.release()
  }
}

export async function runPreviewAgentAction(
  action: Action,
  outerSignal?: AbortSignal,
  owner?: PreviewOwner
): Promise<PreviewActResult> {
  if (action.kind === 'tabs' || action.kind === 'select_tab') {
    try {
      return await runPreviewTabAction(action, outerSignal, owner)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  if (
    ['dialog_status', 'dialog_respond', 'upload_files', 'downloads_status', 'download_cancel'].includes(action.kind)
  ) {
    const { runPreviewNativeFeatureAction } = await import('./preview-native-features')

    return runPreviewNativeFeatureAction(action, outerSignal, owner)
  }

  const binding = resolveActivePreviewScriptRunner(owner)
  binding?.runner.setNativeAuthority?.(owner)

  // Only history may use loading-page handles, behind the same control lease.
  if (!binding) {
    return runLoadingHistory(action, outerSignal, owner)
  }

  let operation: ReturnType<typeof beginPreviewOperation> | undefined
  const target = bindPreviewTarget(binding, owner, !READ_ONLY.has(action.kind))

  try {
    validateAction(action)

    if (action.tabId && action.tabId !== binding.tabId) {
      throw new Error('The requested tab is no longer selected. Observe the selected browser page again.')
    }

    target.validate()
    operation = beginPreviewOperation(binding.tabId, READ_ONLY.has(action.kind) ? 'observing' : 'acting')
    const signal = outerSignal ? AbortSignal.any([outerSignal, operation.signal]) : operation.signal

    const guard = () => {
      signal.throwIfAborted()
      target.validate()
    }

    return await performOwnedAction({ action, binding, owner, signal, guard, operation })
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), success: false }
  } finally {
    operation?.release()
    target.release()
  }
}
