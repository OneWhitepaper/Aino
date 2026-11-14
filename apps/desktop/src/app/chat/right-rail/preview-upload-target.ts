import { actEngineSource } from '@/lib/preview-act/act-in-page'
import { domSurfaces } from '@/lib/preview-act/dom-surfaces'
import { namingKit } from '@/lib/preview-act/naming'
import type { PreviewActAction } from '@/lib/preview-act/types'
import type { PreviewOwner } from '@/store/preview-ownership'

import { activePreviewScriptRunner } from './preview-script-runner'

/** Resolve the upload control without a pointer action or overlay sweep. A
 * styled upload label can name its hidden input, but never another field. */
export async function resolvePreviewUploadTarget(
  action: Omit<PreviewActAction, 'kind'> & { kind: string },
  signal?: AbortSignal,
  owner?: PreviewOwner,
  guard?: () => void
): Promise<string> {
  guard?.()
  const run = activePreviewScriptRunner(owner)

  if (!run) {
    throw new Error('The upload page is unavailable.')
  }

  const result = (await run(
    `(function () {
    var surfaces = (${domSurfaces.toString()})(document);
    var holder = window.__hermesActHolder = window.__hermesActHolder || {};
    var request = ${JSON.stringify({ kind: 'locate', ref: action.ref, selector: action.selector })};
    var source;
    if (request.ref) {
      var located = (${actEngineSource()})(document, holder, request);
      if (!located.success) return { error: located.error || 'Upload reference is unavailable.' };
      source = holder.aimed;
    } else {
      if (!request.selector) return { error: 'Choose an exact file input or upload label.' };
      var candidates = surfaces.collect(request.selector).elements;
      if (candidates.length !== 1) return { error: 'The upload selector must identify exactly one control.' };
      source = candidates[0];
    }
    var input = source && source.tagName === 'LABEL' ? source.control : source;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'file' || input.matches(':disabled') || !surfaces.contains(input)) {
      return { error: 'Upload target must be an enabled file input or its associated label.' };
    }
    if (surfaces.ancestors(input).concat(surfaces.ancestors(source)).some(function (el) { return el.hasAttribute('inert'); })) {
      return { error: 'The upload control is in an inactive part of the page.' };
    }
    var naming = (${namingKit.toString()})(input.ownerDocument);
    var label = naming.labelOf(source, false) || naming.labelOf(input, false);
    if (!label && input.labels) label = Array.from(input.labels).map(function (el) { return naming.labelOf(el, false); }).join(' ').trim();
    holder.aimed = input;
    return { label: label || 'File upload' };
  })()`,
    signal
  )) as { error?: string; label?: string }

  guard?.()

  if (result.error || !result.label) {
    throw new Error(result.error || 'The upload control could not be resolved.')
  }

  return result.label
}
