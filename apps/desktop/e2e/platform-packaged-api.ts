import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import { createRequire } from 'node:module'
import * as path from 'node:path'

import { _electron, type ElectronApplication } from '@playwright/test'
import type { BrowserWindow as NativeWindow } from 'electron'

import { fixtureEnvironment, isExpectedBlockedThemeFontRequest, KNOWN_BLOCKED_THEME_FONT_URL, type NativeTransportAudit } from './platform-real-api'
import { processStartMarkerWithEnvironment } from './platform-workspace-proof'
import { installErrorBannerGuard } from './test'
import { startHttpsEdge } from './update/github-edge'

const require = createRequire(import.meta.url)
const sandboxModule = new URL('../scripts/d2-packaged-smoke.mjs', import.meta.url).href
export const PACKAGED_PLATFORM_ORIGIN = 'https://api.agentera.com.cn'

interface OwnedProcess {
  pid: number
  startMarker: string
  role: string
}

interface EntryStop {
  reason: string
  entry: string
  frames: Array<{ url: string; functionName: string; location: { lineNumber: number; columnNumber: number } }>
}

interface EntryMarker {
  pid: number
  packaged: boolean
  ready: boolean
  appPath: string
  executable: string
  argv: string[]
}

function running(pid: number) {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') { return false }
    throw error
  }
}

async function sameProcess(identity: OwnedProcess) {
  if (!running(identity.pid)) { return false }

  try {
    return await processStartMarkerWithEnvironment(identity.pid, fixtureEnvironment()) === identity.startMarker
  } catch (error) {
    if (!running(identity.pid)) { return false }
    throw error
  }
}

async function within<T>(work: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout)
    })])
  } finally {
    clearTimeout(timer)
  }
}

function ownedPackageCleanup(app: ElectronApplication, env: Record<string, string>, processMarker: string) {
  const identities = new Map<number, OwnedProcess>()
  let closed: Promise<{ processes: OwnedProcess[]; all_exited: boolean; forced: boolean }> | undefined

  async function remember(pid: number, role: string) {
    if (identities.has(pid) || !running(pid)) { return }
    const startMarker = await processStartMarkerWithEnvironment(pid, fixtureEnvironment())
    identities.set(pid, { pid, role, startMarker })
  }

  async function capture() {
    await remember(app.process().pid!, 'wrapper')
    const processes = JSON.parse(fs.readFileSync(processMarker, 'utf8')) as OwnedProcess[]

    for (const identity of processes) {
      if (!Number.isInteger(identity.pid) || identity.pid <= 0 || !identity.startMarker) { throw new Error('Incomplete package process identity') }

      if (await sameProcess(identity)) { identities.set(identity.pid, identity) }
    }

    const main = processes.find(identity => identity.role === 'main')

    if (!main) { throw new Error('Missing package main process identity') }
    const ownershipFile = path.join(env.HERMES_DESKTOP_USER_DATA_DIR, 'backend-ownership.json')

    if (fs.existsSync(ownershipFile)) {
      const ownership = JSON.parse(fs.readFileSync(ownershipFile, 'utf8')) as {
        backends?: Array<OwnedProcess & { nonce?: string; profile?: string; parentPid?: number; parentStartMarker?: string }>
      }

      for (const backend of ownership.backends ?? []) {
        if (!Number.isInteger(backend.pid) || backend.pid <= 0 || !backend.nonce || !backend.profile || !backend.startMarker) {
          throw new Error('Incomplete package backend ownership')
        }

        if (!await sameProcess(backend)) { continue }

        if (backend.parentPid !== main.pid || backend.parentStartMarker !== main.startMarker) {
          throw new Error('Package backend ownership does not match the captured main process')
        }

        identities.set(backend.pid, { pid: backend.pid, startMarker: backend.startMarker, role: `backend:${backend.profile}` })
      }
    }

    const metrics = await within(app.evaluate(({ app: native }) => native.getAppMetrics()
      .map(metric => ({ pid: metric.pid, type: metric.type }))), 3_000, 'Cannot capture package process metrics')

    for (const metric of metrics) { await remember(metric.pid, metric.type) }
  }

  async function survivors() {
    const alive: OwnedProcess[] = []

    for (const identity of identities.values()) {
      if (await sameProcess(identity)) { alive.push(identity) }
    }

    return alive
  }

  async function waitForExit(timeout: number) {
    const deadline = Date.now() + timeout
    let alive = await survivors()

    while (alive.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
      alive = await survivors()
    }

    return alive
  }

  return {
    capture,
    remember,
    close() {
      closed ??= (async () => {
        const errors: unknown[] = []

        try { await capture() } catch (error) { errors.push(error) }

        try { await within(app.close(), 15_000, 'Packaged app close exceeded 15 seconds') } catch (error) { errors.push(error) }
        let alive = await waitForExit(5_000)

        if (alive.length) {
          errors.push(new Error(`Owned package processes survived normal close: ${alive.map(p => `${p.role}:${p.pid}`).join(', ')}`))

          for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
            for (const identity of alive) {
              // Recheck incarnation immediately before each owned-process signal.
              if (await sameProcess(identity)) {
                try { process.kill(identity.pid, signal) } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { errors.push(error) }
                }
              }
            }

            alive = await waitForExit(3_000)

            if (!alive.length) { break }
          }
        }

        if (alive.length) { errors.push(new Error('Owned package processes survived forced cleanup')) }

        if (errors.length) { throw new AggregateError(errors, 'Packaged process cleanup failed') }

        return { processes: [...identities.values()], all_exited: true, forced: false }
      })()

      return closed
    }
  }
}

