// Bounded native observations and explicit disposable-package cleanup; no app or installer launch.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function runProbe(command, args, timeoutMs) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: Math.max(1, Math.floor(timeoutMs)), killSignal: 'SIGKILL', windowsHide: true,
      maxBuffer: 256 * 1024, encoding: 'utf8', env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH')) }, (error, stdout) => {
      if (error) {
        resolve({ status: error.killed ? 'timeout' : 'failed', exitCode: typeof error.code === 'number' ? error.code : null })
        return
      }
      try { resolve({ status: 'ok', data: JSON.parse(stdout.replace(/^\uFEFF/, '')) }) }
      catch { resolve({ status: 'invalid' }) }
    })
  })
}

export function classifyObservation(packageResult, processResult, request) {
  if (packageResult.status !== 'ok') return { phase: `package-query-${packageResult.status}` }
  if (!['old', 'target', 'absent'].includes(packageResult.data?.state)) return { phase: 'invalid-package' }
  if (processResult.status !== 'ok') return { phase: `process-query-${processResult.status}` }
  if (packageResult.data.state !== 'target') return { phase: 'waiting-for-package' }
  const rows = processResult.data?.newMain
  if (!Array.isArray(rows)) return { phase: 'invalid-process' }
  if (!rows.length) return { phase: 'waiting-for-process' }
  if (rows.length !== 1 || !Number.isInteger(rows[0]?.ProcessId) || rows[0].ProcessId <= 0 ||
      rows[0].ProcessId === request.oldPid || typeof packageResult.data.installed?.exe !== 'string' ||
      rows[0].ExecutablePath?.toLowerCase() !== packageResult.data.installed.exe.toLowerCase() ||
      !(Date.parse(rows[0].CreationDate) > Date.parse(request.oldBirth))) return { phase: 'invalid-process' }
  return { phase: 'new-observed', installed: packageResult.data.installed, process: rows[0] }
}

function boundedTail(file, cap = 64 * 1024) {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const buffer = Buffer.alloc(Math.min(size, cap))
      fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length)
      return buffer.toString('utf8')
    } finally { fs.closeSync(fd) }
  } catch { return '' }
}

export function readWaiterProgress(file, request) {
  const lines = boundedTail(file).split(/\r?\n/)
  let attempt, pid
  for (const line of lines) {
    const start = /^(\S+) \[([^\]]+)\] pid=(\d+) start: parent=(\d+) identity=(\S+) timeout=/.exec(line)
    if (start && Number(start[4]) === request.oldPid && start[5] === request.identity &&
        Date.parse(start[1]) >= Date.parse(request.startedAt)) { attempt = start[2]; pid = Number(start[3]) }
  }
  if (!attempt) return { stage: 'not-observed' }
  const stages = [
    [/start: parent=/, 'starting'], [/ready: from=/, 'ready'],
    [/parent exited; waiting/, 'parent-exited'], [/package query started/, 'query-started'],
    [/package is now .*; launching/, 'package-changed'], [/launched$/, 'launched'],
    [/timed out waiting for the parent/, 'parent-timeout'], [/timed out waiting for the package/, 'package-timeout'],
    [/failed:/, 'failed'],
  ]
  let result = { stage: 'starting', pid }
  for (const line of lines) {
    if (!line.includes(`[${attempt}] pid=${pid} `)) continue
    for (const [pattern, stage] of stages) if (pattern.test(line)) result = { stage, pid }
    const hresult = /\b0x[89A-Fa-f][0-9A-Fa-f]{7}\b/.exec(line)?.[0]
    if (hresult) result.hresult = hresult.toUpperCase().replace('0X', '0x')
  }
  return result
}

function save(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(`${file}.tmp`, file)
}

