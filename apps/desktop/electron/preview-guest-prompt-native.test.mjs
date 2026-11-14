import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const evidence = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'aino-frame-prompt-proof-')))
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'frame-prompt-receipts.json'), { force: true })
app.setPath('userData', runtime)
app.setPath('sessionData', runtime)
process.env.HERMES_HOME = join(runtime, 'home')
process.env.HERMES_RUNTIME_DIR = join(runtime, 'runtime')
app.commandLine.appendSwitch('site-per-process')
const watchdog = setTimeout(() => { console.error('Frame prompt proof exceeded 40 seconds'); app.exit(1) }, 40_000)

async function run() {
  const bundle = join(runtime, 'interactions.mjs')
  await build({ stdin: { contents: `export * from './preview-browser-interactions.ts';export * from './preview-guest-owner.ts'`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', external: ['electron'] })
  const { runPreviewBrowserInteraction, admitPreviewGuestSession, registerNativePreviewGuest } = await import(pathToFileURL(bundle).href)
  const preload = join(runtime, 'preload.cjs')
  await build({ entryPoints: [fileURLToPath(new URL('./preview-guest-preload-entry.ts', import.meta.url))], outfile: preload, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  let port
  const sockets = new Set()
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    if (request.url.startsWith('/child')) {
      const name = new URL(request.url, 'http://fixture').searchParams.get('name')
      response.end(`<!doctype html><title>${name}</title><input type='file' id='upload'><script>window.result=prompt(${JSON.stringify(name)},'default-private');parent.postMessage({name:${JSON.stringify(name)},result},'*')</script>`)
    } else response.end(`<!doctype html><title>Frame prompts</title><script>window.receipts=[];addEventListener('message',e=>receipts.push(e.data))</script><iframe src='/child?name=same'></iframe><iframe sandbox='allow-scripts allow-modals' src='/child?name=sandbox'></iframe><iframe src='http://localhost:${port}/child?name=oopif'></iframe><iframe sandbox='allow-scripts' src='/child?name=restricted'></iframe>`)
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  server.listen(0, '0.0.0.0')
  await once(server, 'listening')
  port = server.address().port
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await owner.loadURL('data:text/html,<title>Owner</title>')
  const view = new WebContentsView({ webPreferences: { preload, partition: 'persist:hermes-preview-frame-prompt', sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const guest = view.webContents
  admitPreviewGuestSession(guest.session)
  const unregister = registerNativePreviewGuest(guest, owner.webContents)
  owner.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 900, height: 650 })
  guest.setWindowOpenHandler(() => ({ action: 'deny' }))
  const request = (action, params = {}) => runPreviewBrowserInteraction(owner.webContents, guest, { action, scope: 'frame-proof', ...params })
  const observed = []
  let respondError
  const responses = []
  guest.on('console-message', event => console.log('guest:', event.message))
  try {
    await guest.loadURL('about:blank')
    assert.equal((await request('watch')).dialog_control, 'aino', 'native dialog adapter must be active before opening a dialog')
    const trace = []
    const record = (event, details) => {
      const entry = { event, ...details }
      trace.push(entry)
      console.log('frame-prompt event:', JSON.stringify(entry))
    }
    guest.on('-run-dialog', info => record('native-open', {
      type: info.dialogType,
      message: info.messageText,
      url: info.frame?.url,
      process_id: info.frame?.processId,
      detached: info.frame?.detached
    }))
    guest.on('-cancel-dialogs', info => record('native-cancel', { resetState: info?.resetState }))
    guest.on('did-navigate', (_event, url) => record('navigate', { url }))
    guest.debugger.on('message', (_event, method, params, sessionId) => {
      if (method === 'Page.javascriptDialogOpening' || method === 'Page.javascriptDialogClosed') {
        record(method, { message: params.message, url: params.url, frame: params.frameId, sessionId, result: params.result })
      }
      if (method !== 'Page.javascriptDialogOpening') return
      const response = (async () => {
        let lastStatus
        const { status, pending: dialog } = await waitForNativePreviewDialog(async action => {
          const result=await request(action)
          lastStatus = result
          return {...result,dialogs:result.dialogs?.filter(item=>item.message===params.message&&item.url===params.url)}
        }).catch(error => {
          console.error('frame-prompt unmatched:', JSON.stringify({ expected: { message: params.message, url: params.url, sessionId }, status: lastStatus, trace }))
          throw error
        })
        console.log('prompt:', params.message, sessionId)
        assert.ok(dialog, 'frame dialog reaches native receipt')
        assert.equal(JSON.stringify(status).includes('default-private'), false)
        observed.push({ name: params.message, url: dialog.url, frame: params.frameId, child_session: Boolean(sessionId) })
        await request('dialog_manual', { dialogId: dialog.id, accept: true, promptText: `response-${params.message}` })
      })().catch(error => { respondError = error; console.error(error) })
      responses.push(response)
    })
    await guest.loadURL(`http://127.0.0.1:${port}/`)
    await Promise.all(responses)
    if (respondError) throw respondError
    const receipts = await guest.executeJavaScript('receipts')
    const frames = guest.mainFrame.framesInSubtree.map(frame => ({ url: frame.url, process_id: frame.processId }))
    console.log(JSON.stringify({ observed, receipts, frames }))
    assert.deepEqual(observed.map(item => item.name).sort(), ['oopif', 'same', 'sandbox'])
    const mainProcess = frames.find(frame => frame.url === `http://127.0.0.1:${port}/`).process_id
    assert.notEqual(frames.find(frame => frame.url.includes('localhost')).process_id, mainProcess, 'cross-site prompt executes in a distinct renderer process')
    assert.deepEqual(receipts.sort((a, b) => a.name.localeCompare(b.name)), ['oopif', 'restricted', 'same', 'sandbox'].map(name => ({ name, result: name === 'restricted' ? null : `response-${name}` })))
    const uploadFile = join(runtime, 'frame-upload.txt')
    writeFileSync(uploadFile, 'only cross-origin fixture bytes')
    const child = guest.mainFrame.framesInSubtree.find(frame => frame.url.includes('localhost'))
    const opened = new Promise(resolve => {
      const listener = (_event, method, params, sessionId) => {
        if (method !== 'Page.fileChooserOpened') return
        guest.debugger.removeListener('message', listener)
        resolve({ params, sessionId })
      }
      guest.debugger.on('message', listener)
    })
    await child.executeJavaScript('document.querySelector("#upload").click();true', true)
    const chooserEvent = await opened
    const chooser = (await request('dialog_status')).file_chooser
    assert.equal(chooser.state, 'pending')
    assert.ok(chooserEvent.sessionId, 'cross-origin chooser is received on its owned child session')
    assert.equal(new URL(chooser.url).hostname, 'localhost', 'approval names the actual upload frame origin')
    const prepared = await request('upload_prepare', { paths: [uploadFile], chooserId: chooser.id })
    const uploaded = await request('upload_commit', { ticket: prepared.ticket })
    assert.equal(uploaded.upload.state, 'completed')
    assert.equal(await child.executeJavaScript('document.querySelector("#upload").files[0].text()'), 'only cross-origin fixture bytes')
    const upload = { state: uploaded.upload.state, filenames: uploaded.upload.filenames, frame_url: chooser.url,
      child_session: chooserEvent.sessionId, frame: chooserEvent.params.frameId }
    console.log(JSON.stringify({ upload }))
    assertUnattended()
    writeFileSync(join(evidence, 'frame-prompt-receipts.json'), JSON.stringify({ observed, receipts, frames, upload, ...unattended }, null, 2))
  } finally {
    await request('release').catch(() => {})
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
}, error => { clearTimeout(watchdog); console.error(error); app.exit(1) })