// The package retains its production origin and validates real server-issued
// credentials. Only this external harness maps transport to the disposable API.
export async function startPackagedTransport(root: string, apiOrigin: string) {
  const { sandboxPolicy, proveSandboxGuards } = await import(sandboxModule)
  const destination = new URL(apiOrigin)

  if (destination.protocol !== 'http:' || destination.hostname !== '127.0.0.1') {throw new Error('Expected loopback API fixture')}
  const failures: string[] = []

  const edge = await startHttpsEdge(root, { host: new URL(PACKAGED_PLATFORM_ORIGIN).hostname, tunnelOthers: false,
    handler: (req, res) => {
      if (!req.url?.startsWith('/v1/')) { res.writeHead(403); res.end();

 return }

      const upstream = http.request({ hostname: destination.hostname, port: destination.port,
        path: req.url, method: req.method, headers: { ...req.headers, host: destination.host } }, reply => {
        res.writeHead(reply.statusCode ?? 502, reply.headers)
        reply.pipe(res)
      })

      upstream.on('error', error => { failures.push(error.message); res.destroy(error) })
      req.once('aborted', () => upstream.destroy())
      res.once('close', () => { if (!res.writableEnded) {upstream.destroy()} })
      req.pipe(upstream)
    } })

  try {
    const isolation = await proveSandboxGuards(sandboxPolicy())

    return { ...edge, failures, isolation }
  } catch (error) { await edge.close(); throw error }
}

export function packagedExecutable(appPath: string) {
  const name = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-',
    path.join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()

  if (!name || /[/\\]/.test(name)) {throw new Error('Invalid bundle executable')}

  return path.join(appPath, 'Contents/MacOS', name)
}

export async function packagedBackendEvidence(env: Record<string, string>, appPath: string) {
  const stamp = JSON.parse(fs.readFileSync(path.join(appPath, 'Contents/Resources/install-stamp.json'), 'utf8'))
  const python = path.join(appPath, 'Contents/Resources/agent-payload', stamp.runtime.storePython)
  const ownership = JSON.parse(fs.readFileSync(path.join(env.HERMES_DESKTOP_USER_DATA_DIR, 'backend-ownership.json'), 'utf8'))
  const evidence = []

  for (const backend of ownership.backends ?? []) {
    if (!backend.nonce || !backend.profile || !await sameProcess(backend)) {throw new Error('Invalid owned backend identity')}
    const command = execFileSync('/bin/ps', ['-ww', '-p', String(backend.pid), '-o', 'command='], { encoding: 'utf8' }).trim()

    if (!command.startsWith(python + ' ')) {throw new Error('Backend did not use the bundled interpreter')}
    evidence.push({ pid: backend.pid, startMarker: backend.startMarker, command, python })
  }

  if (!evidence.length) {throw new Error('No live bundled backend')}

  return evidence
}