export async function observeNativeUpdate(requestFile, { timeoutMs = 900_000, queryMs = 20_000,
  powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
  probeArgs } = {}) {
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8').replace(/^\uFEFF/, ''))
  const directory = path.dirname(requestFile)
  const receiptFile = path.join(directory, 'native-observation.json')
  const probe = fileURLToPath(new URL('./windows-native-probe.ps1', import.meta.url))
  const args = probeArgs ?? ((operation, extra = []) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', probe, '-Operation', operation, '-RequestPath', requestFile, ...extra])
  const deadline = performance.now() + timeoutMs
  let deadlineOperation
  const query = async (operation, extra = []) => {
    const remaining = deadline - performance.now()
    const value = await runProbe(powershell, args(operation, extra), Math.max(1, Math.min(queryMs, remaining)))
    if (remaining < queryMs && performance.now() >= deadline) deadlineOperation = operation
    return value
  }
  let last = {}, heartbeat = 0, result = { phase: 'starting' }, samples = 0
  while (performance.now() < deadline) {
    save(path.join(directory, 'native-query-progress.json'), { operation: 'package', startedAt: new Date().toISOString() })
    const pkg = await query('package')
    if (performance.now() >= deadline) {
      // A final probe inherits only the remaining overall budget. Its forced
      // end says nothing about the native query's own deadline or prior facts.
      if (!deadlineOperation || !samples) {
        last = { ...last, package: pkg }
        result = { phase: (deadlineOperation || pkg.status === 'ok') ? 'observation-timeout' : `package-query-${pkg.status}` }
      }
      break
    }
    save(path.join(directory, 'native-query-progress.json'), { operation: 'process', startedAt: new Date().toISOString() })
    const processes = await query('process', pkg.data?.state === 'target' ? ['-NewExecutable', pkg.data.installed.exe] : [])
    if (deadlineOperation) {
      if (!samples) { last = { package: pkg, processes }; result = { phase: 'observation-timeout' } }
      break
    }
    result = classifyObservation(pkg, processes, request)
    const waiter = readWaiterProgress(path.join(os.tmpdir(), 'hermes-relaunch-waiter.log'), request)
    last = { package: pkg, processes, waiter, observedAt: new Date().toISOString() }
    samples++
    const safe = { phase: result.phase, packageQuery: pkg.status, processQuery: processes.status,
      version: pkg.data?.version, oldPayloadCount: processes.data?.oldPayloadCount,
      oldPythonCount: processes.data?.oldPythonCount, oldNodeCount: processes.data?.oldNodeCount,
      oldOtherCount: processes.data?.oldOtherCount,
      oldMainCount: processes.data?.oldMainCount, newMainCount: processes.data?.newMain?.length,
      installerCount: processes.data?.installerCount, waiterStage: waiter.stage,
      ...(waiter.hresult ? { waiterHresult: waiter.hresult } : {}) }
    save(receiptFile, { status: 'observing', ...safe, samples, last })
    if (performance.now() >= heartbeat || result.phase === 'new-observed') {
      console.log(`[native-observe] ${JSON.stringify(safe)}`)
      heartbeat = performance.now() + 30_000
    }
    if (result.phase === 'new-observed') {
      save(receiptFile, { status: 'observed', ...safe, samples, last, installed: result.installed, process: result.process })
      return true
    }
    if (['invalid-package', 'invalid-process'].includes(result.phase)) break
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, Math.max(0, deadline - performance.now()))))
  }
  // Separate bounded event query after the observation budget: it cannot hide the timeout.
  const events = await runProbe(powershell, args('events'), Math.min(10_000, timeoutMs))
  const installer = await runProbe(powershell, args('installer'), Math.min(15_000, timeoutMs))
  const safeEvents = events.status === 'ok' ? events.data : { queryStatus: events.status }
  const safe = { status: 'unaccepted', phase: result.phase, samples,
    packageQuery: last.package?.status ?? 'not-run', processQuery: last.processes?.status ?? 'not-run',
    waiterStage: last.waiter?.stage ?? 'not-observed', events: safeEvents,
    ...(last.waiter?.hresult ? { waiterHresult: last.waiter.hresult } : {}),
    version: last.package?.data?.version, oldPayloadCount: last.processes?.data?.oldPayloadCount,
    oldMainCount: last.processes?.data?.oldMainCount, newMainCount: last.processes?.data?.newMain?.length,
    installerCount: last.processes?.data?.installerCount,
    oldPythonCount: last.processes?.data?.oldPythonCount, oldNodeCount: last.processes?.data?.oldNodeCount,
    oldOtherCount: last.processes?.data?.oldOtherCount,
    installerQuery: installer.status, installerState: installer.data?.installerState,
    installerHresults: installer.data?.hresults,
    installerVisibleWindowCount: installer.data?.visibleWindowCount,
    installerMatchingWindowCount: installer.data?.matchingWindowCount,
    installerConfirmButtonCount: installer.data?.confirmButtonCount,
    ...(deadlineOperation ? { deadlineOperation } : {}) }
  save(receiptFile, { ...safe, installer, last })
  console.log(`[native-observe] ${JSON.stringify(safe)}`)
  return false
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Disposable Windows Actions runner required')
  if (process.argv[3] === 'cleanup') {
    const requestFile = process.argv[2]
    const result = await runProbe(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        fileURLToPath(new URL('./windows-native-probe.ps1', import.meta.url)), '-Operation', 'cleanup', '-RequestPath', requestFile], 90_000)
    save(path.join(path.dirname(requestFile), 'native-package-cleanup.json'), result)
    console.log(`[native-cleanup] status=${result.status}`)
    process.exitCode = result.status === 'ok' && result.data.removed === true ? 0 : 1
  } else {
    observeNativeUpdate(process.argv[2]).then(ok => { process.exitCode = ok ? 0 : 1 }).catch(error => {
      console.error(error.message); process.exitCode = 1
    })
  }
}
