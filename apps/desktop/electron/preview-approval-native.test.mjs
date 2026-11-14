import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, session, WebContentsView } from 'electron'
import { build } from 'esbuild'

import { failNativeFixtureWithoutDialog } from './preview-native-fixture-errors.mjs'

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

const temporary = mkdtempSync(join(tmpdir(), 'aino-preview-approval-'))
const proof = process.argv[2] || mkdtempSync(join(tmpdir(), 'aino-preview-approval-proof-'))
mkdirSync(proof, { recursive: true })
app.commandLine.appendSwitch('site-per-process')
app.setPath('userData', temporary)
app.setPath('sessionData', temporary)
process.env.HERMES_HOME = join(temporary, 'home')
process.env.HERMES_RUNTIME_DIR = join(temporary, 'runtime')
const watchdog = setTimeout(() => { console.error('Approval fixture deadline'); app.exit(1) }, 90_000)
const servers = []
let host, other, hidden

async function run() {
  const bundle = join(temporary, 'approval.mjs')
  await build({ stdin: { contents: "export * from './preview-guest-throttle.ts'; export * from './preview-guest-owner.ts'", resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
    outfile: bundle, platform: 'node', format: 'esm', bundle: true, external: ['electron'] })
  const api = await import(pathToFileURL(bundle).href)
  const child = createServer((_request, response) => response.end('<button id="pay">Pay first recipient</button>'))
  child.listen(0); await once(child, 'listening'); servers.push(child)
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(`<style>hermes-watch{display:block}</style><hermes-watch><button id="spoof">Pay first recipient</button></hermes-watch>
      <div id="closed"></div><iframe src="http://localhost:${child.address().port}/"></iframe>
      <script>window.root=document.querySelector('#closed').attachShadow({mode:'closed'});root.innerHTML='<button id="pay">Pay first recipient</button>';</script>`)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); servers.push(server)
  host = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, sandbox: true, contextIsolation: true } })
  other = new BrowserWindow({ show: false })
  host.webContents.on('will-attach-webview', (_event, prefs, params) => api.applyPreviewGuestAttachPrefs(
    prefs, params.partition, fileURLToPath(new URL('./preview-agent-native-fixture/guest-preload.cjs', import.meta.url)), p => session.fromPartition(p)))
  const attached = once(host.webContents, 'did-attach-webview')
  await host.loadURL('data:text/html,<webview partition="persist:hermes-preview-approval" style="width:800px;height:600px"></webview>')
  await host.webContents.executeJavaScript(`document.querySelector('webview').src='http://127.0.0.1:${server.address().port}/'`)
  const [, guest] = await attached
  if (guest.isLoading()) await once(guest, 'did-stop-loading')
  const frame = guest.mainFrame.framesInSubtree.find(item => item !== guest.mainFrame)
  assert(frame, 'Cross-origin iframe must exist')
  assert.notEqual(frame.processId, guest.mainFrame.processId, 'Fixture must use a real out-of-process iframe')
  assert.equal(await guest.executeJavaScript('document.querySelector("iframe").contentDocument'), null)
  assert.equal(await guest.executeJavaScript('document.querySelector("#closed").shadowRoot'), null)

  const arm = async () => {
    const token = api.beginPreviewGuestActivity(host.webContents, guest, () => () => {})
    await api.armPreviewGuestApproval(host.webContents, token)
    return token
  }
  const end = token => api.endPreviewGuestActivity(host.webContents, token)
  let token = await arm()
  await api.validatePreviewGuestApproval(host.webContents, token)
  await assert.rejects(() => api.validatePreviewGuestApproval(other.webContents, token), /belong/)
  end(token)
  await assert.rejects(() => api.validatePreviewGuestApproval(host.webContents, token), /belong/)
  console.log('PASS unchanged native observation and request/window ownership')

  token = await arm()
  await guest.executeJavaScript('root.querySelector("button").textContent="Pay another recipient"')
  await assert.rejects(() => api.validatePreviewGuestApproval(host.webContents, token), /changed/)
  end(token)
  console.log('PASS closed Shadow DOM internal changes invalidate approval')

  token = await arm()
  await frame.executeJavaScript('document.querySelector("button").textContent="Pay second recipient"')
  await assert.rejects(() => api.validatePreviewGuestApproval(host.webContents, token), /changed/)
  end(token)
  console.log('PASS process-isolated cross-origin iframe internal changes invalidate approval')

  token = await arm()
  await guest.executeJavaScript('root.querySelector("button").textContent="Changed"')
  await guest.executeJavaScript('root.querySelector("button").textContent="Pay another recipient"')
  await assert.rejects(() => api.validatePreviewGuestApproval(host.webContents, token), /changed/)
  end(token)
  console.log('PASS reverting opaque content does not revive stale approval')

  token = await arm()
  await api.validatePreviewGuestApproval(host.webContents, token)
  await frame.executeJavaScript('document.querySelector("button").textContent="Boundary race"')
  await assert.rejects(() => api.sendPreviewGuestApprovedInput(host.webContents, token,
    { type: 'mouseDown', button: 'left', clickCount: 1, x: 10, y: 10 }), /changed/)
  end(token)
  console.log('PASS native input boundary rejects changes after renderer validation')

  token = await arm()
  await guest.executeJavaScript('document.querySelector("#spoof").textContent="Pay attacker"')
  await assert.rejects(() => api.validatePreviewGuestApproval(host.webContents, token), /changed/)
  end(token)
  console.log('PASS page-created hermes-watch content cannot bypass approval invalidation')

  token = await arm()
  await guest.executeJavaScript('document.styleSheets[0].insertRule("#spoof { opacity: 0 }", 0)')
  await assert.rejects(() => api.validatePreviewGuestApproval(host.webContents, token), /changed/)
  end(token)
  console.log('PASS CSSOM-only visual target changes invalidate approval')

  hidden = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: true } })
  hidden.setVisible(false)
  api.admitPreviewGuestSession(hidden.webContents.session)
  const unregister = api.registerNativePreviewGuest(hidden.webContents, host.webContents)
  await hidden.webContents.loadURL('data:text/html,<button>Hidden payment control</button>')
  assert.equal(await hidden.webContents.executeJavaScript('document.visibilityState'), 'hidden')
  await hidden.webContents.executeJavaScript(`(() => {
    const host=document.createElement('hermes-watch'),shadow=host.attachShadow({mode:'closed'}),cell=document.createElement('div');
    shadow.append(cell);document.documentElement.append(host);
    window.cosmetic=cell.animate([{opacity:0},{opacity:1}],{duration:2000,iterations:Infinity});
    window.__hermesWatch={parts:{shadow}};return true
  })()`)
  const hiddenToken = api.beginPreviewGuestActivity(host.webContents, hidden.webContents, () => () => {})
  let deadline
  try {
    await Promise.race([
      api.armPreviewGuestApproval(host.webContents, hiddenToken),
      new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Hidden browser approval stalled waiting for a paint')), 1500) })
    ])
    assert.equal(await hidden.webContents.executeJavaScript('cosmetic.pending'), false)
    assert.equal(await hidden.webContents.executeJavaScript('cosmetic.playState'), 'paused')
    await api.validatePreviewGuestApproval(host.webContents, hiddenToken)
  } finally {
    clearTimeout(deadline)
    await api.endPreviewGuestActivity(host.webContents, hiddenToken)
    assert.equal(await hidden.webContents.executeJavaScript('__hermesWatch.paused'), false)
    unregister()
  }
  console.log('PASS hidden native view approval completes without a rendering frame')
  assertUnattended()
  writeFileSync(join(proof, 'approval.json'), JSON.stringify({ passed: 8, oopif: true, platform: process.platform, ...unattended }, null, 2))
  console.log(JSON.stringify({ passed: 8, oopif: true, platform: process.platform, evidence: proof, ...unattended }))
  console.log('Native approval proof: ' + proof)
}

app.whenReady().then(run).then(() => app.exit(0), error => { console.error(error); app.exit(1) }).finally(() => {
  clearTimeout(watchdog)
  for (const server of servers) server.close()
  host?.destroy(); other?.destroy()
  hidden?.webContents.close()
  assertUnattended()
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})
