import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { closeSync, lstatSync, openSync, realpathSync, unlinkSync } from 'node:fs'
import path from 'node:path'

import type { DownloadItem, WebContents } from 'electron'

import type {
  PreviewBrowserDialog,
  PreviewBrowserDownload,
  PreviewBrowserInteractionRequest,
  PreviewBrowserInteractionResult
} from '../shared/preview-browser-interactions'

import { createPreviewApproval } from './preview-approval'
import { PreviewBrowserChooser, type PreviewUploadTarget } from './preview-browser-chooser'
import { type DownloadGrant, PreviewBrowserFiles } from './preview-browser-files'
import { acquirePreviewGuestCdp, type PreviewGuestCdp } from './preview-guest-cdp'
import { isOwnedPreviewGuest, watchNativePreviewOwner } from './preview-guest-owner'
import { installPreviewNativeDialogAdapter } from './preview-native-dialog-adapter'

const trackers = new WeakMap<WebContents, PreviewBrowserInteractions>()
const SECRET_PROMPT = /password|passphrase|secret|verification|one.?time|authenticator|2fa|密码|验证码|口令/i
const HISTORY_LIMIT = 32

/** Native page events remain available while a JavaScript dialog blocks guest execution. */
export class PreviewBrowserInteractions {
  private cdp: PreviewGuestCdp
  private files = new PreviewBrowserFiles()
  private chooser: PreviewBrowserChooser
  private generation = 0
  private frameUrls = new Map<string, string>()
  private dialogs: PreviewBrowserDialog[] = []
  private dialogDefaults = new Map<string, string>()
  private initialization?: Promise<void>
  private restoreNativeDialogs?: () => void
  private nativeDialogResponses = new Map<string, (accept: boolean, text?: string) => void>()
  private dialogBindings = new Map<string, { generation: number; sessionId?: string }>()
  private downloads: PreviewBrowserDownload[] = []
  private activeDownloads = new Map<string, { item: DownloadItem; automatic: boolean; reserved?: string }>()
  private uploadNodes = new Map<
    string,
    PreviewUploadTarget & { approval: Awaited<ReturnType<typeof createPreviewApproval>> }
  >()
  private nextDownload?: DownloadGrant
  private authorization?: string
  private cleanup: Array<() => void> = []
  private disposed = false

  constructor(
    private owner: WebContents,
    private guest: WebContents,
    readonly scope: string
  ) {
    this.cdp = acquirePreviewGuestCdp(owner, guest)
    this.restoreNativeDialogs = installPreviewNativeDialogAdapter(owner, guest, request => {
      if (this.disposed) { request.respond(false);

 return }

      const dialog = this.openDialog({ type: request.type, message: request.message, url: request.url, defaultPrompt: request.defaultText })
      this.nativeDialogResponses.set(dialog.id, request.respond)
    })
    this.chooser = new PreviewBrowserChooser(this.cdp, chooser => {
      if (!this.disposed) {
        owner.send('hermes:preview-file-chooser', { webContentsId: guest.id, scope, chooser })
      }
    })
    this.cleanup.push(this.cdp.listen((method, params, sessionId) => this.message(method, params, sessionId)))
    const navigate = () => this.retireDocument(true)
    const inPage = (_event: Electron.Event, _url: string, main: boolean) => this.retireDocument(main)
    const dispose = () => this.dispose()
    const cancelDialogs = () => this.retireDialogs()
    const dialogEvents = guest as unknown as EventEmitter
    dialogEvents.on('-cancel-dialogs', cancelDialogs)
    guest.on('did-navigate', navigate)
    guest.on('did-navigate-in-page', inPage)
    guest.once('destroyed', dispose)
    owner.once('destroyed', dispose)
    this.cleanup.push(
      () => { dialogEvents.removeListener('-cancel-dialogs', cancelDialogs) },
      () => guest.removeListener('did-navigate', navigate),
      () => guest.removeListener('did-navigate-in-page', inPage),
      () => guest.removeListener('destroyed', dispose),
      () => owner.removeListener('destroyed', dispose),
      watchNativePreviewOwner(guest, dispose)
    )

    const download = (_event: Electron.Event, item: DownloadItem, source: WebContents) => {
      if (source === guest && !this.disposed) {
        this.trackDownload(item)
      }
    }

    const guestSession = guest.session
    guestSession.on('will-download', download)
    this.cleanup.push(() => guestSession.removeListener('will-download', download))
  }

