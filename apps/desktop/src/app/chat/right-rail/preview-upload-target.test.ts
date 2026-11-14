import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { actInPage, type PreviewActHolder } from '@/lib/preview-act/act-in-page'
import { $confirmRequest, runConfirm, settleConfirm } from '@/store/confirm'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'

import { runPreviewAgentAction } from './preview-agent'
import { type PreviewScriptRunner, registerPreviewScriptRunner } from './preview-script-runner'
import { resolvePreviewUploadTarget } from './preview-upload-target'

const cleanups: Array<() => void> = []
let pending: Promise<unknown> | undefined

beforeEach(() => {
  document.body.innerHTML =
    '<input id="file" type="file" style="display:none"><label for="file">Attach document</label>'
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const size = getComputedStyle(this).display === 'none' ? 0 : 80

    return { left: 0, top: 0, right: size, bottom: size, width: size, height: size } as DOMRect
  })
  Element.prototype.scrollIntoView = vi.fn()
  newBrowserTab()
})

afterEach(async () => {
  settleConfirm(false)
  await pending
  pending = undefined
  cleanups.splice(0).forEach(cleanup => cleanup())
  closeRightRail()
  vi.restoreAllMocks()
  delete (window as unknown as { __hermesActHolder?: unknown }).__hermesActHolder
  document.querySelector('hermes-watch')?.remove()
})

it('uploads through a visible label ref to its associated hidden file input after explicit confirmation', async () => {
  const holder: PreviewActHolder = ((window as unknown as { __hermesActHolder: PreviewActHolder }).__hermesActHolder =
    {})

  const label = actInPage(document, holder, { kind: 'elements' }).elements!.find(
    item => item.label === 'Attach document'
  )!

  const native = vi.fn(async request => {
    if (request.action === 'upload_prepare') {
      const aimed = holder.aimed as HTMLInputElement

      if (aimed.tagName !== 'INPUT' || aimed.type !== 'file') {
        throw new Error('Upload target must be a file input')
      }

      return {
        success: true,
        url: location.href,
        ticket: 'upload-ticket',
        upload: { state: 'prepared' as const, paths: ['/tmp/synthetic.txt'], filenames: ['synthetic.txt'] }
      }
    }

    return {
      success: true,
      upload: { state: 'completed' as const, paths: ['/tmp/synthetic.txt'], filenames: ['synthetic.txt'] }
    }
  })

  const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
  runner.nativeAction = native
  cleanups.push(registerPreviewScriptRunner($rightRailActiveTabId.get()!, runner))
  const operation = runPreviewAgentAction({ kind: 'upload_files', ref: label.ref, paths: ['/tmp/synthetic.txt'] })
  pending = operation
  await vi.waitFor(() => expect(native).toHaveBeenCalled())
  expect(holder.aimed).toBe(document.querySelector('input'))
  await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
  expect($confirmRequest.get()?.details?.some(detail => detail.value === 'Attach document')).toBe(true)
  expect(native).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'upload_commit' }), expect.anything())
  await runConfirm($confirmRequest.get()!)
  expect(await operation).toMatchObject({ success: true, upload: { state: 'completed' } })
})

it('resolves an exact hidden file selector without reading its value or making it a click target', async () => {
  const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
  cleanups.push(registerPreviewScriptRunner($rightRailActiveTabId.get()!, runner))
  const input = document.querySelector('input')!
  Object.defineProperty(input, 'value', {
    get: () => {
      throw new Error('File value must not be read')
    }
  })
  expect(await resolvePreviewUploadTarget({ kind: 'upload_files', selector: '#file' })).toBe('Attach document')
  expect(actInPage(document, {}, { kind: 'elements' }).elements?.map(item => item.label)).toEqual(['Attach document'])
})

it('rejects ambiguous selectors and labels for non-file or disabled controls', async () => {
  const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
  cleanups.push(registerPreviewScriptRunner($rightRailActiveTabId.get()!, runner))
  document.body.innerHTML += '<input type="file"><input id="text"><label for="text">Text field</label>'
  await expect(resolvePreviewUploadTarget({ kind: 'upload_files', selector: 'input[type=file]' })).rejects.toThrow(
    /exactly one/
  )
  await expect(resolvePreviewUploadTarget({ kind: 'upload_files', selector: 'label[for=text]' })).rejects.toThrow(
    /file input/
  )
  document.querySelector<HTMLInputElement>('#file')!.disabled = true
  await expect(resolvePreviewUploadTarget({ kind: 'upload_files', selector: '#file' })).rejects.toThrow(/enabled/)
})

it('keeps upload-label associations inside their ShadowRoot', async () => {
  const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
  cleanups.push(registerPreviewScriptRunner($rightRailActiveTabId.get()!, runner))
  const host = document.createElement('section')
  document.body.append(host)
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML =
    '<input id="file" type="file" hidden><label id="shadow-upload" for="file">Shadow attachment</label>'
  expect(await resolvePreviewUploadTarget({ kind: 'upload_files', selector: '#shadow-upload' })).toBe(
    'Shadow attachment'
  )
  expect((window as unknown as { __hermesActHolder: PreviewActHolder }).__hermesActHolder.aimed).toBe(
    shadow.querySelector('input')
  )
})