export async function preparePackagedHarness(
  env: Record<string, string>,
  nodeGuard: string,
  appPath: string,
  apiOrigin: string
) {
  const { sandboxPolicy } = await import(sandboxModule)
  const root = path.dirname(nodeGuard)
  const launchId = randomUUID()
  const guard = path.join(root, `packaged-transport-${launchId}.cjs`)
  const mainMarker = path.join(env.HERMES_HOME, `packaged-before-entry-${launchId}.json`)
  const stopMarker = path.join(env.HERMES_HOME, `packaged-entry-stop-${launchId}.json`)
  const processMarker = path.join(env.HERMES_HOME, `packaged-processes-${launchId}.json`)
  const stdoutLog = path.join(env.HERMES_HOME, `packaged-${launchId}.stdout.log`)
  const stderrLog = path.join(env.HERMES_HOME, `packaged-${launchId}.stderr.log`)
  const wrapper = path.join(root, `packaged-inspector-launch-${launchId}.cjs`)
  const executable = packagedExecutable(appPath)
  const stamp = JSON.parse(fs.readFileSync(path.join(appPath, 'Contents/Resources/install-stamp.json'), 'utf8'))
  const backendLauncher = path.join(appPath, 'Contents/Resources/agent-payload', stamp.runtime.commands.hermes)
  const expectedEntry = path.join(appPath, 'Contents/Resources/app.asar/dist/electron-main.mjs')
  fs.writeFileSync(guard, `
const fs = require('node:fs'), path = require('node:path');
const electron = require('electron'), {app, session} = electron;
if (!app.isPackaged || app.isReady()) throw new Error('Guard must install on package before ready');
require(${JSON.stringify(nodeGuard)});
const guardedFetch=globalThis.fetch;
const origin=${JSON.stringify(PACKAGED_PLATFORM_ORIGIN)}, target=${JSON.stringify(apiOrigin)};
globalThis.fetch=async function(input, init) {
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.origin!==origin) return guardedFetch(input,init);
 if(!(typeof input==='string'||input instanceof URL)) throw new Error('Unexpected platform Request object');
 fs.appendFileSync(path.join(process.env.HERMES_HOME,'packaged-main-mapped-requests'),(init?.method||'GET')+' '+url.pathname+'\\n');
 const response=await guardedFetch(target+url.pathname+url.search,init);
 if(url.pathname==='/api/v1/desktop/credentials' && response.ok) {
  const body=await response.json();
  if(body.data?.base_url!==target+'/v1') throw new Error('Unexpected fixture lease destination');
  body.data.base_url=origin+'/v1';
  const headers=new Headers(response.headers);headers.delete('content-length');
  return new Response(JSON.stringify(body),{status:response.status,headers});
 }
 return response;
};
const guardedSessions=new WeakSet();
const isExpectedThemeFont=${isExpectedBlockedThemeFontRequest.toString()};
const KNOWN_BLOCKED_THEME_FONT_URL=${JSON.stringify(KNOWN_BLOCKED_THEME_FONT_URL)};
function auditMarker(name, host) {
 fs.appendFileSync(path.join(process.env.HERMES_HOME,name+'-'+process.pid+'.txt'),host+'\\n');
}
app.on('web-contents-created',(_event,contents)=>{
 try {
  contents.debugger.attach('1.3');let tearingDown=false;
  contents.once('destroyed',()=>{tearingDown=true});app.once('before-quit',()=>{tearingDown=true});
  contents.debugger.on('detach',()=>{if(!tearingDown&&!contents.isDestroyed())auditMarker('font-observer-error','unexpected-detach')});
  contents.debugger.on('message',(_event,method,params)=>{
   if(method!=='Network.requestWillBeSent')return;
   try {
    const request=params.request,url=new URL(request.url);
    if(request.url!==KNOWN_BLOCKED_THEME_FONT_URL)return;
    const shape={url:request.url,method:request.method,resourceType:String(params.type??'').toLowerCase(),
      hasUploadData:Boolean(request.hasPostData||request.postData||request.postDataEntries?.length),
      hasAuthorization:Object.keys(request.headers).some(name=>name.toLowerCase()==='authorization')};
    auditMarker(isExpectedThemeFont(shape)?'verified-theme-font-denial':'unexpected-theme-font-shape',url.hostname);
   }catch{auditMarker('font-observer-error','invalid-observation')}
  });
  contents.debugger.sendCommand('Network.enable').catch(()=>auditMarker('font-observer-error','enable-failed'));
 }catch{auditMarker('font-observer-error','attach-failed')}
});
function guardSession(s) {
 if(guardedSessions.has(s))return;guardedSessions.add(s);
 s.webRequest.onBeforeRequest((details,done)=>{
  const u=new URL(details.url);
  const allowed=['file:','data:','blob:','devtools:','chrome:','chrome-extension:','about:'].includes(u.protocol)||['127.0.0.1','localhost','[::1]'].includes(u.hostname);
  if(!allowed){
   const expected=details.url===${JSON.stringify(KNOWN_BLOCKED_THEME_FONT_URL)}&&details.method==='GET'&&details.resourceType==='stylesheet'&&!details.uploadData?.length;
   const marker=expected?'blocked-chromium-font-candidate-'+process.pid+'.txt':'blocked-chromium-network.txt';
   fs.appendFileSync(path.join(process.env.HERMES_HOME,marker),u.hostname+'\\n');
  }
  done({cancel:!allowed});
 });
}
app.on('session-created',guardSession);
app.whenReady().then(()=>{guardSession(session.defaultSession);fs.appendFileSync(path.join(process.env.HERMES_HOME,'chromium-network-guard-active'),process.pid+'\\n')});
const cp=require('node:child_process');
for(const name of ['spawn','spawnSync','execFile','execFileSync']) {
 const original=cp[name];cp[name]=function(command,...args){
  if(path.basename(String(command))==='security')throw new Error('Packaged fixture denies personal Keychain command');
  if(String(command)===${JSON.stringify(backendLauncher)}){
   if(!Array.isArray(args[0]))throw new Error('Expected bundled launcher argv');
   fs.appendFileSync(path.join(process.env.HERMES_HOME,'packaged-sandbox-launches'),JSON.stringify({command,args:args[0]})+'\\n');
   return original.call(this,'/usr/bin/sandbox-exec',['-p',${JSON.stringify(sandboxPolicy())},command,...args[0]],...args.slice(1));
  }
  return original.call(this,command,...args);
 };
}
require('node:module').syncBuiltinESMExports();
fs.writeFileSync(${JSON.stringify(mainMarker)},JSON.stringify({pid:process.pid,packaged:app.isPackaged,ready:app.isReady(),appPath:app.getAppPath(),executable:process.execPath,argv:process.argv}));
`, { mode: 0o600 })
  fs.writeFileSync(wrapper, `#!${process.execPath}
const fs=require('node:fs'),{spawn,execFileSync}=require('node:child_process'),{fileURLToPath}=require('node:url'),WS=require(${JSON.stringify(require.resolve('ws'))});
const args=process.argv.slice(2).map(a=>a==='--inspect=0'?'--inspect-brk=0':a);
if(!args.includes('--inspect-brk=0'))throw new Error('Pre-entry inspector required');
const stdoutLog=${JSON.stringify(stdoutLog)},stderrLog=${JSON.stringify(stderrLog)};
fs.writeFileSync(stdoutLog,'',{mode:0o600});fs.writeFileSync(stderrLog,'',{mode:0o600});
const child=spawn(${JSON.stringify(executable)},args,{env:process.env,stdio:['ignore','pipe','pipe']});
let stderr='',ws,seq=0,released=false,failed=false,killTimer;const pending=new Map(),scripts=new Map();
function fail(error){
 if(failed)return;failed=true;clearTimeout(timer);
 const message=String(error)+'\\n';fs.appendFileSync(stderrLog,message);process.stderr.write(message);
 child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);process.exitCode=1;
}
const timer=setTimeout(()=>fail(new Error('Packaged guard setup timed out')),15000);
child.once('error',fail);
const identity=(pid,role)=>({pid,role,startMarker:'ps:'+execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:2000}).trim()});
try{fs.writeFileSync(${JSON.stringify(processMarker)},JSON.stringify([identity(process.pid,'wrapper'),identity(child.pid,'main')]),{mode:0o600})}catch(error){fail(error)}
function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
child.stdout.on('data',data=>{fs.appendFileSync(stdoutLog,data);process.stdout.write(data)});
child.stderr.on('data',data=>{
 fs.appendFileSync(stderrLog,data);
 if(released){process.stderr.write(data);return;}
 stderr+=String(data);const url=stderr.match(/Debugger listening on (ws:\\/\\/[^\\s]+)/)?.[1];if(!url||ws)return;
 ws=new WS(url);let pausedResolve;const paused=new Promise(resolve=>pausedResolve=resolve);
 ws.once('error',fail);
 ws.on('message',data=>{const o=JSON.parse(String(data));if(o.method==='Debugger.scriptParsed')scripts.set(o.params.scriptId,o.params.url);if(o.method==='Debugger.paused')pausedResolve(o.params);const p=pending.get(o.id);if(p){pending.delete(o.id);o.error?p.reject(o.error):p.resolve(o.result)}});
 ws.once('open',async()=>{try{
  await rpc('Runtime.enable');await rpc('Debugger.enable');await rpc('Runtime.runIfWaitingForDebugger');const stop=await paused;
  const frames=stop.callFrames.map(frame=>({url:frame.url||scripts.get(frame.location.scriptId)||'',functionName:frame.functionName,
    location:{lineNumber:frame.location.lineNumber,columnNumber:frame.location.columnNumber}}));
  const topURL=frames[0]?.url||'',entry=topURL.startsWith('file:')?fileURLToPath(topURL):topURL;
  fs.writeFileSync(${JSON.stringify(stopMarker)},JSON.stringify({reason:stop.reason,entry,frames}),{mode:0o600});
  if(stop.reason!=='Break on start'||entry!==${JSON.stringify(expectedEntry)})throw new Error('Inspector did not stop before the expected packaged entry');
  const installed=await rpc('Runtime.evaluate',{expression:'require('+${JSON.stringify(JSON.stringify(guard))}+')',includeCommandLineAPI:true});
  if(installed.exceptionDetails)throw new Error('Packaged guard injection failed');
  await rpc('Debugger.resume');await rpc('Debugger.disable');
  clearTimeout(timer);released=true;process.stderr.write(stderr);stderr='';ws.close();
 }catch(error){fail(error)}});
});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code,signal)=>{clearTimeout(timer);clearTimeout(killTimer);ws?.close();if(!released)process.stderr.write(stderr);process.exitCode=failed?1:code??(signal?1:0)});
`, { mode: 0o700 })

  return { wrapper, guard, mainMarker, stopMarker, processMarker, stdoutLog, stderrLog, expectedEntry }
}

