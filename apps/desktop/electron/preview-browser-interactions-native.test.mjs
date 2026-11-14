import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { app, BrowserWindow, dialog, WebContentsView } from 'electron'
import { build } from 'esbuild'

import { failNativeFixtureWithoutDialog } from './preview-native-fixture-errors.mjs'
import { nativeFixtureRuntime } from './preview-native-fixture-runtime.mjs'
import { waitForNativePreviewDialog } from './preview-native-fixture-wait.mjs'

failNativeFixtureWithoutDialog(app)

const unattended = { owner_showed: false, message_box_calls: 0 }
app.on('browser-window-created', (_event, window) => {
  window.on('show', () => { unattended.owner_showed = true })
})
dialog.showMessageBox = async () => {
  unattended.message_box_calls++
  throw new Error('Native fixture attempted to open an OS message box')
}

function assertUnattended() {
  assert.equal(unattended.owner_showed, false, 'the fixture owner must remain hidden')
  assert.equal(unattended.message_box_calls, 0, 'the Aino dialog adapter must not call an OS message box')
}

const runtime = nativeFixtureRuntime()
let evidence = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'aino-browser-interactions-proof-'))
mkdirSync(evidence, { recursive: true })
evidence = realpathSync(evidence)
app.setPath('userData', runtime)
app.setPath('sessionData', runtime)
process.env.HERMES_HOME = join(runtime, 'home')
process.env.HERMES_RUNTIME_DIR = join(runtime, 'runtime')
const watchdog = setTimeout(() => { console.error('Browser interaction proof exceeded 55 seconds'); app.exit(1) }, 55_000)

