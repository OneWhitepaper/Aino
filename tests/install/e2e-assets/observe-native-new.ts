// Inspect the OS-owned NEW window through its existing local DevTools. Never launch an app.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { bundledUpgradeHealth } from '../../../tests-js/scripts/bundled-upgrade-probe.ts'
import { expect, z } from '../../../tests-js/scripts/e2e-driver-deps.ts'

import { collectAutomaticNewWorkspace, type AutomaticNewWorkspace } from './desktop-smoke.ts'
import { fixtureAccountForHome } from './windows-user-state.mjs'
import { within } from './smoke-env.mjs'

const absolute = z.string().refine(path.isAbsolute)
const { values } = parseArgs({ options: Object.fromEntries(
  ['exe', 'pid', 'started-at', 'root', 'out', 'old-ready', 'snapshot', 'expect-commit'].map(key => [key, { type: 'string' as const }])) })
const options = z.object({ exe: absolute, pid: z.coerce.number().int().positive(), 'started-at': z.coerce.number().int().positive(),
  root: absolute, out: absolute, 'old-ready': absolute, snapshot: absolute, 'expect-commit': z.string().regex(/^[a-f0-9]{40}$/) }).parse(values)
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') { throw new Error('Disposable native Windows runner required') }

const output = path.join(options.out, 'automatic-new-workspace.json')
try {
  const old = z.object({ userData: absolute, hermesHome: absolute }).parse(JSON.parse(fs.readFileSync(options['old-ready'], 'utf8')))
  const account = fixtureAccountForHome({ root: old.userData, home: old.hermesHome })
  if (!account || account.userId !== '17') { throw new Error('Automatic NEW requires the original synthetic account') }
  const snapshot = z.object({ files: z.array(z.object({ kind: z.string().optional(), path: z.string(),
    sessions: z.array(z.object({ id: z.string(), profile_name: z.string().nullable() })).optional(),
    messages: z.array(z.object({ id: z.number(), session_id: z.string(), role: z.string(), content: z.string() })).optional() })) }).parse(
    JSON.parse(fs.readFileSync(options.snapshot, 'utf8')))
  const scopes = snapshot.files.filter(file => file.kind === 'session-db' && file.path.startsWith(`${account.relativeHome}/`))
    .flatMap(file => file.sessions!.map(session => ({ profile: session.profile_name || 'default', sessionId: session.id,
      model: account.model, baseUrl: account.baseUrl,
      messages: file.messages!.filter(message => message.session_id === session.id).map(({ id, role, content }) => ({ id, role, content })) })))
  if (scopes.length < 3 || scopes.some(scope => scope.messages.length < 2)) { throw new Error('Automatic NEW needs seeded Bot and real ZIP-written history') }
  const expected: AutomaticNewWorkspace = { home: old.hermesHome, commit: options['expect-commit'], scopes }
  const nonce = randomUUID()
  const expression = `copy(JSON.stringify({nonce:${JSON.stringify(nonce)},...await(async()=>{try{return{status:'passed',workspace:await(${collectAutomaticNewWorkspace.toString()})(${JSON.stringify(expected)})}}catch{return{status:'failed',error:'Automatic NEW workspace observation failed'}}})()}))`
  const spec = path.join(options.out, 'automatic-new-inspection.json')
  const observation = path.join(options.out, 'automatic-new-window.json')
  fs.writeFileSync(spec, JSON.stringify({ pid: options.pid, exe: options.exe, startedAt: options['started-at'], nonce, expression }) + '\n', { flag: 'wx', mode: 0o600 })
  execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(import.meta.dirname, 'observe-native-new.ps1'), '-SpecPath', spec, '-OutputPath', observation], {
    stdio: 'inherit', timeout: 180_000, windowsHide: true,
  })
  const result = z.object({ pid: z.literal(options.pid), startedAt: z.literal(options['started-at']), observedAt: z.number().int().positive(),
    nonce: z.literal(nonce), status: z.literal('passed'), workspace: z.object({
      identity: z.object({ appVersion: z.string(), commit: z.literal(options['expect-commit']), hermesHome: absolute, hermesRoot: absolute, platform: z.literal('win32') }),
      account: z.object({ phase: z.literal('signed_in'), userId: z.literal('17'), rememberState: z.literal('encrypted') }),
      connection: z.object({ baseUrl: z.string(), mode: z.literal('local') }), histories: z.array(z.unknown()).min(3),
    }) }).parse(JSON.parse(fs.readFileSync(observation, 'utf8').replace(/^\uFEFF/, '')))
  if (fs.realpathSync(result.workspace.identity.hermesHome) !== fs.realpathSync(old.hermesHome)
      || !within(options.root, result.workspace.identity.hermesRoot)) { throw new Error('Automatic NEW reported another actual workspace or installation') }
  const owner = bundledUpgradeHealth({ root: options.root, home: old.hermesHome, commit: options['expect-commit'],
    connection: result.workspace.connection, identity: result.workspace.identity })
  const request = path.join(options.out, 'automatic-new-authentication-request.json')
  fs.writeFileSync(`${request}.tmp`, JSON.stringify({ phase: 'automatic-new', startedAt: result.startedAt, observedAt: result.observedAt }) + '\n', { mode: 0o600 })
  fs.renameSync(`${request}.tmp`, request)
  const authentication = path.join(options.out, 'automatic-new-authentication.json')
  await expect.poll(() => fs.existsSync(authentication), { timeout: 15_000 }).toBe(true)
  const proof = z.object({ status: z.literal('passed'), phase: z.literal('automatic-new'),
    startedAt: z.literal(result.startedAt), observedAt: z.literal(result.observedAt),
    authenticatedProfileRequests: z.number().int().positive(), freshAuthenticationRequests: z.literal(0),
    authenticationPreservedWithoutLogin: z.literal(true) }).parse(JSON.parse(fs.readFileSync(authentication, 'utf8')))
  fs.writeFileSync(output, JSON.stringify({ ...result, owner, authentication: proof }, null, 2) + '\n')
} catch (error) {
  fs.writeFileSync(output, JSON.stringify({ status: 'failed', pid: options.pid, error: String(error) }) + '\n')
  throw error
}
