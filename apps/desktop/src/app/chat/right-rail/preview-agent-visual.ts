import { actEngineSource } from '@/lib/preview-act/act-in-page'
import { domSurfaces } from '@/lib/preview-act/dom-surfaces'
import { namingKit } from '@/lib/preview-act/naming'
import type { PreviewActAction } from '@/lib/preview-act/types'

import type { PreviewObservation } from './preview-agent-observation'
import { parsePreviewKey, pressControlKey, selectAll, typeText } from './preview-drive'
import { type PreviewInputEvent, type PreviewInputHandle } from './preview-input'
import type { PreviewScriptRunner } from './preview-script-runner'

export interface PreviewTargetInfo {
  label: string
  tag: string
  type: string
  role: string
  href: string
  form: string
  context: string
}

export function screenshotPoint(coordinate: [number, number], seen: PreviewObservation) {
  if (
    !seen.image ||
    !Array.isArray(coordinate) ||
    coordinate.length !== 2 ||
    coordinate.some(value => !Number.isFinite(value)) ||
    coordinate[0] < 0 ||
    coordinate[1] < 0 ||
    coordinate[0] >= seen.image.width ||
    coordinate[1] >= seen.image.height
  ) {
    throw new Error('Coordinates must be inside the latest screenshot. Request a new screenshot.')
  }

  return {
    x: (coordinate[0] * seen.state.width) / seen.image.width,
    y: (coordinate[1] * seen.state.height) / seen.image.height
  }
}

/** Inspect through the same resolver as the action; a confirmation names the actual target. */
export async function inspectPreviewAction(
  run: PreviewScriptRunner,
  action: Omit<PreviewActAction, 'kind'> & { kind: string },
  point?: { x: number; y: number },
  signal?: AbortSignal,
  focus = false
): Promise<PreviewTargetInfo> {
  const located = { kind: 'locate', ref: action.ref, selector: action.selector, focus }

  const script = `(function () {
    var holder = window.__hermesActHolder = window.__hermesActHolder || {};
    var point = ${JSON.stringify(point ?? null)};
    var el;
    if (point) {
      el = document.elementFromPoint(point.x, point.y);
    } else if (${JSON.stringify(Boolean(action.ref || action.selector))}) {
      var located = (${actEngineSource()})(document, holder, ${JSON.stringify(located)});
      if (!located.success) return { error: located.error || 'Target is unavailable. Call elements again.' };
      el = holder.aimed;
    } else { el = document.activeElement; }
    for (var n = 0; el && n < 16; n++) {
      if (el.shadowRoot && el.shadowRoot.elementFromPoint && point) {
        var deep = el.shadowRoot.elementFromPoint(point.x, point.y);
        if (deep && deep !== el) { el = deep; continue; }
      }
      break;
    }
    if (${JSON.stringify(action.kind === 'click' || action.kind === 'double_click')} && el && el.closest) {
      // Clicking nested text/icons activates their control; labels activate the associated input.
      var control = el.closest('button,input,select,textarea,a[href],label,[role="button"],[role="link"]');
      if (control) el = control.tagName === 'LABEL' && control.control ? control.control : control;
    }
    var form = el ? (el.form || (el.closest ? el.closest('form') : null)) : null;
    var naming = (${namingKit.toString()})(el ? el.ownerDocument : document);
    // A button value is its caption; a data-entry value is not its approval label.
    var valueLabel = el && (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /^(button|submit|reset|image)$/.test(el.type)));
    return { label: el ? naming.labelOf(el, Boolean(valueLabel)) : '',
      tag: el ? el.tagName.toLowerCase() : '', type: el ? (el.getAttribute('type') || '') : '',
      role: el ? (el.getAttribute('role') || '') : '', href: el ? (el.getAttribute('href') || '') : '',
      form: form ? (form.getAttribute('action') || 'current page') : '',
      context: form ? (form.innerText || '').slice(0,400) : '' };
  })()`

  // Guest exceptions lose their message at Electron's boundary; return failure as data first.
  const target = (await run(script, signal)) as PreviewTargetInfo | { error: string }

  if ('error' in target) {
    throw new Error(target.error)
  }

  return target
}

const HIGH_IMPACT =
  /删除|移除|清空|支付|付款|购买|下单|转账|提交|发送|发布|批准|同意|确认|授权|密码|安全|权限|注销|delete|remove|erase|clear all|pay\b|purchase|buy\b|checkout|transfer|submit|send\b|publish|approve|confirm|accept|authorize|password|security|permission|revoke|sign.?out/i

// Form siblings often include “Submit” while the current control only edits a
// draft. Context elevates financial and account-security risk, not every field
// merely sharing a form with an action button.
const SENSITIVE_CONTEXT =
  /支付|付款|购买|下单|转账|信用卡|银行卡|密码|安全|权限|授权|注销|pay(?:ment)?\b|purchase|buy\b|checkout|transfer|billing|credit.?card|cardholder|password|security|permission|authoriz|revoke|sign.?out|(?:delete|remove).?account/i