  ready(): Promise<void> {
    this.initialization ??= (async () => {
      await this.cdp.sendCommand('Page.enable')
      const { frameTree } = await this.cdp.sendCommand('Page.getFrameTree')
      this.rememberFrameUrls(frameTree)
      await this.chooser.ready()
    })()

    return this.initialization
  }

  private rememberFrameUrls(tree: any): void {
    if (!tree?.frame) {
      return
    }

    this.frameUrls.set(tree.frame.id, tree.frame.url)

    for (const child of tree.childFrames ?? []) {
      this.rememberFrameUrls(child)
    }
  }

  private guard(): void {
    if (this.disposed || !isOwnedPreviewGuest(this.owner, this.guest)) {
      throw new Error('Browser page ownership changed')
    }
  }

  private retireDocument(dialogs = false): void {
    this.generation++

    if (dialogs) {this.retireDialogs()}
    this.chooser.retire()
    this.revokeFiles()
  }

  private retireDialogs(): void {
    this.cancelNativeDialogs()

    for (const dialog of this.dialogs) {
      if (dialog.state === 'pending') {
        dialog.state = 'closed'
        this.publishDialog(dialog)
      }
    }

    this.dialogBindings.clear()
    this.dialogDefaults.clear()
  }

  private publishDialog(dialog: PreviewBrowserDialog, defaultText?: string): void {
    if (this.owner.isDestroyed() || this.guest.isDestroyed()) {return}
    this.owner.send('hermes:preview-browser-dialog', {
      webContentsId: this.guest.id, scope: this.scope, dialog: { ...dialog }, defaultText
    })
  }

  private revokeFiles(): void {
    this.files.clear()
    this.nextDownload = undefined

    for (const node of this.uploadNodes.values()) {
      void node.approval.release().catch(error => console.warn('Could not release Browser upload approval', error))
    }

    this.uploadNodes.clear()
  }

  private cancelNativeDialogs(): void {
    const pending = [...this.nativeDialogResponses.values()]
    this.nativeDialogResponses.clear()

    for (const respond of pending) {respond(false)}
  }

  private openDialog(params: Record<string, unknown>, sessionId?: string, publish = true): PreviewBrowserDialog {
    const type = String(params.type ?? 'alert')

    const dialog: PreviewBrowserDialog = {
      id: randomUUID(),
      type,
      message: String(params.message ?? '').slice(0, 4000),
      url: String(params.url ?? this.guest.getURL()).slice(0, 8192),
      sensitive:
        type === 'confirm' ||
        type === 'beforeunload' ||
        (type === 'prompt' && SECRET_PROMPT.test(String(params.message ?? ''))),
      state: 'pending'
    }

    const alreadyPending = this.dialogs.some(previous => previous.state === 'pending')

    if (type === 'prompt') {
      this.dialogDefaults.set(dialog.id, String(params.defaultPrompt ?? ''))
    }

    this.dialogs.push(dialog)
    this.dialogBindings.set(dialog.id, { generation: this.generation, sessionId })
    this.dialogs = [...this.dialogs.filter(item => item.state !== 'pending').slice(-HISTORY_LIMIT),
      ...this.dialogs.filter(item => item.state === 'pending')]

    // Page.enable observes Blink dialogs; the guest preload restores Electron's disabled native prompt.
    // A separate IPC notification does not need to run JavaScript in the blocked guest.
    if (publish && !alreadyPending) {this.publishDialog(dialog, this.dialogDefaults.get(dialog.id))}

    return dialog
  }

  private rememberTargetUrl(params: Record<string, unknown>): void {
    const target = params.targetInfo as { targetId?: string; type?: string; url?: string } | undefined

    if (target?.type === 'iframe' && target.targetId && target.url) {this.frameUrls.set(target.targetId, target.url)}
  }

