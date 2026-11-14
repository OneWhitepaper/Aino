import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { app, BrowserWindow, dialog, WebContentsView } from 'electron'
import { build } from 'esbuild'

import { failNativeFixtureWithoutDialog } from './preview-native-fixture-errors.mjs'
import { nativeFixtureRuntime } from './preview-native-fixture-runtime.mjs'

failNativeFixtureWithoutDialog(app)
const runtime = nativeFixtureRuntime()
const output = process.argv[2] || mkdtempSync(join(tmpdir(), 'aino-page-zoom-proof-'))
mkdirSync(output, { recursive: true })
app.setPath('userData', runtime)
app.setPath('sessionData', runtime)
let showed = false
let messageBoxes = 0
app.on('browser-window-created', (_event, window) => window.on('show', () => {showed = true}))
dialog.showMessageBox = async () => {messageBoxes++; throw new Error('OS dialogs are forbidden in this fixture')}
const watchdog = setTimeout(() => {console.error('Page zoom proof timed out'); app.exit(1)}, 45_000)

const waitFor = async (predicate, description) => {
  const until = Date.now() + 6000

  while (Date.now() < until) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  throw new Error('Timed out: ' + description)
}

async function run() {
  const bundle = join(runtime, 'service.mjs')
  await build({ stdin: { contents: `export * from './preview-native.ts'; export * from './preview-guest-owner.ts'; export * from './preview-guest-throttle.ts';
    export * from './preview-capture.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  outfile: bundle, platform: 'node', format: 'esm', bundle: true, external: ['electron'] })
  const { registerNativePreviewIpc, admitPreviewGuestSession, authorizeNativePreviewPopout, captureOwnedPreviewContents,
    beginPreviewGuestActivity, endPreviewGuestActivity } = await import(pathToFileURL(bundle).href)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><style>body{margin:0;min-width:1000px;height:1800px}button{position:absolute;left:820px;top:120px;width:120px;height:60px}</style>
      <input id="draft"><button id="target">Target</button><script>window.nonce=Math.random();window.hits=0;target.onclick=e=>{window.hits++;window.trusted=e.isTrusted}</script>`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/fixed`
  const windowOptions = { show: false, width: 1200, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } }
  const owner = new BrowserWindow(windowOptions)
  const popup = new BrowserWindow(windowOptions)
  await owner.loadURL('data:text/html,<title>Owner</title>')
  await popup.loadURL('data:text/html,<title>Popup</title>')
  const handlers = new Map()
  const events = new Map()
  const views = []
  const dispose = registerNativePreviewIpc({ handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => events.set(name, handler) }, {
    fromWebContents: contents => BrowserWindow.fromWebContents(contents), resolvePartition: value => value,
    createView: partition => {
      const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
      admitPreviewGuestSession(view.webContents.session)
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      views.push(view)

      return view
    }
  })
  const invoke = (name, window, ...args) => handlers.get('hermes:preview-native:' + name)({ sender: window.webContents }, ...args)
  const bounds = { x: 20, y: 60, width: 600, height: 600 }
  const request = tabId => ({ tabId, partition: 'persist:hermes-preview-zoom-proof', url, bounds })

  try {
    let first = invoke('mount', owner, request('fit-one'))
    const one = views[0].webContents
    await waitFor(() => Math.abs(one.getZoomFactor() - 0.6) < 0.01, 'overflow fit')
    const firstFactor = one.getZoomFactor()
    const second = invoke('mount', owner, request('fit-two'))
    const two = views[1].webContents
    await waitFor(() => Math.abs(two.getZoomFactor() - 0.6) < 0.01, 'second overflow fit')
    assert.equal(one.getZoomMode(), 'isolated')
    assert.equal(two.getZoomMode(), 'isolated')
    await invoke('command', owner, second.token, 'setPageZoom', [1.25])
    assert.equal(two.getZoomFactor(), 1.25)
    assert.equal(one.getZoomFactor(), firstFactor, 'same origin does not share page zoom')
    events.get('hermes:preview-native:layout')({ sender: owner.webContents }, second.token, bounds, false)
    const activity = beginPreviewGuestActivity(owner.webContents, one, () => () => {})
    await one.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    const state = await one.executeJavaScript(`({nonce, url:location.href, width:innerWidth, height:innerHeight, rect:(()=>{const r=target.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()})`)
    assert.ok(state.width >= 999)
    const image = await captureOwnedPreviewContents(owner.webContents, one)
    const bytes = Buffer.from(image.split(',')[1], 'base64')
    const imageWidth = bytes.readUInt32BE(16)
    const imageHeight = bytes.readUInt32BE(20)
    const screenshotPoint = { x: state.rect.x * imageWidth / state.width, y: state.rect.y * imageHeight / state.height }
    // The production renderer maps screenshot pixels -> guest CSS -> native DIP.
    const inputPoint = { x: Math.round(screenshotPoint.x * state.width / imageWidth * one.getZoomFactor()),
      y: Math.round(screenshotPoint.y * state.height / imageHeight * one.getZoomFactor()) }
    await invoke('command', owner, first.token, 'focus', [])
    for (const type of ['mouseDown', 'mouseUp']) await invoke('command', owner, first.token, 'sendInputEvent', [{ type, button: 'left', clickCount: 1, ...inputPoint }])
    await waitFor(() => one.executeJavaScript('hits === 1 && trusted === true'), 'trusted click on screenshot-mapped target')
    endPreviewGuestActivity(owner.webContents, activity)
    await one.executeJavaScript(`draft.value='Unsaved';history.pushState({saved:false},'', '#local');scrollTo(0,400);true`)
    await invoke('command', owner, first.token, 'setPageZoom', [0.8])
    const retained = await one.executeJavaScript('JSON.stringify({nonce,draft:draft.value,url:location.href,scrollY,state:history.state})')
    authorizeNativePreviewPopout(owner.webContents, popup, 'fit-one')
    invoke('release', owner, first.token)
    const moved = invoke('mount', popup, { ...request('fit-one'), bounds: { ...bounds, width: 1000 } })
    assert.equal(moved.webContentsId, one.id)
    assert.equal(moved.zoomMode, 'manual')
    assert.equal(moved.zoom, 0.8)
    assert.equal(await one.executeJavaScript('JSON.stringify({nonce,draft:draft.value,url:location.href,scrollY,state:history.state})'), retained)
    const closed = once(popup, 'closed')
    popup.close()
    await closed
    first = invoke('mount', owner, request('fit-one'))
    assert.equal(first.webContentsId, one.id)
    assert.equal(first.zoom, 0.8)
    assert.equal(first.zoomMode, 'manual')
    assert.equal(await one.executeJavaScript('JSON.stringify({nonce,draft:draft.value,url:location.href,scrollY,state:history.state})'), retained)
    assert.equal(showed, false)
    assert.equal(messageBoxes, 0)
    const receipt = { passed: true, isolatedSameOrigin: true, firstFactor, secondFactor: two.getZoomFactor(),
      screenshot: { width: imageWidth, height: imageHeight }, screenshotPoint, inputPoint, trustedClick: true,
      retainedSameWebContents: true, manualRoundTrip: true, showed, messageBoxes }
    writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify({ ...receipt, evidence: output }))
  } finally {
    dispose()
    if (!owner.isDestroyed()) owner.destroy()
    if (!popup.isDestroyed()) popup.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}

app.whenReady().then(run).then(() => {
  clearTimeout(watchdog)
  app.exit(0)
}).catch(error => {console.error(error); app.exit(1)})