export function sensitivePreviewAction(
  action: Omit<PreviewActAction, 'kind'> & { kind: string },
  target: PreviewTargetInfo
): boolean {
  if (action.kind === 'hover') {
    return false
  }

  if (action.sensitive || action.submit || action.coordinate || action.kind === 'drag') {
    return true
  }

  if (action.kind === 'press' && (/^(enter|return|space| )$/i.test(action.key ?? '') || /\+/.test(action.key ?? ''))) {
    return true
  }

  if (
    (action.kind === 'click' || action.kind === 'double_click') &&
    (target.type === 'submit' || (target.tag === 'button' && target.form && !target.type))
  ) {
    return true
  }

  return (
    HIGH_IMPACT.test([target.label, target.type, target.href].join(' ')) ||
    SENSITIVE_CONTEXT.test([target.form, target.context].join(' '))
  )
}

async function visualKeyboardFocused(
  run: PreviewScriptRunner,
  point: { x: number; y: number },
  action: Omit<PreviewActAction, 'kind'> & { kind: string },
  signal: AbortSignal
): Promise<boolean> {
  return (
    (await run(
      `(function () {
    var surfaces = (${domSurfaces.toString()})(document);
    var hit = document.elementFromPoint(${point.x}, ${point.y});
    var active = surfaces.activeElement();
    if (!hit || !active) return false;
    var boundary = hit.shadowRoot || hit.tagName === 'IFRAME' || hit.tagName === 'FRAME';
    var related = surfaces.ancestors(hit).includes(active) || (boundary && surfaces.ancestors(active).includes(hit));
    var tag = active.tagName;
    var opaque = (tag === 'IFRAME' || tag === 'FRAME') && !active.contentDocument;
    var editable = !active.disabled && !active.readOnly && (active.isContentEditable === true ||
      tag === 'TEXTAREA' || (tag === 'INPUT' && !/^(button|checkbox|radio|file|submit|reset|image|hidden|range|color)$/.test(active.type)));
    return related && (${JSON.stringify(action.kind)} === 'type' ? editable || opaque :
      (tag !== 'BODY' && tag !== 'HTML') || ${JSON.stringify(action.allowShortcut === true)});
  })()`,
      signal
    )) === true
  )
}

/** Coordinate fallback always uses trusted input, with a guard before every event. */
export async function performVisualPreviewAction(
  action: Omit<PreviewActAction, 'kind'> & { kind: string },
  seen: PreviewObservation,
  input: PreviewInputHandle,
  guard: () => void,
  signal: AbortSignal,
  run: PreviewScriptRunner
) {
  if (action.kind === 'press') {
    parsePreviewKey(action.key!)
  }

  const point = screenshotPoint(action.coordinate!, seen)

  const send = (event: PreviewInputEvent) => {
    signal.throwIfAborted()
    guard()
    input.send(event)
  }

  guard()
  input.focus()
  send({ type: 'mouseMove', ...point })

  if (action.kind === 'hover') {
    return
  }

  if (action.kind === 'drag') {
    const end = screenshotPoint(action.toCoordinate!, seen)
    let last = point
    send({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })

    try {
      for (let step = 1; step <= 12; step++) {
        const next = { x: point.x + ((end.x - point.x) * step) / 12, y: point.y + ((end.y - point.y) * step) / 12 }
        send({ type: 'mouseMove', button: 'left', modifiers: ['leftButtonDown'], ...next })
        last = next
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
    } finally {
      // Release on the ORIGINAL guest even after cancellation, never leave a held button.
      input.send({ type: 'mouseUp', button: 'left', clickCount: 1, ...last })
    }

    return
  }

  for (let clickCount = 1; clickCount <= (action.kind === 'double_click' ? 2 : 1); clickCount++) {
    send({ type: 'mouseDown', button: 'left', clickCount, ...point })
    input.send({ type: 'mouseUp', button: 'left', clickCount, ...point })
  }

  if (action.kind !== 'type' && action.kind !== 'press') {
    return
  }

  await new Promise(resolve => requestAnimationFrame(resolve))
  guard()

  if (!(await visualKeyboardFocused(run, point, action, signal))) {
    throw new Error('The visible target did not receive keyboard focus; nothing typed. Observe the page again.')
  }

  guard()
  const held = new Map<string, string[] | undefined>()

  const keyboard: PreviewInputHandle = {
    focus: input.focus,
    send: event => {
      if (event.type !== 'keyUp') {
        signal.throwIfAborted()
        guard()
      }

      if (event.type === 'keyDown') {
        held.set(event.keyCode, event.modifiers)
      }

      if (event.type === 'keyUp') {
        held.delete(event.keyCode)
      }

      input.send(event)
    }
  }

  try {
    if (action.kind === 'type') {
      await selectAll(keyboard)
      await typeText(keyboard, action.text!, signal)
      signal.throwIfAborted()

      if (action.submit) {
        await pressControlKey(keyboard, 'Enter')
      }
    } else if (action.key!.length === 1) {
      await typeText(keyboard, action.key!, signal)
    } else {
      await pressControlKey(keyboard, action.key!)
    }

    signal.throwIfAborted()
    guard()
  } finally {
    // A takeover between key-down and text dispatch must still release the original guest's key.
    for (const [keyCode, modifiers] of held) {
      input.send({ keyCode, modifiers, type: 'keyUp' })
    }
  }
}
