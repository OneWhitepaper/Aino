// Real child deadlines and the native handoff observer; no package installation.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const subject = () => import('./windows-native-observation.mjs')

test('a blocked native query is terminated before it can outlive its observation budget', async () => {
  const { runProbe } = await subject()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-query-timeout-'))
  const pidFile = path.join(root, 'child.pid')
  try {
    const start = performance.now()
    const result = await runProbe(process.execPath, ['-e',
      'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)', pidFile], 2000)
    assert.equal(result.status, 'timeout')
    assert.ok(performance.now() - start < 8000, 'the native query exceeded its bounded deadline')
    assert.throws(() => process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 0), 'the owned query survived timeout')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('query failures and malformed output cannot become successful package observations', async () => {
  const { runProbe } = await subject()
  const ok = await runProbe(process.execPath, ['-e', 'console.log(JSON.stringify({version:"1.2.3.0"}))'], 3000)
  assert.deepEqual(ok, { status: 'ok', data: { version: '1.2.3.0' } })
  const failed = await runProbe(process.execPath, ['-e', 'console.error("private diagnostic"); process.exit(7)'], 3000)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.exitCode, 7)
  const invalid = await runProbe(process.execPath, ['-e', 'console.log("not json")'], 3000)
  assert.equal(invalid.status, 'invalid')
})

test('package replacement and a fresh automatic main process are distinct required phases', async () => {
  const { classifyObservation } = await subject()
  const request = { oldPid: 100, oldBirth: '2026-11-16T08:00:00.000Z' }
  const processes = rows => ({ status: 'ok', data: { newMain: rows, oldMainCount: 0, oldPayloadCount: 0, installerCount: 1 } })
  const fresh = { ProcessId: 200, CreationDate: '2026-11-16T08:00:01Z', ExecutablePath: 'C:\\target\\Aino.exe' }
  const old = { status: 'ok', data: { state: 'old', version: '1.0.0.0' } }
  const target = { status: 'ok', data: { state: 'target', version: '2.0.0.0', installed: { exe: 'C:\\target\\Aino.exe' } } }
  assert.equal(classifyObservation(old, processes([]), request).phase, 'waiting-for-package')
  assert.equal(classifyObservation(target, processes([]), request).phase, 'waiting-for-process')
  assert.equal(classifyObservation(target, processes([{ ProcessId: 100, CreationDate: '2026-11-16T08:00:01Z' }]), request).phase, 'invalid-process')
  assert.equal(classifyObservation(target, processes([{ ProcessId: 200, CreationDate: '2026-11-16T07:59:59Z' }]), request).phase, 'invalid-process')
  assert.equal(classifyObservation(target, processes([fresh]), request).phase, 'new-observed')
  assert.equal(classifyObservation(target, processes([{ ...fresh, ExecutablePath: 'C:\\other\\Aino.exe' }]), request).phase, 'invalid-process')
  assert.equal(classifyObservation({ status: 'ok', data: null }, processes([]), request).phase, 'invalid-package')
  assert.equal(classifyObservation(target, { status: 'ok', data: null }, request).phase, 'invalid-process')
  assert.equal(classifyObservation({ status: 'timeout' }, processes([]), request).phase, 'package-query-timeout')
  assert.equal(classifyObservation(target, { status: 'timeout' }, request).phase, 'process-query-timeout')
})

test('waiter diagnostics bind to this OLD process and omit other attempts and private text', async () => {
  const { readWaiterProgress } = await subject()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'waiter-progress-'))
  const file = path.join(root, 'waiter.log')
  const request = { oldPid: 101, identity: 'Aino.Candidate', startedAt: '2026-11-16T08:00:00Z' }
  try {
    fs.writeFileSync(file, [
      '2026-11-16T08:00:01Z [hermes-relaunch-old] pid=500 start: parent=100 identity=Aino.Candidate timeout=900s',
      '2026-11-16T08:00:02Z [hermes-relaunch-me] pid=501 start: parent=101 identity=Aino.Candidate timeout=900s',
      '2026-11-16T08:00:03Z [hermes-relaunch-me] pid=501 ready: from=1.0.0.0 family=private app=Aino',
      '2026-11-16T08:00:04Z [hermes-relaunch-me] pid=501 parent exited; waiting for package version change',
      '2026-11-16T08:00:05Z [hermes-relaunch-me] pid=501 failed: private path or credential 0x80073D02',
      '2026-11-16T08:00:06Z [hermes-relaunch-old] pid=500 launched',
    ].join('\n'))
    assert.deepEqual(readWaiterProgress(file, request), { stage: 'failed', pid: 501, hresult: '0x80073D02' })
    assert.equal(readWaiterProgress(file, { ...request, oldPid: 999 }).stage, 'not-observed')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a real observation timeout retains the last native phase before returning failure', async () => {
  const { observeNativeUpdate } = await subject()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-observe-budget-'))
  const request = path.join(root, 'request.json')
  const script = path.join(root, 'probe.cjs')
  fs.writeFileSync(request, JSON.stringify({ oldPid: 100, identity: 'Aino.Contract', startedAt: new Date().toISOString() }))
  fs.writeFileSync(script, 'setInterval(() => {}, 1000)')
  try {
    const start = performance.now()
    assert.equal(await observeNativeUpdate(request, { timeoutMs: 2000, queryMs: 5000,
      powershell: process.execPath, probeArgs: () => [script] }), false)
    const result = JSON.parse(fs.readFileSync(path.join(root, 'native-observation.json'), 'utf8'))
    assert.equal(result.status, 'unaccepted')
    assert.equal(result.phase, 'package-query-timeout')
    assert.equal(result.packageQuery, 'timeout')
    assert.ok(performance.now() - start < 8000, 'event diagnostics must also remain bounded')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the observer retains only the manifest-verified executable and a fresh main process on success', async () => {
  const { observeNativeUpdate } = await subject()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-observe-success-'))
  const request = path.join(root, 'request.json')
  const script = path.join(root, 'probe.cjs')
  const installed = { exe: process.execPath }
  const fresh = { ProcessId: process.pid, ExecutablePath: process.execPath, CreationDate: new Date().toISOString() }
  fs.writeFileSync(request, JSON.stringify({ oldPid: 1, oldBirth: '2020-01-01T00:00:00Z', identity: 'Aino.Contract',
    startedAt: new Date().toISOString() }))
  fs.writeFileSync(script, `
const operation = process.argv[2]
if (operation === 'package') console.log(JSON.stringify({state:'target',version:'2.0.0.0',installed:${JSON.stringify(installed)}}))
else if (process.argv[3] === '-NewExecutable' && process.argv[4] === process.execPath)
  console.log(JSON.stringify({newMain:[${JSON.stringify(fresh)}],oldPayloadCount:0}))
else process.exit(9)
`)
  try {
    assert.equal(await observeNativeUpdate(request, { timeoutMs: 5000, queryMs: 3000,
      powershell: process.execPath, probeArgs: (operation, extra) => [script, operation, ...extra] }), true)
    const result = JSON.parse(fs.readFileSync(path.join(root, 'native-observation.json'), 'utf8'))
    assert.equal(result.status, 'observed')
    assert.equal(result.phase, 'new-observed')
    assert.deepEqual(result.installed, installed)
    assert.deepEqual(result.process, fresh)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the real PowerShell package probe exposes mismatched provenance instead of returning target', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-package-contract-'))
  const requestFile = path.join(root, 'request.json')
  const wrapper = path.join(root, 'run.ps1')
  const probe = path.resolve(import.meta.dirname, 'windows-native-probe.ps1')
  const quote = value => `'${value.replaceAll("'", "''")}'`
  const request = { identity: 'Aino.Contract', arch: 'x64', old: { version: '1.0.0.0' },
    new: { version: '2.0.0.0', publisher: 'CN=Expected', applicationId: 'Aino', commit: 'a'.repeat(40), tag: 'v0.1.7' } }
  try {
    fs.writeFileSync(requestFile, JSON.stringify(request))
    fs.writeFileSync(wrapper, `
function Get-AppxPackage { [pscustomobject]@{Version=[version]'2.0.0.0'; Publisher='CN=Wrong'; Architecture='X64'; InstallLocation='C:\\invalid'; PackageFullName='Aino.Contract'} }
& ${quote(probe)} -Operation package -RequestPath ${quote(requestFile)}
exit $LASTEXITCODE
`)
    const output = execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper], { encoding: 'utf8', timeout: 10000 })
    assert.equal(JSON.parse(output.replace(/^\uFEFF/, '')).state, 'invalid')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the real Windows process probe observes the owned main PID and its executable birth time', { skip: process.platform !== 'win32' }, async () => {
  const { runProbe } = await subject()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-process-contract-'))
  const requestFile = path.join(root, 'request.json')
  try {
    fs.writeFileSync(requestFile, JSON.stringify({ oldPid: process.pid, old: { location: path.dirname(process.execPath) } }))
    const result = await runProbe(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.resolve(import.meta.dirname, 'windows-native-probe.ps1'), '-Operation', 'process', '-RequestPath', requestFile,
        '-NewExecutable', process.execPath], 20_000)
    assert.equal(result.status, 'ok')
    assert.equal(result.data.oldMainCount, 1)
    assert.ok(result.data.oldPayloadCount >= 1)
    const row = result.data.newMain.find(row => row.ProcessId === process.pid)
    assert.equal(row?.ExecutablePath.toLowerCase(), process.execPath.toLowerCase())
    assert.ok(Number.isFinite(Date.parse(row.CreationDate)))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
