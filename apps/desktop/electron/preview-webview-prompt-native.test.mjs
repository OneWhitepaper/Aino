import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, session } from 'electron'
import { build } from 'esbuild'

import { failNativeFixtureWithoutDialog } from './preview-native-fixture-errors.mjs'

failNativeFixtureWithoutDialog(app)
const runtime = mkdtempSync(join(tmpdir(), 'aino-webview-prompt-'))
const evidence = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'aino-webview-prompt-proof-')))
mkdirSync(evidence, { recursive: true })
rmSync(join(evidence, 'webview-prompt-receipts.json'), { force: true })
app.setPath('userData', runtime)
app.setPath('sessionData', runtime)
process.env.HERMES_HOME = join(runtime, 'home')
process.env.HERMES_RUNTIME_DIR = join(runtime, 'runtime')
const watchdog = setTimeout(() => { console.error('Webview prompt fixture exceeded 40 seconds'); app.exit(1) }, 40_000)

async function run() {
  const bundle = join(runtime, 'interactions.mjs')
  await build({ stdin: { contents: `export * from './preview-browser-interactions.ts';export * from './preview-guest-throttle.ts';export * from './stream-throttle.ts'`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', external: ['electron'] })
  const api = await import(pathToFileURL(bundle).href)
  const preload = join(runtime, 'preload.cjs')
  await build({ entryPoints: [fileURLToPath(new URL('./preview-guest-preload-entry.ts', import.meta.url))], outfile: preload, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  const sockets = new Set()
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'content-security-policy': "frame-src 'none'; script-src 'unsafe-inline'" })
    response.end(`<!doctype html><title>Repeated webview prompts</title><button id='alert'>Alert</button><button id='confirm'>Confirm</button><button id='after'>Prompt after dismissals</button><button id='ask'>Ask labels</button><script>window.sequence={alertHits:0,alertReturned:0,confirmHits:0,promptHits:0};document.querySelector('#alert').onclick=()=>{sequence.alertHits++;alert('Dismiss this alert');sequence.alertReturned++};document.querySelector('#confirm').onclick=()=>{sequence.confirmHits++;sequence.confirm=confirm('Dismiss this confirm')};document.querySelector('#after').onclick=()=>{sequence.promptHits++;sequence.prompt=prompt('Prompt after dismissals','after-default')};window.hits=0;window.results=[];document.querySelector('#ask').onclick=()=>{hits++;results.push(prompt('First label','private-one'));results.push(prompt('Second label','private-two'));results.push(prompt('Third label','private-three'))}</script>`)
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const owner = new BrowserWindow({ show: false, width: 900, height: 650, webPreferences: { webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const throttle = api.createStreamThrottle()
  throttle.register(owner)
  let ownerShowed = false
  owner.on('show', () => { ownerShowed = true })
  let messageBoxCalls = 0
  const originalMessageBox = dialog.showMessageBox
  dialog.showMessageBox = () => {
    messageBoxCalls++
    throw new Error('The native OS dialog handler must not run for an Aino-owned dialog')
  }
  owner.webContents.on('will-attach-webview', (_event, preferences, params) => api.applyPreviewGuestAttachPrefs(preferences, params.partition, preload, partition => session.fromPartition(partition)))
  const attached = once(owner.webContents, 'did-attach-webview')
  await owner.loadURL('data:text/html,<webview src="about:blank" partition="persist:hermes-preview-webview-prompt" style="width:800px;height:600px"></webview>')
  const [, guest] = await attached
  if (guest.isLoading()) await once(guest, 'did-stop-loading')
  guest.setWindowOpenHandler(() => ({ action: 'deny' }))
  const request = (action, params = {}) => api.runPreviewBrowserInteraction(owner.webContents, guest, { action, scope: 'webview-prompt-proof', ...params })
  const observed = []
  const dismissalSequence = []
  const dialogEvents = []
  const responses = []
  let responseError
  let finishPrompts
  const allPrompts = new Promise(resolve => { finishPrompts = resolve })
  let activity
  guest.on('console-message', event => console.log('guest:', event.message))
  try {
    const admission = await request('watch')
    assert.equal(admission.dialog_control, 'aino', 'Refuse to trigger dialogs unless the native adapter is installed')
    await guest.loadURL(origin)
    activity = api.beginPreviewGuestActivity(owner.webContents, guest, () => throttle.holdWindow(owner))
    await owner.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    await guest.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    const pendingDialog = async message => {
      const deadline = Date.now()+2000
      do {
        const status=await request('dialog_status')
        const pending=status.dialogs?.find(item=>item.state==='pending'&&(!message||item.message===message))
        if(pending) return {pending,status}
        await new Promise(resolve=>setTimeout(resolve,5))
      } while(Date.now()<deadline)
      throw new Error(`Native dialog receipt did not become pending: ${message||'prompt'}`)
    }
    const click = async selector => {
      const point = await guest.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
      guest.sendInputEvent({type:'mouseMove',...point})
      guest.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
      guest.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
    }
    guest.debugger.on('message', (_event, method, params) => {
      if (method === 'Page.javascriptDialogOpening') dialogEvents.push({event:'opening',type:params.type,message:params.message})
      if (method === 'Page.javascriptDialogClosed') dialogEvents.push({event:'closed',result:params.result})
    })
    for (const spec of [
      {selector:'#alert',type:'alert',accept:false},
      {selector:'#confirm',type:'confirm',accept:false},
      {selector:'#after',type:'prompt',accept:true,promptText:'after-dismiss-label'}
    ]) {
      let listener
      const opened = new Promise(resolve => {
        listener=(_event,method,params)=>{if(method==='Page.javascriptDialogOpening'){guest.debugger.removeListener('message',listener);resolve(params)}}
        guest.debugger.on('message',listener)
      })
      await click(spec.selector)
      let timeout
      const params = await Promise.race([opened,new Promise(resolve=>{timeout=setTimeout(()=>resolve(undefined),2000)})])
      clearTimeout(timeout)
      guest.debugger.removeListener('message',listener)
      if (!params) throw new Error(`Expected ${spec.type} dialog after prior dismissals; page=${JSON.stringify(await guest.executeJavaScript('sequence'))}`)
      assert.equal(params.type,spec.type)
      const {pending}=await pendingDialog(params.message)
      dismissalSequence.push({type:params.type,message:pending.message,url:pending.url,accept:spec.accept})
      console.log('separate click dialog:',params.type)
      await request('dialog_respond',{dialogId:pending.id,accept:spec.accept,promptText:spec.promptText})
      await guest.executeJavaScript('true')
    }
    const sequenceResult=await guest.executeJavaScript('sequence')
    assert.deepEqual(sequenceResult,{alertHits:1,alertReturned:1,confirmHits:1,promptHits:1,confirm:false,prompt:'after-dismiss-label'})
    guest.debugger.on('message', (_event, method, params) => {
      if (method !== 'Page.javascriptDialogOpening') return
      const task = (async () => {
        const {status,pending} = await pendingDialog(params.message)
        assert.ok(pending, 'website prompt remains reachable through the native service')
        assert.equal(JSON.stringify(status).includes('private-'), false)
        const manual = await request('dialog_manual_status', { dialogId: pending.id })
        const index = observed.length
        observed.push({ message: pending.message, url: pending.url, state: 'pending' })
        console.log('webview prompt:', pending.message)
        await request('dialog_manual', { dialogId: pending.id, accept: index !== 2,
          ...(index === 0 ? { promptText: 'chosen-one' } : index === 1 ? { promptText: manual.default_text } : {}) })
        if (index === 2) finishPrompts()
      })().catch(error => { responseError = error; console.error(error) })
      responses.push(task)
    })
    const point = await guest.executeJavaScript('(()=>{const r=document.querySelector("#ask").getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
    guest.sendInputEvent({type:'mouseMove',...point})
    guest.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    guest.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
    await allPrompts
    await Promise.all(responses)
    if (responseError) throw responseError
    const result = await guest.executeJavaScript('({hits,results,frames:document.querySelectorAll("iframe").length})')
    assert.equal(observed.length, 3, 'each consecutive prompt opens a real Blink dialog')
    assert.deepEqual(result, { hits: 1, results: ['chosen-one', 'private-two', null], frames: 0 })
    assert.equal(ownerShowed,false,'Aino dialog handling must not show the hidden owner')
    assert.equal(owner.isVisible(),false,'The owner remains hidden throughout the proof')
    assert.equal(messageBoxCalls,0,'The native OS message box must never be called')
    const receipt = { success: true, dialog_control:admission.dialog_control, owner_showed:ownerShowed, message_box_calls:messageBoxCalls, dismissalSequence, sequenceResult, dialogEvents, window_visible: owner.isVisible(), webview: guest.getType(), observed, result }
    writeFileSync(join(evidence, 'webview-prompt-receipts.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
  } finally {
    if (activity !== undefined) await api.endPreviewGuestActivity(owner.webContents, activity)
    await request('release').catch(() => {})
    dialog.showMessageBox = originalMessageBox
    owner.destroy()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
app.whenReady().then(run).then(() => { clearTimeout(watchdog); rmSync(runtime, { recursive: true, force: true }); app.exit(0) }, error => { clearTimeout(watchdog); console.error(error); app.exit(1) })
