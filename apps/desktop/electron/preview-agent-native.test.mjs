import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { app, BrowserWindow, dialog, ipcMain, nativeImage, session, webContents } from 'electron'
import tailwindcss from '@tailwindcss/vite'
import { build } from 'esbuild'
import { createServer as createViteServer } from 'vite'

import { failNativeFixtureWithoutDialog } from './preview-native-fixture-errors.mjs'

failNativeFixtureWithoutDialog(app)

const runtimeDir = mkdtempSync(join(tmpdir(), 'aino-preview-agent-native-'))
const evidenceDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'aino-preview-agent-proof-'))
mkdirSync(evidenceDir, { recursive: true })
app.setPath('userData', runtimeDir)
app.setPath('sessionData', runtimeDir)
process.env.HERMES_HOME = join(runtimeDir, 'home')
process.env.HERMES_RUNTIME_DIR = join(runtimeDir, 'runtime')
const watchdog = setTimeout(() => {
  console.error('Native browser agent fixture exceeded 120 seconds')
  rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(1)
}, 120_000)

async function until(check, message) {
  const deadline = Date.now() + 15_000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

function guestHtml(crossOrigin) {
  return `<!doctype html><title>Native browser action fixture</title>
    <style>body{margin:0;font:14px sans-serif} canvas{position:absolute;left:20px;top:20px;width:140px;height:70px;background:#ddd}
    form{position:absolute;left:20px;top:120px} #shadow{position:absolute;left:20px;top:180px}
    #multiline-wrap{position:absolute;left:300px;top:120px;width:180px;line-height:26px}
    iframe{position:absolute;left:20px;top:250px;width:220px;height:70px;border:0} #cross{top:340px}
    #danger{position:absolute;left:300px;top:20px} #double-action{position:absolute;left:500px;top:20px}
    #native-dialogs{position:absolute;left:300px;top:250px}</style>
    <canvas id="canvas" width="140" height="70"></canvas>
    <form><label>Name <input id="name" aria-label="Name" /></label></form>
    <div id="multiline-wrap"><a id="multiline" href="#issue" aria-label="Wrapped issue title">First title line<br>Second title line<br>Third title line<br>Fourth title line</a></div>
    <div id="shadow"></div><iframe id="frame" src="/frame"></iframe>
    <iframe id="cross" src="${crossOrigin}/cross"></iframe><button type="button" id="danger">Delete record</button>
    <button type="button" id="double-action">Open draft</button>
    <div id="native-dialogs"><button type="button" id="notice-alert">Show notice</button>
    <button type="button" id="notice-confirm">Open choice</button><button type="button" id="notice-prompt">Open question</button></div>
    <script>
      window.hits=[]; window.shadowHits=0; window.frameHits=0; window.crossHits=0; window.dangerHits=0; window.dragMoves=0;
      canvas.onclick=e=>hits.push({trusted:e.isTrusted,x:e.clientX,y:e.clientY});
      canvas.onpointerdown=e=>{window.dragTrusted=e.isTrusted};
      canvas.onpointermove=e=>{if(e.buttons===1)window.dragMoves++};
      document.querySelector('#name').oninput=e=>{window.inputTrusted=e.isTrusted};
      danger.onclick=()=>dangerHits++;
      window.doubleClicks=[];window.doubleHits=0;window.doubleTrusted=false;
      document.querySelector('#double-action').onclick=e=>window.doubleClicks.push(e.detail);
      document.querySelector('#double-action').ondblclick=e=>{window.doubleHits++;window.doubleTrusted=e.isTrusted};
      window.dialogHits=0;window.dialogReturned=0;
      document.querySelector('#notice-alert').onclick=()=>{window.dialogHits++;alert('Synthetic notice');window.dialogReturned++};
      document.querySelector('#notice-confirm').onclick=()=>{window.dialogHits++;window.choice=confirm('Synthetic choice');window.dialogReturned++};
      document.querySelector('#notice-prompt').onclick=()=>{window.dialogHits++;window.answer=prompt('Synthetic question');window.dialogReturned++};
      window.inlineHits=0;
      multiline.onclick=e=>{e.preventDefault();window.inlineHits++;window.inlineTrusted=e.isTrusted};
      const root=document.querySelector('#shadow').attachShadow({mode:'open'});
      root.innerHTML='<button id="shadow-action" type="button">Shadow action</button>';
      root.querySelector('button').onclick=e=>{window.shadowHits++;window.shadowTrusted=e.isTrusted};
      addEventListener('message',e=>{ if(e.data.kind==='frame') {window.frameHits++;window.frameTrusted=e.data.trusted}
      if(e.data.kind==='cross') {window.crossHits++;window.crossTrusted=e.data.trusted} });
    </script>`
}

async function run() {
  const nativeBundle = join(runtimeDir, 'native-helpers.mjs')
  const guestPreload = join(runtimeDir, 'guest-preload.cjs')
  await build({
    entryPoints: [fileURLToPath(new URL('./preview-guest-preload-entry.ts', import.meta.url))],
    outfile: guestPreload,
    platform: 'node',
    format: 'cjs',
    bundle: true,
    external: ['electron']
  })
  await build({
    stdin: {
      contents: `export * from './preview-guest-throttle.ts'; export * from './preview-capture.ts'; export * from './stream-throttle.ts'; export * from './preview-browser-interactions.ts'`,
      resolveDir: fileURLToPath(new URL('.', import.meta.url))
    },
    outfile: nativeBundle,
    platform: 'node',
    format: 'esm',
    bundle: true,
    external: ['electron']
  })
  const {
    applyPreviewGuestAttachPrefs,
    beginPreviewGuestActivity,
    endPreviewGuestActivity,
    executePreviewGuestScript,
    armPreviewGuestApproval,
    validatePreviewGuestApproval,
    sendPreviewGuestApprovedInput,
    captureOwnedPreviewContents,
    createStreamThrottle,
    runPreviewBrowserInteraction
  } = await import(pathToFileURL(nativeBundle).href)
  let crossOrigin
  const guestServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(
      request.url === '/frame' || request.url === '/cross'
        ? `<!doctype html><body style="margin:0"><button type="button" style="width:160px;height:45px" onclick="parent.postMessage({kind:'${request.url.slice(1)}',trusted:event.isTrusted},'*')">${request.url === '/frame' ? 'Frame action' : 'Cross action'}</button>`
        : guestHtml(crossOrigin)
    )
  })
  const crossServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(
      '<!doctype html><body style="margin:0"><button style="width:160px;height:45px" onclick="parent.postMessage({kind:\'cross\',trusted:event.isTrusted},\'*\')">Cross action</button>'
    )
  })
  crossServer.listen(0, '127.0.0.1')
  guestServer.listen(0, '127.0.0.1')
  await Promise.all([once(crossServer, 'listening'), once(guestServer, 'listening')])
  crossOrigin = `http://127.0.0.1:${crossServer.address().port}`
  const guestOrigin = `http://127.0.0.1:${guestServer.address().port}`
  const root = fileURLToPath(new URL('../', import.meta.url))
  const vite = await createViteServer({
    configFile: false,
    root,
    cacheDir: join(runtimeDir, 'vite-cache'),
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': join(root, 'src'),
        '@hermes/shared': join(root, '../shared/src'),
        '@hermes/plugin-sdk': join(root, 'src/sdk/index.ts')
      }
    },
    server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [join(root, '../..')] } },
    css: { postcss: { plugins: [] } },
    optimizeDeps: { entries: ['e2e/fixtures/preview-agent-native.html'] }
  })
  await vite.listen()
  const port = vite.httpServer.address().port
  const windowShows = { primary: false, other: false }
  let messageBoxCalls = 0
  const originalMessageBox = dialog.showMessageBox
  dialog.showMessageBox = () => {
    messageBoxCalls++
    throw new Error('The native OS message box handler must not run for Aino-owned dialogs')
  }
  const window = new BrowserWindow({
    show: false,
    width: 950,
    height: 750,
    webPreferences: {
      preload: fileURLToPath(new URL('./preview-agent-native-fixture/preload.cjs', import.meta.url)),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.on('show', () => { windowShows.primary = true })
  const throttle = createStreamThrottle()
  throttle.register(window)
  window.webContents.on('console-message', event => {
    if (event.level === 'error') console.error('fixture renderer:', event.message)
  })
  window.webContents.on('will-attach-webview', (_event, preferences, parameters) => {
    preferences.nodeIntegration = false
    preferences.contextIsolation = true
    preferences.sandbox = true
    applyPreviewGuestAttachPrefs(
      preferences,
      parameters.partition,
      guestPreload,
      p => session.fromPartition(p)
    )
  })
  ipcMain.handle('fixture:begin', (event, id) =>
    beginPreviewGuestActivity(event.sender, webContents.fromId(id), () => throttle.holdWindow(window))
  )
  ipcMain.handle('fixture:end', (event, token) => endPreviewGuestActivity(event.sender, token))
  ipcMain.handle('fixture:script', (event, token, code) => executePreviewGuestScript(event.sender, token, code))
  ipcMain.handle('fixture:approval-arm', (event, token) => armPreviewGuestApproval(event.sender, token))
  ipcMain.handle('fixture:approval-validate', (event, token) => validatePreviewGuestApproval(event.sender, token))
  ipcMain.handle('fixture:approval-input', (event, token, input) => sendPreviewGuestApprovedInput(event.sender, token, input))
  ipcMain.handle('fixture:capture', (event, id) => captureOwnedPreviewContents(event.sender, webContents.fromId(id)))
  ipcMain.handle('fixture:native', (event, id, request) => runPreviewBrowserInteraction(event.sender, webContents.fromId(id), request))
  try {
    const attached = once(window.webContents, 'did-attach-webview')
    await window.loadURL(
      `http://127.0.0.1:${port}/e2e/fixtures/preview-agent-native.html?guest=${encodeURIComponent(guestOrigin)}`
    )
    const [, guest] = await attached
    guest.on('console-message', event => console.log('fixture guest:', event.message))
    const host = code => window.webContents.executeJavaScript(code)
    const page = code => guest.executeJavaScript(code)
    await until(
      () => host('Boolean(window.previewNativeFixture?.ready)'),
      'Production renderer fixture did not initialize'
    )
    await until(
      () => page('document.querySelector("#frame").contentDocument?.readyState === "complete"'),
      'Frame did not load'
    )
    const nativeControl = await runPreviewBrowserInteraction(window.webContents, guest, {
      action: 'watch', scope: await host('previewNativeFixture.tabId')
    })
    assert.equal(nativeControl.dialog_control, 'aino', 'Refuse to open website dialogs without Aino native dialog control')
    const action = value => host(`previewNativeFixture.run(${JSON.stringify(value)})`)
    const start = value => host(`previewNativeFixture.start(${JSON.stringify(value)})`)
    const waitApproval = () =>
      until(() => host('Boolean(previewNativeFixture.pending())'), 'Expected browser confirmation')
    const approve = () => host('previewNativeFixture.approve()')
    const finish = () => host('previewNativeFixture.finish()')
    const pixelPoint = (seen, x, y) => [
      (x * seen.image.width) / seen.viewport.width,
      (y * seen.image.height) / seen.viewport.height
    ]

    for (const zoom of [1, 1.25]) {
      await host(`previewNativeFixture.zoom(${zoom})`)
      await until(
        async () => Math.abs((await page('innerWidth')) - 900 / zoom) <= 1,
        'Zoom did not update the guest viewport'
      )
      const seen = await action({ kind: 'screenshot' })
      assert.equal(seen.success, true, JSON.stringify(seen))
      assert.equal(seen.url, guestOrigin + '/')
      assert(seen.image.data_url.startsWith('data:image/png;base64,'))
      assert(seen.image.width > 0 && seen.image.height > 0)
      assert.deepEqual(nativeImage.createFromDataURL(seen.image.data_url).getSize(), {
        width: seen.image.width,
        height: seen.image.height
      })
      assert.deepEqual(seen.viewport, await page('({width:innerWidth,height:innerHeight})'))
      const before = await page('hits.length')
      await start({ kind: 'click', coordinate: pixelPoint(seen, 80, 50), observationId: seen.observation_id })
      await waitApproval()
      if (zoom === 1) {
        await until(() => host('Boolean(document.querySelector("[role=dialog]"))'), 'Confirmation did not render')
        writeFileSync(join(evidenceDir, 'browser-confirmation.png'), (await window.webContents.capturePage()).toPNG())
      }
      assert.equal(await page('hits.length'), before)
      assert.equal(await host('document.querySelector("[role=status]").textContent'), 'Awaiting approval')
      await approve()
      const clicked = await finish()
      assert.equal(clicked.success, true, JSON.stringify(clicked))
      await until(async () => (await page('hits.length')) === before + 1, 'Canvas did not receive native click')
      assert.equal(await page('hits.at(-1).trusted'), true)
      assert(Math.abs((await page('hits.at(-1).x')) - 80) <= 2)
      assert(Math.abs((await page('hits.at(-1).y')) - 50) <= 2)
      console.log(`PASS native screenshot → approval → trusted canvas click at ${zoom * 100}% zoom`)
    }
    await host('previewNativeFixture.zoom(1)')
    await until(async () => (await page('innerWidth')) === 900, 'Zoom reset did not settle')
    const inventory = await action({ kind: 'elements', full: true })
    assert.equal(inventory.success, true, JSON.stringify(inventory))
    for (const [label, count, trusted] of [
      ['Shadow action', 'shadowHits', 'shadowTrusted'],
      ['Frame action', 'frameHits', 'frameTrusted']
    ]) {
      const element = inventory.elements.find(item => item.label === label)
      assert(element, `Missing semantic element: ${label}`)
      const result = await action({ kind: 'click', ref: element.ref })
      assert.equal(result.success, true, JSON.stringify(result))
      assert.equal(await page(count), 1)
      assert.equal(await page(trusted), true)
      console.log('PASS semantic native action in ' + label)
    }
    const field = inventory.elements.find(item => item.label === 'Name')
    assert(field)
    const typed = await action({ kind: 'type', ref: field.ref, text: 'Aino native acceptance' })
    assert.equal(typed.success, true, JSON.stringify(typed))
    assert.equal(await page('document.querySelector("#name").value'), 'Aino native acceptance')
    assert.equal(await page('inputTrusted'), true)
    console.log('PASS semantic form input through native keyboard events')

    const doubleTarget = inventory.elements.find(item => item.label === 'Open draft')
    assert(doubleTarget, 'Missing native double-click target')
    const doubled = await action({ kind: 'double_click', ref: doubleTarget.ref })
    assert.equal(doubled.success, true, JSON.stringify(doubled))
    await until(async () => (await page('doubleHits')) === 1, 'Native double-click did not reach its target')
    assert.deepEqual(await page('doubleClicks'), [1, 2])
    assert.equal(await page('doubleTrusted'), true)
    console.log('PASS semantic native double-click dispatches click details 1/2 and a trusted dblclick')

    await page(`(() => { const style=document.createElement('style');style.textContent='#danger:hover{opacity:.75;transform:scale(1.05)}';document.head.append(style) })()`)
    await start({ kind: 'click', selector: '#danger' })
    await waitApproval()
    assert.equal(await page('dangerHits'), 0)
    assert((await host('previewNativeFixture.pending()')).details.some(item => item.value === 'Delete record'))
    await approve()
    const approvedSensitive = await finish()
    assert.equal(approvedSensitive.success, true, JSON.stringify(approvedSensitive))
    assert.equal(await page('dangerHits'), 1)
    console.log('PASS sensitive target hover styling settles before one-action approval and trusted click')

    guest.debugger.on('message', (_event, method, params, sessionId) => {
      if (method.startsWith('Page.javascriptDialog') || (method === 'Page.frameNavigated' && params.frame?.url === 'about:blank') || method === 'Page.frameDetached') console.log('fixture native event:', method, JSON.stringify(params), sessionId)
    })
    console.log('fixture prompt before:', await page('prompt.toString()'))
    for (const [selector, type] of [['#notice-alert', 'alert'], ['#notice-confirm', 'confirm'], ['#notice-prompt', 'prompt']]) {
      const opened = await action({ kind: 'click', selector })
      assert.equal(opened.success, true, JSON.stringify(opened))
      if (type === 'prompt' && !opened.dialogs) console.log('fixture prompt failure:', await page('JSON.stringify({prompt:prompt.toString(),hits:dialogHits,returned:dialogReturned,answer:window.answer,activation:{active:navigator.userActivation.isActive,ever:navigator.userActivation.hasBeenActive}})'))
      assert.equal(opened.dialogs?.[0]?.type, type, JSON.stringify(opened))
      assert.match(opened.note, /do not repeat/i)
      const answered = await action({ kind: 'dialog_respond', dialogId: opened.dialogs[0].id, accept: false })
      assert.equal(answered.success, true, JSON.stringify(answered))
    }
    assert.equal(await page('dialogHits'), 3)
    assert.equal(await page('dialogReturned'), 3)
    assert.equal((await action({ kind: 'elements' })).success, true)
    console.log('PASS production clicks open alert/confirm/prompt exactly once and return native receipts without blocked guest reads')

    const inline = inventory.elements.find(item => item.label === 'Wrapped issue title')
    assert(inline, 'Missing multiline inline link')
    assert.equal(await page(`(() => {
      const rect=multiline.getBoundingClientRect();
      return document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2).id;
    })()`), 'multiline-wrap', 'Fixture must put the bounding-box centre between link lines')
    const inlineResult = await action({ kind: 'click', ref: inline.ref })
    assert.equal(inlineResult.success, true, JSON.stringify(inlineResult))
    await until(async () => (await page('inlineHits')) === 1, 'Multiline inline link did not receive native click')
    assert.equal(await page('inlineTrusted'), true)
    console.log('PASS semantic native click hits multiline inline text instead of the bounding-box gap')

    const dragSeen = await action({ kind: 'screenshot' })
    await page('dragMoves=0;dragTrusted=false')
    await start({
      kind: 'drag',
      coordinate: pixelPoint(dragSeen, 40, 40),
      toCoordinate: pixelPoint(dragSeen, 120, 60),
      observationId: dragSeen.observation_id
    })
    await waitApproval()
    await approve()
    const dragged = await finish()
    assert.equal(dragged.success, true, JSON.stringify(dragged))
    assert.equal(await page('dragTrusted'), true)
    assert((await page('dragMoves')) > 0)
    console.log('PASS screenshot-based native drag with trusted pointer movement')

    const crossSeen = await action({ kind: 'screenshot' })
    assert.equal(await page('document.querySelector("#cross").contentDocument'), null)
    await start({ kind: 'click', coordinate: pixelPoint(crossSeen, 80, 360), observationId: crossSeen.observation_id })
    await waitApproval()
    await approve()
    assert.equal((await finish()).success, true)
    await until(async () => (await page('crossHits')) === 1, 'Cross-origin frame did not receive visual click')
    assert.equal(await page('crossTrusted'), true)
    console.log('PASS cross-origin iframe visual fallback with trusted input')

    const staleSeen = await action({ kind: 'screenshot' })
    await page('document.querySelector("#danger").textContent="Delete another record"')
    const stale = await action({
      kind: 'click',
      coordinate: pixelPoint(staleSeen, 80, 50),
      observationId: staleSeen.observation_id
    })
    assert.equal(stale.success, false)
    assert.equal(await host('previewNativeFixture.pending()'), null)
    console.log('PASS changed page invalidates prior screenshot coordinates')

    const beforeSpa = await action({ kind: 'screenshot' })
    await start({ kind: 'click', coordinate: pixelPoint(beforeSpa, 80, 50), observationId: beforeSpa.observation_id })
    await waitApproval()
    const beforeSpaHits = await page('hits.length')
    await page('location.hash="another-route"')
    await approve()
    assert.equal((await finish()).success, false)
    assert.equal(await page('hits.length'), beforeSpaHits)
    assert.equal((await action({ kind: 'elements', full: true })).success, true)
    console.log('PASS SPA navigation invalidates approval while keeping browser observation available')

    const beforeNavigation = await action({ kind: 'screenshot' })
    await start({
      kind: 'click',
      coordinate: pixelPoint(beforeNavigation, 80, 50),
      observationId: beforeNavigation.observation_id
    })
    await waitApproval()
    await guest.loadURL(guestOrigin + '/replacement')
    await approve()
    assert.equal((await finish()).success, false)
    assert.equal(await page('hits.length'), 0)
    console.log('PASS navigation invalidates pending coordinate approval')

    const takeoverSeen = await action({ kind: 'screenshot' })
    await start({
      kind: 'click',
      coordinate: pixelPoint(takeoverSeen, 80, 50),
      observationId: takeoverSeen.observation_id
    })
    await waitApproval()
    await host(
      'Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Take over").click()'
    )
    assert.equal((await finish()).success, false)
    assert.equal(await host('previewNativeFixture.pending()'), null)
    assert.equal((await action({ kind: 'elements', full: true })).success, false)
    assert.equal(await page('hits.length'), 0)
    await host(
      'Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Return to AI").click()'
    )
    assert.equal((await action({ kind: 'elements', full: true })).success, true)
    console.log('PASS toolbar takeover cancels approval and blocks AI until explicitly returned')
    const otherWindow = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    })
    otherWindow.on('show', () => { windowShows.other = true })
    try {
      await assert.rejects(captureOwnedPreviewContents(otherWindow.webContents, guest), /belong/)
      assert.equal(otherWindow.isVisible(), false, 'The second fixture window must remain hidden')
    } finally {
      otherWindow.destroy()
    }
    console.log('PASS real second window cannot capture another window’s browser')
    const ownerShowed = windowShows.primary || windowShows.other
    assert.equal(ownerShowed, false, 'Native browser fixtures must not show their owner windows')
    assert.equal(window.isVisible(), false, 'The primary fixture window must remain hidden')
    assert.equal(messageBoxCalls, 0, 'Native OS message boxes must not be called')
    const receipt = { success: true, dialog_control: nativeControl.dialog_control, owner_showed: ownerShowed, window_shows: windowShows, message_box_calls: messageBoxCalls }
    writeFileSync(join(evidenceDir, 'native-agent-receipts.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
    console.log('Native Aino browser operation acceptance passed')
    console.log('Native browser proof: ' + evidenceDir)
  } finally {
    dialog.showMessageBox = originalMessageBox
    window.destroy()
    await vite.close()
    guestServer.closeAllConnections()
    crossServer.closeAllConnections()
    guestServer.close()
    crossServer.close()
  }
}

app
  .whenReady()
  .then(run)
  .then(() => {
    clearTimeout(watchdog)
    rmSync(runtimeDir, { recursive: true, force: true })
    app.exit(0)
  })
  .catch(error => {
    console.error(error)
    clearTimeout(watchdog)
    rmSync(runtimeDir, { recursive: true, force: true })
    app.exit(1)
  })
