import { expect, it } from 'vitest'

import {
  isSamePreviewDocument,
  previewScriptRunnerFor,
  registerPreviewScriptRunner,
  watchPreviewDocumentLifecycle
} from './preview-script-runner'

it('retires page bindings on SPA navigation without leaving the live document unready', () => {
  const cleanup = registerPreviewScriptRunner('spa-navigation', async () => undefined)
  const target = new EventTarget()
  const stop = watchPreviewDocumentLifecycle(target, 'spa-navigation')

  try {
    const before = previewScriptRunnerFor('spa-navigation')!
    target.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true, isInPlace: true }))
    expect(isSamePreviewDocument(before)).toBe(false)
    expect(previewScriptRunnerFor('spa-navigation')?.runner).toBe(before.runner)
    const navigated = previewScriptRunnerFor('spa-navigation')!
    target.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true, isInPlace: false }))
    expect(isSamePreviewDocument(navigated)).toBe(false)
    expect(previewScriptRunnerFor('spa-navigation')).toBeNull()
    target.dispatchEvent(new Event('dom-ready'))
    expect(previewScriptRunnerFor('spa-navigation')?.runner).toBe(before.runner)
  } finally {
    stop()
    cleanup()
  }
})

it('retires observations after page zoom without marking a loading document ready', () => {
  const cleanup = registerPreviewScriptRunner('zoom-page', async () => undefined)
  const target = new EventTarget()
  const stop = watchPreviewDocumentLifecycle(target, 'zoom-page')

  try {
    const before = previewScriptRunnerFor('zoom-page')!
    target.dispatchEvent(new Event('page-zoom-changed'))
    expect(isSamePreviewDocument(before)).toBe(false)
    expect(previewScriptRunnerFor('zoom-page')?.runner).toBe(before.runner)
    target.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true }))
    target.dispatchEvent(new Event('page-zoom-changed'))
    expect(previewScriptRunnerFor('zoom-page')).toBeNull()
  } finally {
    stop()
    cleanup()
  }
})