  private message(method: string, params: Record<string, unknown>, sessionId?: string): void {
    if (method === 'Target.attachedToTarget' || method === 'Target.targetInfoChanged') {this.rememberTargetUrl(params)}

    if (method === 'Page.frameNavigated') {
      this.rememberFrameUrls({ frame: params.frame })
    }

    if (method === 'Page.frameDetached' && params.reason !== 'swap') {
      this.frameUrls.delete(String(params.frameId))
    }

    if (method === 'Page.fileChooserOpened') {
      this.chooser.opened(
        params,
        this.generation,
        this.frameUrls.get(String(params.frameId)) ?? this.guest.getURL(),
        sessionId
      )
    }

    if (
      method === 'Page.frameNavigated' ||
      method === 'Page.navigatedWithinDocument' ||
      method === 'Page.frameDetached'
    ) {
      this.retireDocument()
    }

    if (method === 'Page.javascriptDialogOpening' && (!this.restoreNativeDialogs || params.type === 'beforeunload')) {
      this.openDialog(params, sessionId, Boolean(this.restoreNativeDialogs))
    } else if (method === 'Page.javascriptDialogClosed') {
      const pending = this.dialogs.findLast(dialog => dialog.state === 'pending' && (dialog.type === 'beforeunload' || !this.restoreNativeDialogs))

      if (pending) {
        pending.state = params.result === true ? 'accepted' : 'dismissed'
        this.publishDialog(pending)
      }
    }
  }

  private trackDownload(item: DownloadItem): void {
    const record: PreviewBrowserDownload = {
      id: randomUUID(),
      url: item.getURL().slice(0, 8192),
      filename: item.getFilename(),
      state: 'progressing',
      received_bytes: item.getReceivedBytes(),
      total_bytes: item.getTotalBytes()
    }

    const grant = this.nextDownload
    this.nextDownload = undefined
    const automatic = Boolean(grant && grant.generation === this.generation && Date.now() < grant.expires)
    const live = { item, automatic, reserved: undefined as string | undefined }
    this.downloads.push(record)
    this.downloads = this.downloads.slice(-HISTORY_LIMIT)
    this.activeDownloads.set(record.id, live)
    item.on('updated', (_event, state) => {
      record.state = state
      record.received_bytes = item.getReceivedBytes()
      record.total_bytes = item.getTotalBytes()
    })
    item.once('done', (_event, state) => {
      record.state = state
      record.received_bytes = item.getReceivedBytes()
      record.total_bytes = item.getTotalBytes()

      if (state === 'completed') {
        record.path = item.getSavePath()
      } else if (live.reserved) {
        try {
          unlinkSync(live.reserved)
        } catch {
          /* Chromium may already have removed its partial file. */
        }
      }

      this.activeDownloads.delete(record.id)
    })

    if (automatic && grant) {
      try {
        const parentPath = path.dirname(grant.path)
        const parent = lstatSync(parentPath)

        if (
          realpathSync(parentPath) !== parentPath ||
          !parent.isDirectory() ||
          parent.ino !== grant.parentIno ||
          parent.dev !== grant.parentDev
        ) {
          throw new Error('Download folder changed after approval')
        }

        // Reserve exactly the approved filename; an existing file is never overwritten.
        closeSync(openSync(grant.path, 'wx', 0o600))
        live.reserved = grant.path
        item.setSavePath(grant.path)
      } catch {
        record.state = 'cancelled'
        item.cancel()
      }
    }
  }

  private async uploadTarget(chooserId?: string): Promise<PreviewUploadTarget> {
    if (chooserId) {
      return this.chooser.target(chooserId, this.generation)
    }

    const response = await this.cdp.sendCommand('Runtime.evaluate', {
      expression: 'window.__hermesActHolder && window.__hermesActHolder.aimed',
      returnByValue: false
    })

    const objectId = response.result?.objectId

    if (!objectId) {
      throw new Error('Locate a file input or open the website file chooser before uploading')
    }

    return { objectId }
  }

