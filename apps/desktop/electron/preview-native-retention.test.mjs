import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { app, BrowserWindow, dialog, WebContentsView } from 'electron'
import { build } from 'esbuild'

// Runs the production service with real native views; no debugger or emulated DOM.
import { failNativeFixtureWithoutDialog } from './preview-native-fixture-errors.mjs'
import { nativeFixtureRuntime } from './preview-native-fixture-runtime.mjs'

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
  assert.equal(unattended.owner_showed, false, 'all fixture windows must remain hidden')
  assert.equal(unattended.message_box_calls, 0, 'the native fixture must not call an OS message box')
}

const runtimeDir = nativeFixtureRuntime()
const evidenceDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'aino-preview-retention-proof-'))
mkdirSync(evidenceDir, { recursive: true })
app.setPath('userData', runtimeDir)
app.setPath('sessionData', runtimeDir)
process.env.HERMES_HOME = join(runtimeDir, 'home')
process.env.HERMES_RUNTIME_DIR = join(runtimeDir, 'runtime')
const watchdog = setTimeout(() => {
  console.error('Native Browser retention fixture exceeded 45 seconds')
  app.exit(1)
}, 45_000)

async function run() {
  const bundle = join(runtimeDir, 'preview-service.mjs')
  await build({
    stdin: {
      contents: `export * from './preview-native.ts'; export * from './preview-guest-owner.ts';
        export * from './preview-guest-throttle.ts'; export * from './preview-capture.ts';`,
      resolveDir: fileURLToPath(new URL('.', import.meta.url))
    },
    outfile: bundle, platform: 'node', format: 'esm', bundle: true, external: ['electron']
  })
  const {
    registerNativePreviewIpc, authorizeNativePreviewPopout, admitPreviewGuestSession,
    beginPreviewGuestActivity, endPreviewGuestActivity, executePreviewGuestScript, captureOwnedPreviewContents
  } = await import(pathToFileURL(bundle).href)
  let pageRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/download') {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="retention.txt"' })
      response.end('Disposable retained-page download')
      return
    }
    if (request.url === '/page') pageRequests++
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Native retention</title><body style="height:3000px"><input id="draft"><script>window.nonce=Math.random()</script></body>')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/page`
  const source = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await source.loadURL('data:text/html,<title>Source renderer</title>')
  const handlers = new Map()
  const events = new Map()
  const views = []
  const popups = []
  const dispose = registerNativePreviewIpc({
    handle: (name, handler) => handlers.set(name, handler),
    on: (name, handler) => events.set(name, handler)
  }, {
    fromWebContents: contents => BrowserWindow.fromWebContents(contents),
    resolvePartition: partition => partition,
    createView: partition => {
      const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true } })
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      admitPreviewGuestSession(view.webContents.session)
      views.push(view)
      return view
    }
  })
  const invoke = (name, owner, ...args) => handlers.get(`hermes:preview-native:${name}`)({ sender: owner.webContents }, ...args)
  const bounds = { x: 20, y: 70, width: 800, height: 600 }
  const request = { tabId: 'retained-tab', partition: 'persist:hermes-preview', url, bounds }
  const readState = guest => guest.executeJavaScript(`JSON.stringify({ nonce, draft:document.querySelector('#draft').value,
    scroll:scrollY, count:history.length, hash:location.hash, state:history.state, cookie:document.cookie })`)
  const evidence = []
  const installRetiredOverlay = guest => guest.executeJavaScript(`(() => {
    window.__hermesAnnotateSession=99;
    window.__hermesAnnotate={teardown(){window.annotationTeardowns=(window.annotationTeardowns||0)+1;document.querySelector('#retired-overlay')?.remove()}};
    const overlay=document.createElement('div');overlay.id='retired-overlay';document.body.append(overlay);return true
  })()`)
  const assertRetired = async (owner, guest, count) => {
    const lease = beginPreviewGuestActivity(owner.webContents, guest, () => () => {})
    const actual = JSON.parse(await executePreviewGuestScript(owner.webContents, lease, `JSON.stringify({
      overlay:!!window.__hermesAnnotate, session:window.__hermesAnnotateSession,
      node:!!document.querySelector('#retired-overlay'), count:window.annotationTeardowns})`))
    assert.deepEqual(actual, { overlay:false, session:0, node:false, count })
  }

  try {
    let current = invoke('mount', source, request)
    const guest = views[0].webContents
    if (guest.isLoadingMainFrame() || !guest.getURL()) await once(guest, 'did-stop-loading')
    await guest.executeJavaScript(`document.querySelector('#draft').value='Unsaved draft';history.pushState({step:1},'', '#route-one');
      document.cookie='ainoFixture=retained; SameSite=Lax';scrollTo(0,817);true`)
    await invoke('command', source, current.token, 'setPageZoom', [1.15])
    const originalId = guest.id
    let retained = await readState(guest)
    const originalRequests = pageRequests

    for (let round = 1; round <= 3; round++) {
      const popup = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
      popups.push(popup)
      await popup.loadURL('data:text/html,<title>Popup renderer</title>')
      const oldLease = beginPreviewGuestActivity(source.webContents, guest, () => () => {})
      await installRetiredOverlay(guest)
      authorizeNativePreviewPopout(source.webContents, popup, request.tabId)
      invoke('release', source, current.token)
      current = invoke('mount', popup, request)
      assert.equal(current.webContentsId, originalId)
      assert.equal(current.zoom, 1.15)
      assert.equal(await readState(guest), retained)
      await assertRetired(popup, guest, round * 2 - 1)
      assert.equal(pageRequests, originalRequests)
      assert.throws(() => beginPreviewGuestActivity(source.webContents, guest, () => () => {}), /does not belong/)
      await assert.rejects(captureOwnedPreviewContents(source.webContents, guest), /does not belong/)
      await assert.rejects(executePreviewGuestScript(source.webContents, oldLease, 'true'), /does not belong|unavailable/)
      endPreviewGuestActivity(source.webContents, oldLease)
      const newLease = beginPreviewGuestActivity(popup.webContents, guest, () => () => {})
      assert.equal(await executePreviewGuestScript(popup.webContents, newLease, 'window.nonce'), JSON.parse(retained).nonce)
      const captureLease = beginPreviewGuestActivity(popup.webContents, guest, () => () => {})
      assert.match(await captureOwnedPreviewContents(popup.webContents, guest), /^data:image\/png;base64,/)
      endPreviewGuestActivity(popup.webContents, captureLease)
      await guest.executeJavaScript(`document.querySelector('#draft').value='Popup edit ${round}';true`)
      retained = await readState(guest)
      await installRetiredOverlay(guest)
      const closed = once(popup, 'closed')
      popup.close()
      await closed
      current = invoke('mount', source, request)
      assert.equal(current.webContentsId, originalId)
      assert.equal(await readState(guest), retained)
      assert.equal(pageRequests, originalRequests)
      assert.equal(guest.isDestroyed(), false)
      await assertRetired(source, guest, round * 2)
      evidence.push({ round, webContentsId: guest.id, state: JSON.parse(retained), pageRequests, zoom: guest.getZoomFactor(), annotationTeardowns: round * 2 })
    }

    const downloadPath = join(runtimeDir, 'retention.txt')
    const downloaded = new Promise(resolve => {
      guest.session.once('will-download', (_event, item) => {
        item.setSavePath(downloadPath)
        item.once('done', (_event, state) => resolve(state))
      })
    })
    const stopped = once(guest, 'did-stop-loading')
    await guest.executeJavaScript(`(() => {const link=document.createElement('a');link.href='/download';document.body.append(link);link.click();link.remove();return true})()`)
    assert.equal(await downloaded, 'completed')
    await stopped
    current = invoke('mount', source, request)
    assert.equal(current.ready, true, 'a completed attachment download must keep its original document ready')
    assert.equal(current.webContentsId, originalId)
    assert.equal(await readState(guest), retained)
    assert.equal(readFileSync(downloadPath, 'utf8'), 'Disposable retained-page download')
    evidence.push({ downloadCompleted: true, readyAfterDownload: current.ready, webContentsId: guest.id })
    assert.equal(views.length, 1)
    const destroyed = once(guest, 'destroyed')
    invoke('release', source, current.token)
    await destroyed
    assertUnattended()
    writeFileSync(join(evidenceDir, 'roundtrip.json'), JSON.stringify({ passed: true, evidence, ...unattended }, null, 2))
    console.log(JSON.stringify({ passed: true, evidence: evidenceDir, ...unattended }))
    console.log(`Native page retention passed: 3 round trips, same WebContents, DOM/JS/scroll/history/cookie/zoom, retired annotation overlays, owner-fenced capture and scripts. Evidence: ${evidenceDir}`)
  } finally {
    dispose()
    for (const popup of popups) if (!popup.isDestroyed()) popup.destroy()
    if (!source.isDestroyed()) source.destroy()
    await new Promise(resolve => server.close(resolve))
    assertUnattended()
  }
}

app.whenReady().then(run).then(() => {
  clearTimeout(watchdog)
  app.exit(0)
}, error => {
  console.error(error)
  clearTimeout(watchdog)
  app.exit(1)
})