export async function launchGuardedPackagedDesktop(
  env: Record<string, string>, nodeGuard: string, appPath: string, apiOrigin: string
) {
  const scripts = await preparePackagedHarness(env, nodeGuard, appPath, apiOrigin)
  const { wrapper, mainMarker, stopMarker, processMarker } = scripts

  const app = await _electron.launch({ executablePath: wrapper, args: [
    '--aino-legacy-account-development', '--disable-background-networking', '--disable-component-update',
    '--no-first-run', '--use-mock-keychain'
  ], env, timeout: 60_000 })

  const cleanup = ownedPackageCleanup(app, env, processMarker)

  try {
    await cleanup.capture()
    const marker = JSON.parse(fs.readFileSync(mainMarker, 'utf8')) as EntryMarker
    const stop = JSON.parse(fs.readFileSync(stopMarker, 'utf8')) as EntryStop
    const transportAudit: NativeTransportAudit = { mainPid: marker.pid, unexpectedRendererDestinations: [], knownBlockedThemeFontHosts: [], pending: [] }
    app.context().on('request', request => {
      const url = new URL(request.url())

      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) { return }
      transportAudit.pending.push(request.allHeaders().then(headers => {
        if (request.url() === KNOWN_BLOCKED_THEME_FONT_URL && request.method() === 'GET' && request.resourceType() === 'stylesheet' && !request.postDataBuffer() && !Object.keys(headers).some(h => h.toLowerCase() === 'authorization')) {
          transportAudit.knownBlockedThemeFontHosts.push(url.hostname)
        } else { transportAudit.unexpectedRendererDestinations.push(url.hostname) }
      }).catch(() => { transportAudit.unexpectedRendererDestinations.push(url.hostname) }))
    })
    const page = await within(app.firstWindow(), 15_000, 'Packaged first window inspection exceeded 15 seconds')
    installErrorBannerGuard(page)

    const state = await within(app.evaluate(({ app: native, BrowserWindow }) => ({
      packaged: native.isPackaged, appPath: native.getAppPath(), executable: process.execPath,
      noSandbox: native.commandLine.hasSwitch('no-sandbox'), disableSandbox: native.commandLine.hasSwitch('disable-sandbox'),
      metrics: native.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, name: metric.name, sandboxed: metric.sandboxed })),
      windows: BrowserWindow.getAllWindows().map((w: NativeWindow) => ({ pid: w.webContents.getOSProcessId(), preferences: (w.webContents as NativeWindow['webContents'] & { getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean } }).getLastWebPreferences() }))
    })), 5_000, 'Packaged sandbox inspection exceeded 5 seconds')

    const children = state.windows.map((w: { pid: number }) => ({ pid: w.pid, command: execFileSync('/bin/ps', ['-ww', '-p', String(w.pid), '-o', 'command='], { encoding: 'utf8', timeout: 2_000 }).trim() }))

    for (const metric of state.metrics) { await cleanup.remember(metric.pid, metric.type) }

    return { app, page, transportAudit, close: cleanup.close, packageProof: { beforeEntry: marker, stop, state, children,
      earlyLogs: { stdout: scripts.stdoutLog, stderr: scripts.stderrLog } } }
  } catch (error) {
    try { await cleanup.close() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Packaged launch inspection and cleanup failed')
    }

    throw error
  }
}