  private async prepareUpload(
    paths: unknown,
    chooserId?: string,
    existingApproval?: Awaited<ReturnType<typeof createPreviewApproval>>
  ): Promise<PreviewBrowserInteractionResult> {
    const generation = this.generation
    const authorization = this.authorization
    const target = await this.uploadTarget(chooserId)
    let preparedTicket: string | undefined

    try {
      const { node } = await this.cdp.sendCommand('DOM.describeNode', { objectId: target.objectId }, target.sessionId)
      const attrs: Record<string, string> = {}

      for (let index = 0; index < (node.attributes?.length ?? 0); index += 2) {
        attrs[node.attributes[index]] = node.attributes[index + 1]
      }

      if (node.localName !== 'input' || attrs.type?.toLowerCase() !== 'file' || 'disabled' in attrs) {
        throw new Error('Upload target must be an enabled file input')
      }

      const prepared = await this.files.prepareUpload(paths, generation)
      preparedTicket = prepared.ticket

      if (prepared.paths.length > 1 && !('multiple' in attrs)) {
        throw new Error('This upload input accepts one file only')
      }

      this.guard()

      if (generation !== this.generation) {
        throw new Error('The upload page changed')
      }

      const approval = existingApproval ?? (await createPreviewApproval(this.owner, this.guest))

      if (generation !== this.generation || authorization !== this.authorization) {
        await approval.release()
        throw new Error('The upload page or control changed')
      }

      this.uploadNodes.set(prepared.ticket, { ...target, approval })

      return {
        success: true,
        url: chooserId ? this.chooser.status()?.url : this.guest.getURL(),
        ticket: prepared.ticket,
        upload: { state: 'prepared', paths: prepared.paths, filenames: prepared.filenames }
      }
    } catch (error) {
      if (preparedTicket) {this.files.cancelUpload(preparedTicket)}
      await this.cdp.sendCommand('Runtime.releaseObject', { objectId: target.objectId }, target.sessionId)
        .catch(releaseError => console.warn('Could not release Browser upload target', releaseError))
      throw error
    }
  }

  private async manualUpload(request: PreviewBrowserInteractionRequest): Promise<PreviewBrowserInteractionResult> {
    const chooserId = request.chooserId ?? ''
    const generation = this.generation
    const authorization = this.authorization
    this.chooser.assert(chooserId, generation)
    const approval = await createPreviewApproval(this.owner, this.guest)
    let transferred = false

    try {
      const paths = await this.chooser.choose(this.owner, chooserId, generation)
      this.guard()

      if (authorization !== this.authorization) {
        throw new Error('Browser upload control changed while choosing files')
      }

      if (!paths) {
        await this.chooser.cancel(chooserId, generation)

        return { success: true, file_chooser: this.chooser.status() }
      }

      const prepared = await this.prepareUpload(paths, chooserId, approval)
      transferred = true

      return this.commitUpload({ ...request, ticket: prepared.ticket })
    } finally {
      if (!transferred) {
        await approval.release()
      }
    }
  }

  private publishNextDialog(): void {
    const next = this.dialogs.find(dialog => dialog.state === 'pending')

    if (next) {this.publishDialog(next, this.dialogDefaults.get(next.id))}
  }

  private finishDialog(dialog: PreviewBrowserDialog, state: PreviewBrowserDialog['state']): void {
    dialog.state = state
    this.dialogDefaults.delete(dialog.id)
    this.dialogBindings.delete(dialog.id)
    this.publishDialog(dialog)
    this.publishNextDialog()
  }

  private respondNativeDialog(dialog: PreviewBrowserDialog, request: PreviewBrowserInteractionRequest,
    respond: (accept: boolean, text?: string) => void): void {
    this.nativeDialogResponses.delete(dialog.id)

    try {
      respond(request.accept!, request.promptText ?? this.dialogDefaults.get(dialog.id))
    } catch (error) {
      this.finishDialog(dialog, 'closed')
      throw error
    }

    this.finishDialog(dialog, request.accept ? 'accepted' : 'dismissed')
  }