async function run() {
  const bundle = join(runtime, 'interactions.mjs')
  await build({ stdin: { contents: `export * from './preview-browser-interactions.ts'; export * from './preview-guest-owner.ts'; export * from './download-options.ts'; export * from './preview-guest-throttle.ts'; export * from './preview-capture.ts'`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', external: ['electron'] })
  const { runPreviewBrowserInteraction, admitPreviewGuestSession, registerNativePreviewGuest, configureDownloadSaveDialog,
    beginPreviewGuestActivity, endPreviewGuestActivity, captureOwnedPreviewContents } = await import(pathToFileURL(bundle).href)
  const sockets = new Set()
  const server = createServer((request, response) => {
    if (request.url === '/download' || request.url === '/slow') {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="receipt.txt"',
        'content-length': request.url === '/slow' ? 10_000_000 : 16 })
      if (request.url === '/slow') response.write(Buffer.alloc(1024, 1))
      else response.end('download receipt')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'content-security-policy': "frame-src 'none'; script-src 'unsafe-inline'" })
    response.end('<!doctype html><title>Browser interaction proof</title><body><h1>Dialog and file proof</h1><input id="upload" type="file"><script>window.receipts={};receipts.onload=prompt("Initial website label", "private-default")</script>')
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const owner = new BrowserWindow({ show: false, width: 900, height: 650, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await owner.loadURL('data:text/html,<title>Interaction owner</title>')
  const preload = join(runtime, 'prompt-preload.cjs')
  await build({ entryPoints: [fileURLToPath(new URL('./preview-guest-preload-entry.ts', import.meta.url))], outfile: preload, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  const view = new WebContentsView({ webPreferences: { preload, partition: 'persist:hermes-preview-fixture', sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const guest = view.webContents
  guest.session.on('will-download', (_event, item) => configureDownloadSaveDialog(item, runtime))
  admitPreviewGuestSession(guest.session)
  const unregister = registerNativePreviewGuest(guest, owner.webContents)
  owner.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 900, height: 650 })
  guest.setWindowOpenHandler(() => ({ action: 'deny' }))
  const receipts = []
  const request = (action, params = {}) => runPreviewBrowserInteraction(owner.webContents, guest, { action, scope: 'fixture-profile/session/tab', ...params })
  const dialog = async (type, expression, response) => {
    const opened = new Promise(resolve => {
      const listener = (_event, method, params) => {
        if (method !== 'Page.javascriptDialogOpening') return
        guest.debugger.removeListener('message', listener)
        resolve(params)
      }
      guest.debugger.on('message', listener)
    })
    await guest.executeJavaScript(`setTimeout(() => { receipts.${type}=${expression}; }, 0); true`)
    await opened
    const { pending } = await waitForNativePreviewDialog(request)
    assert.ok(pending, `${type} is inspectable while JavaScript is blocked`)
    await request('dialog_respond', { dialogId: pending.id, ...response })
    receipts.push({ dialog: type, state: (await request('dialog_status')).dialogs.at(-1).state })
  }
  try {
    await guest.loadURL('about:blank')
    console.log('proof: arming native watcher')
    assert.equal((await request('watch')).dialog_control, 'aino', 'native dialog adapter must be active before opening a dialog')
    console.log('proof: loading initial prompt')
    const initialOpening = new Promise(resolve => {
      const listener = (_event, method) => {
        if (method !== 'Page.javascriptDialogOpening') return
        guest.debugger.removeListener('message', listener)
        resolve()
      }
      guest.debugger.on('message', listener)
    })
    const initialLoad = guest.loadURL(origin)
    await initialOpening
    console.log('proof: initial prompt opened')
    const { pending: initial } = await waitForNativePreviewDialog(request)
    assert.ok(initial, 'initial page-load prompt is inspectable before dom-ready')
    await request('dialog_manual', { dialogId: initial.id, accept: true, promptText: 'manual initial label' })
    console.log('proof: initial prompt responded')
    await initialLoad
    console.log('proof: initial document loaded')
    assert.equal(await guest.executeJavaScript('receipts.onload'), 'manual initial label')
    receipts.push({ dialog: 'onload', state: 'accepted', before_dom_ready: true })
    await dialog('confirm', 'confirm("Continue fixture?")', { accept: false })
    await dialog('prompt', 'prompt("Fixture label", "default")', { accept: true, promptText: 'approved label' })
    assert.deepEqual(await guest.executeJavaScript('receipts'), { onload: 'manual initial label', confirm: false, prompt: 'approved label' })

    console.log('proof: dialogs verified')
    const upload = join(runtime, 'upload-proof.txt')
    writeFileSync(upload, 'only fixture bytes')
    await guest.executeJavaScript('window.__hermesActHolder={aimed:document.querySelector("#upload")};true')
    console.log('proof: preparing stale upload')
    const staleUpload = await request('upload_prepare', { paths: [upload] })
    await guest.executeJavaScript('document.querySelector("#upload").setAttribute("data-replaced", "true");true')
    await assert.rejects(request('upload_commit', { ticket: staleUpload.ticket }), /changed|again|approval/i)
    assert.equal(await guest.executeJavaScript('document.querySelector("#upload").files.length'), 0)
    const prepared = await request('upload_prepare', { paths: [upload] })
    const uploaded = await request('upload_commit', { ticket: prepared.ticket })
    assert.equal(uploaded.upload.state, 'completed')
    assert.equal(await guest.executeJavaScript('document.querySelector("#upload").files[0].text()'), 'only fixture bytes')
    receipts.push({ upload: uploaded.upload.filenames, state: uploaded.upload.state })

    // A normal website button can open an otherwise hidden input's native chooser.
    const chooserOpened = new Promise(resolve => {
      const listener = (_event, method) => {
        if (method !== 'Page.fileChooserOpened') return
        guest.debugger.removeListener('message', listener)
        resolve()
      }
      guest.debugger.on('message', listener)
    })
    await guest.executeJavaScript('document.querySelector("#upload").hidden=true; document.querySelector("#upload").click();true', true)
    await chooserOpened
    const chooser = (await request('dialog_status')).file_chooser
    assert.equal(chooser.state, 'pending')
    const chooserUpload = await request('upload_prepare', { paths: [upload], chooserId: chooser.id })
    const chooserResult = await request('upload_commit', { ticket: chooserUpload.ticket })
    assert.equal(chooserResult.upload.state, 'completed')
    assert.equal((await request('dialog_status')).file_chooser.state, 'completed')
    receipts.push({ chooser_id: chooser.id, upload: chooserResult.upload.filenames, state: 'completed' })

    console.log('proof: uploads verified')
    const destination = join(evidence, `download-receipt-${Date.now()}.txt`)
    const saved = await request('download_prepare', { downloadPath: destination })
    await request('download_commit', { ticket: saved.ticket })
    const downloadStarted = once(guest.session, 'will-download')
    guest.downloadURL(`${origin}/download`)
    const [, item] = await downloadStarted
    await once(item, 'done')
    assert.equal(readFileSync(destination, 'utf8'), 'download receipt')
    const completed = (await request('downloads_status')).downloads.find(item => item.state === 'completed')
    assert.equal(completed.path, destination)
    receipts.push(completed)

    console.log('proof: download completed')
    const cancelledPath = join(runtime, 'cancelled-download.bin')
    const cancelledGrant = await request('download_prepare', { downloadPath: cancelledPath })
    await request('download_commit', { ticket: cancelledGrant.ticket })
    const pendingDownload = once(guest.session, 'will-download')
    guest.downloadURL(`${origin}/slow`)
    const [, slow] = await pendingDownload
    const stopped = once(slow, 'done')
    const active = (await request('downloads_status')).downloads.find(item => item.state === 'progressing')
    await request('download_cancel', { downloadId: active.id })
    await stopped
    receipts.push((await request('downloads_status')).downloads.find(item => item.id === active.id))
    assert.equal(receipts.at(-1).state, 'cancelled')

    let escaped = false
    guest.once('did-create-window', () => { escaped = true })
    await guest.executeJavaScript('window.open("https://example.invalid");true')
    assert.equal(escaped, false)
    const captureLease = beginPreviewGuestActivity(owner.webContents, guest, () => () => {})
    try {
      await guest.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
      const capture = await captureOwnedPreviewContents(owner.webContents, guest)
      writeFileSync(join(evidence, 'browser-interactions.png'), Buffer.from(capture.split(',')[1], 'base64'))
    } finally {
      await endPreviewGuestActivity(owner.webContents, captureLease)
    }
    assertUnattended()
    receipts.push({ ...unattended })
    writeFileSync(join(evidence, 'browser-interaction-receipts.json'), JSON.stringify(receipts, null, 2))
    console.log(JSON.stringify({ success: true, evidence, receipts, ...unattended }))
  } finally {
    await request('release')
    unregister()
    guest.close()
    owner.destroy()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    assertUnattended()
  }
}

app.whenReady().then(run).then(() => {
  clearTimeout(watchdog)
  app.exit(0)
}, error => {
  clearTimeout(watchdog)
  console.error(error)
  app.exit(1)
})