  private async respondDialog(request: PreviewBrowserInteractionRequest): Promise<PreviewBrowserInteractionResult> {
    const dialog = this.dialogs.find(item => item.id === request.dialogId && item.state === 'pending')
    const binding = this.dialogBindings.get(request.dialogId ?? '')
    const nativeResponse = this.nativeDialogResponses.get(request.dialogId ?? '')

    if (!dialog || !binding || (!nativeResponse && binding.generation !== this.generation) || typeof request.accept !== 'boolean') {
      throw new Error('The named dialog is no longer pending')
    }

    if (dialog.type === 'prompt' && dialog.sensitive && request.accept && request.action !== 'dialog_manual') {
      throw new Error('Enter sensitive prompt text directly in the website dialog; the agent cannot supply it')
    }

    if (nativeResponse) {
      this.respondNativeDialog(dialog, request, nativeResponse)
    } else if (dialog.type === 'beforeunload') {
      await this.cdp.sendCommand('Page.handleJavaScriptDialog', { accept: request.accept }, binding.sessionId)
      this.finishDialog(dialog, request.accept ? 'accepted' : 'dismissed')
    } else {
      throw new Error('This Electron build requires responding through the website system dialog')
    }

    return { success: true, dialogs: [{ ...dialog }] }
  }

  private async commitUpload(request: PreviewBrowserInteractionRequest): Promise<PreviewBrowserInteractionResult> {
    const ticket = request.ticket ?? ''
    const target = this.uploadNodes.get(ticket)
    this.uploadNodes.delete(ticket)

    if (!target) {
      throw new Error('Upload authorization is unavailable')
    }

    const { objectId, approval, sessionId, chooserId } = target

    try {
      const paths = await this.files.consumeUpload(ticket, this.generation)

      const { result } = await this.cdp.sendCommand(
        'Runtime.callFunctionOn',
        {
          objectId,
          functionDeclaration: 'function(){return this.isConnected && this.type === "file" && !this.disabled}',
          returnByValue: true
        },
        sessionId
      )

      if (result?.value !== true) {
        throw new Error('The approved upload input changed')
      }

      await approval.validate()
      this.guard()

      if (chooserId) {
        this.chooser.assert(chooserId, this.generation)
      }

      await this.cdp.sendCommand('DOM.setFileInputFiles', { files: paths, objectId }, sessionId)

      if (chooserId) {
        this.chooser.finish(chooserId, this.generation, 'completed')
      }

      return {
        success: true,
        url: this.guest.getURL(),
        upload: { state: 'completed', paths, filenames: paths.map(value => path.basename(value)) }
      }
    } finally {
      await approval.release()
      void this.cdp.sendCommand('Runtime.releaseObject', { objectId }, sessionId).catch(() => undefined)
    }
  }

  private cancelDownload(request: PreviewBrowserInteractionRequest): PreviewBrowserInteractionResult {
    const download = this.activeDownloads.get(request.downloadId ?? '')

    if (!download) {
      throw new Error('The download is no longer active')
    }

    download.item.cancel()
    const receipt = this.downloads.find(item => item.id === request.downloadId)

    if (receipt && receipt.state !== 'completed') {
      receipt.state = 'cancelled'
    }

    return {
      success: true,
      downloads: this.downloads.filter(item => item.id === request.downloadId).map(item => ({ ...item }))
    }
  }

  private async cancelUpload(ticket = ''): Promise<PreviewBrowserInteractionResult> {
    const target = this.uploadNodes.get(ticket)
    this.uploadNodes.delete(ticket)
    this.files.cancelUpload(ticket)

    if (target) {
      await target.approval.release()
      await this.cdp.sendCommand('Runtime.releaseObject', { objectId: target.objectId }, target.sessionId)
    }

    return { success: true }
  }

  private commitDownload(ticket = ''): PreviewBrowserInteractionResult {
    this.nextDownload = this.files.consumeDownload(ticket, this.generation)

    return { success: true, download_path: this.nextDownload.path }
  }

  private dialogControl(): 'aino' | 'system' {
    return this.restoreNativeDialogs ? 'aino' : 'system'
  }

  private dialogStatus(): PreviewBrowserInteractionResult {
    return {
      success: true, url: this.guest.getURL(),
      dialog_control: this.dialogControl(),
      note: this.restoreNativeDialogs ? undefined : 'Automated dialog control is unavailable in this Electron build. Use the website system dialog manually.',
      dialogs: this.dialogs.map(dialog => ({ ...dialog })), file_chooser: this.chooser.status()
    }
  }

  async run(request: PreviewBrowserInteractionRequest): Promise<PreviewBrowserInteractionResult> {
    this.guard()

    if (request.authorization !== undefined && request.authorization !== this.authorization) {
      this.revokeFiles()
      this.authorization = request.authorization
    }

    switch (request.action) {
      case 'watch':
        return { success: true, dialog_control: this.dialogControl() }

      case 'revoke':
        this.revokeFiles()

        return { success: true }

      case 'dialog_status':
        return this.dialogStatus()

      case 'dialog_manual_status':
        return { success: true, default_text: this.dialogDefaults.get(request.dialogId ?? '') }

      case 'dialog_manual':

      case 'dialog_respond':
        return this.respondDialog(request)

      case 'upload_prepare':
        return this.prepareUpload(request.paths, request.chooserId)

      case 'chooser_manual':
        return this.manualUpload(request)

      case 'chooser_cancel':
        await this.chooser.cancel(request.chooserId ?? '', this.generation)

        return { success: true, file_chooser: this.chooser.status() }

      case 'upload_commit':
        return this.commitUpload(request)

      case 'upload_cancel':
        return this.cancelUpload(request.ticket)
      case 'download_prepare': {
        const prepared = await this.files.prepareDownload(request.downloadPath, this.generation)

        return { success: true, ticket: prepared.ticket, download_path: prepared.path, url: this.guest.getURL() }
      }

      case 'download_commit':
        return this.commitDownload(request.ticket)

      case 'downloads_status':
        return { success: true, downloads: this.downloads.map(download => ({ ...download })) }

      case 'download_cancel':
        return this.cancelDownload(request)

      default:
        throw new Error('Unsupported native browser operation')
    }
  }

  hasPendingDialog(): boolean {
    return this.dialogs.some(dialog => dialog.state === 'pending')
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.cancelNativeDialogs()
    this.restoreNativeDialogs?.()
    this.restoreNativeDialogs = undefined

    for (const download of this.activeDownloads.values()) {
      if (download.automatic) {
        download.item.cancel()
      }
    }

    this.nextDownload = undefined
    this.files.clear()

    for (const node of this.uploadNodes.values()) {
      void node.approval.release().catch(error => console.warn('Could not release Browser upload approval', error))
    }

    this.uploadNodes.clear()

    for (const clean of this.cleanup.splice(0)) {
      clean()
    }

    this.chooser.dispose()
    this.cdp.release()

    if (trackers.get(this.guest) === this) {
      trackers.delete(this.guest)
    }
  }
}

export async function runPreviewBrowserInteraction(
  owner: WebContents,
  guest: WebContents,
  request: PreviewBrowserInteractionRequest
): Promise<PreviewBrowserInteractionResult> {
  if (
    !request ||
    typeof request.scope !== 'string' ||
    !request.scope ||
    request.scope.length > 4096 ||
    !isOwnedPreviewGuest(owner, guest)
  ) {
    throw new Error('Invalid Browser interaction owner')
  }

  let tracker = trackers.get(guest)

  if (request.action === 'release') {
    if (tracker?.scope === request.scope) {
      tracker.dispose()
    }

    return { success: true }
  }

  if (tracker && tracker.scope !== request.scope) {
    tracker.dispose()
    tracker = undefined
  }

  if (!tracker) {
    tracker = new PreviewBrowserInteractions(owner, guest, request.scope)
    trackers.set(guest, tracker)

    try {
      await tracker.ready()
    } catch (error) {
      tracker.dispose()
      throw error
    }
  }

  await tracker.ready()

  return tracker.run(request)
}

export function assertPreviewBrowserDialogResolved(guest: WebContents): void {
  if (trackers.get(guest)?.hasPendingDialog()) {
    throw new Error('Resolve the website dialog before moving this Browser tab')
  }
}
