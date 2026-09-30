/**
 * bootstrap-runner.ts
 *
 * Drives apps/desktop's first-launch install of Hermes Agent by spawning
 * scripts/install.ps1 stage-by-stage and streaming progress events back to
 * the renderer.
 *
 * Wired from electron/main.ts:
 *   import { runBootstrap }from './bootstrap-runner'
 *   const result = await runBootstrap({
 *     installStamp,        // INSTALL_STAMP from main.ts (may be null in dev)
 *     activeRoot,          // ACTIVE_HERMES_ROOT
 *     sourceRepoRoot,      // SOURCE_REPO_ROOT (for dev install.ps1 lookup)
 *     hermesHome,          // HERMES_HOME
 *     logRoot,             // HERMES_HOME/logs
 *     emit: ev => {...}    // event sink (sender.send or similar)
 *   })
 *
 * Emits events with shape:
 *   { type: 'manifest',  stages: [{name, title, category, needs_user_input}, ...] }
 *   { type: 'stage',     name, state: 'running'|'succeeded'|'skipped'|'failed',
 *                        json?, durationMs?, error? }
 *   { type: 'log',       stage?, line, stream: 'stdout'|'stderr' } // one installer line, escapes stripped
 *   { type: 'complete',  marker: <written marker payload> }
 *   { type: 'failed',    stage?, error }     // bootstrap aborted
 *
 * Resolves with the same shape as the final 'complete' or 'failed' event so
 * callers can await either way.
 *
 * NOT implemented yet (deferred to Phase 1E / 1F):
 *   - User-facing retry / cancel from the renderer (event channels exist;
 *     no UI consumes them yet)
 */

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'

// Relative, not `@hermes/shared/ansi`: the electron bundle is built by esbuild
// with no tsconfig path resolution (see scripts/bundle-electron-main.mjs).
import { stripAnsi } from '../../shared/src/ansi'

import { REPOSITORY_PATH, REPOSITORY_SSH_URL, REPOSITORY_URL } from './product-identity'
import { hiddenWindowsChildOptions } from './windows-child-options'

const IS_WINDOWS = process.platform === 'win32'

const STAMP_COMMIT_RE = /^[0-9a-f]{7,40}$/i
const FALLBACK_COMMIT_RE = /^0{7,40}$/
const FALLBACK_BRANCH = 'main'

function isPinnedCommit(commit) {
  return typeof commit === 'string' && STAMP_COMMIT_RE.test(commit) && !FALLBACK_COMMIT_RE.test(commit)
}

type ExecGitFn = (args: string[], cwd: string) => string
type ResolveHeadFn = (activeRoot: string | null | undefined) => string | null

/**
 * Read HEAD from a managed checkout. Used after bootstrap so fallback
 * (all-zero) install stamps still produce a marker that
 * isBootstrapComplete() accepts (pinnedCommit length >= 7).
 */
function resolveCheckoutHead(
  activeRoot: string | null | undefined,
  opts: { execGit?: ExecGitFn; gitBinary?: string } = {}
): string | null {
  if (!activeRoot) {
    return null
  }

  // Bare 'git' takes the first PATH hit, which can exist yet be unlaunchable
  // (Intel-only build on Apple Silicon); main.ts passes its probed binary.
  const run: ExecGitFn =
    opts.execGit ||
    ((args, cwd) =>
      execFileSync(opts.gitBinary || 'git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15_000,
        ...hiddenWindowsChildOptions()
      }).trim())

  try {
    const sha = run(['-c', 'windows.appendAtomically=false', 'rev-parse', 'HEAD'], activeRoot)

    return isPinnedCommit(sha) ? sha : null
  } catch {
    return null
  }
}

/** Prefer a real pin already written by install.ps1's bootstrap-marker stage. */
function readExistingPinnedCommit(activeRoot: string | null | undefined): string | null {
  if (!activeRoot) {
    return null
  }

  try {
    const raw = fs.readFileSync(path.join(activeRoot, '.hermes-bootstrap-complete'), 'utf8')
    const parsed = JSON.parse(raw)

    return parsed && isPinnedCommit(parsed.pinnedCommit) ? parsed.pinnedCommit : null
  } catch {
    return null
  }
}

/**
 * Pick the commit to store on the bootstrap-complete marker.
 * Packaged fallback stamps must NOT win (all-zero is not a real pin); after a
 * successful install the checkout's HEAD (or install.ps1's marker) does.
 */
function resolveMarkerPinnedCommit(
  installStamp: { commit?: string; branch?: string | null } | null | undefined,
  activeRoot: string | null | undefined,
  opts: { resolveHead?: ResolveHeadFn } = {}
): string | null {
  const resolveHead = opts.resolveHead || resolveCheckoutHead

  if (installStamp && isPinnedCommit(installStamp.commit)) {
    return installStamp.commit
  }

  const head = resolveHead(activeRoot)

  if (head) {
    return head
  }

  return readExistingPinnedCommit(activeRoot)
}

/**
 * Map an install stamp to the GitHub ref used to fetch install.ps1/sh.
 * Real CI/git stamps pin an immutable SHA. Non-git fallback stamps carry an
 * all-zero placeholder -- treat those as an unpinned branch ref so bootstrap
 * never asks GitHub for commit 0000000... (#50823).
 */
function installRefForStamp(installStamp) {
  if (installStamp && isPinnedCommit(installStamp.commit)) {
    return {
      ref: installStamp.commit,
      cacheKey: installStamp.commit,
      pinned: true
    }
  }

  if (installStamp && typeof installStamp.commit === 'string' && FALLBACK_COMMIT_RE.test(installStamp.commit)) {
    const ref = installStamp.branch || FALLBACK_BRANCH

    return {
      ref,
      cacheKey: `fallback-${String(ref).replace(/[^0-9A-Za-z._-]/g, '_')}`,
      pinned: false
    }
  }

  return null
}

// Stages flagged needs_user_input=true in the manifest are skipped by the
// runner (passed -NonInteractive to install.ps1, which the install script
// itself handles by emitting skipped=true frames). The renderer / 1E onboarding
// overlay takes over for those concerns (API keys, model, persona, gateway).
// We let install.ps1's own -NonInteractive logic drive this rather than
// filtering client-side -- single source of truth.

// ---------------------------------------------------------------------------
// install.ps1 source resolution
// ---------------------------------------------------------------------------

function installScriptName() {
  return process.platform === 'win32' ? 'install.ps1' : 'install.sh'
}

function installScriptKind() {
  return process.platform === 'win32' ? 'powershell' : 'posix'
}

function resolveLocalInstallScript(sourceRepoRoot) {
  if (!sourceRepoRoot) {
    return null
  }

  const candidate = path.join(sourceRepoRoot, 'scripts', installScriptName())

  try {
    fs.accessSync(candidate, fs.constants.R_OK)

    return candidate
  } catch {
    return null
  }
}

function bootstrapCacheDir(hermesHome) {
  return path.join(hermesHome, 'bootstrap-cache')
}

// The install.sh / install.ps1 that ships inside the already-installed agent
// checkout under ~/.hermes/hermes-agent. Used as a last-resort fallback when
// the pinned commit can't be fetched from GitHub (e.g. a locally-built desktop
// app stamped to an unpushed HEAD).
function installedAgentInstallScript(hermesHome) {
  if (!hermesHome) {
    return null
  }

  const candidate = path.join(hermesHome, 'hermes-agent', 'scripts', installScriptName())

  try {
    fs.accessSync(candidate, fs.constants.R_OK)

    return candidate
  } catch {
    return null
  }
}

function hasExistingGitCheckout(activeRoot) {
  if (!activeRoot) {
    return false
  }

  try {
    return fs.existsSync(path.join(activeRoot, '.git'))
  } catch {
    return false
  }
}

function cachedScriptPath(hermesHome, commit) {
  return path.join(bootstrapCacheDir(hermesHome), `install-${commit}.${process.platform === 'win32' ? 'ps1' : 'sh'}`)
}

const INSTALL_SCRIPT_TIMEOUT_MS = 15_000

function downloadText(url, { headers = {}, redirectCount = 0 } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      const statusCode = res.statusCode || 0
      const location = res.headers.location

      if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < 2) {
        res.resume()
        downloadText(location, { headers, redirectCount: redirectCount + 1 }).then(resolve, reject)

        return
      }

      if (statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${statusCode} from ${url}`))

        return
      }

      const chunks = []
      res.setEncoding('utf8')
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(chunks.join('')))
      res.on('error', reject)
    })

    req.setTimeout(INSTALL_SCRIPT_TIMEOUT_MS, () => {
      req.destroy(new Error(`request timed out after ${INSTALL_SCRIPT_TIMEOUT_MS}ms: ${url}`))
    })
    req.on('error', reject)
  })
}

function writeDownloadedScript(destPath, content) {
  if (!content) {
    throw new Error('downloaded installer is empty')
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  const tmpPath = destPath + '.tmp'

  try {
    fs.writeFileSync(tmpPath, content, 'utf8')
    fs.renameSync(tmpPath, destPath)
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath)
    } catch {
      void 0
    }

    throw err
  }

  return destPath
}

// Fetch from GitHub raw at the install ref. Normal production builds pass a
// pinned SHA (immutable). Non-git fallback builds pass an unpinned branch ref
// so local builds can still bootstrap without pretending the all-zero
// placeholder is a real GitHub commit.
async function downloadInstallScriptRaw(ref, destPath) {
  const scriptName = installScriptName()
  const url = `https://raw.githubusercontent.com/${REPOSITORY_PATH}/${ref}/scripts/${scriptName}`
  const content = await downloadText(url)

  return writeDownloadedScript(destPath, content)
}

// raw.githubusercontent.com is not reachable on some managed networks even
// when api.github.com is available. GitHub's Contents API returns the same
// file at the same immutable ref, base64-encoded; use it only as a fallback so
// ordinary installs keep the lightweight raw path.
async function downloadInstallScriptFromApi(ref, destPath) {
  const scriptName = installScriptName()

  const url =
    `https://api.github.com/repos/${REPOSITORY_PATH}/contents/scripts/${scriptName}` + `?ref=${encodeURIComponent(ref)}`

  const payload = JSON.parse(
    await downloadText(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Aino-Desktop'
      }
    })
  )

  if (!payload || payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    throw new Error('GitHub Contents API returned no base64 installer content')
  }

  const content = Buffer.from(payload.content.replace(/\s+/g, ''), 'base64').toString('utf8')

  return writeDownloadedScript(destPath, content)
}

async function downloadInstallScript(
  ref,
  destPath,
  { _downloadRaw = downloadInstallScriptRaw, _downloadApi = downloadInstallScriptFromApi } = {}
) {
  try {
    return await _downloadRaw(ref, destPath)
  } catch (rawError) {
    try {
      return await _downloadApi(ref, destPath)
    } catch (apiError) {
      throw new Error(
        `GitHub installer download failed (raw: ${rawError?.message || rawError}; ` +
          `API fallback: ${apiError?.message || apiError})`
      )
    }
  }
}

async function resolveInstallScript({
  installStamp,
  sourceRepoRoot,
  hermesHome,
  emit,
  _download = downloadInstallScript
}) {
  // 1. Dev shortcut: prefer a local checkout's installer so we can iterate
  //    without pushing. SOURCE_REPO_ROOT comes from main.ts (path.resolve
  //    of APP_ROOT/../..).
  const localScript = resolveLocalInstallScript(sourceRepoRoot)

  if (localScript) {
    emit({ type: 'log', line: `[bootstrap] using local ${installScriptName()} at ${localScript}` })

    return { path: localScript, source: 'local', kind: installScriptKind() }
  }

  // 2. Packaged path: download from GitHub at the install stamp's ref.
  // Non-git fallback builds carry an all-zero commit; treat that as an
  // unpinned branch ref instead of trying to fetch a non-existent SHA.
  const installRef = installRefForStamp(installStamp)

  if (!installRef) {
    throw new Error(
      `Cannot resolve ${installScriptName()}: no SOURCE_REPO_ROOT and no install stamp. ` +
        'This packaged build was produced without a valid build-time stamp.'
    )
  }

  const cached = cachedScriptPath(hermesHome, installRef.cacheKey)
  const resolvedCommit = installRef.pinned ? installRef.ref : null

  try {
    await fsp.access(cached, fs.constants.R_OK)
    emit({
      type: 'log',
      line: `[bootstrap] using cached ${installScriptName()} for ${installRef.ref.slice(0, 12)}`
    })

    return { path: cached, source: 'cache', commit: resolvedCommit, kind: installScriptKind() }
  } catch {
    // not cached; download
  }

  emit({
    type: 'log',
    line:
      `[bootstrap] fetching ${installScriptName()} for ${installRef.ref.slice(0, 12)} from GitHub` +
      (installRef.pinned ? '' : ' (fallback, unpinned)')
  })

  try {
    await _download(installRef.ref, cached)
    emit({ type: 'log', line: `[bootstrap] saved to ${cached}` })

    return { path: cached, source: 'download', commit: resolvedCommit, kind: installScriptKind() }
  } catch (err) {
    // The pinned commit may not be fetchable from GitHub -- most commonly a
    // locally-built desktop app stamped to an unpushed HEAD (see
    // write-build-stamp.mjs fromLocalGit). Fall back to the installer that
    // ships inside the already-installed agent checkout so dev/self-builds can
    // still bootstrap instead of dying with a fatal 404.
    const installed = installedAgentInstallScript(hermesHome)

    if (installed) {
      emit({
        type: 'log',
        line:
          `[bootstrap] GitHub fetch failed (${err.message}); ` +
          `falling back to installed agent ${installScriptName()} at ${installed}`
      })

      try {
        fs.mkdirSync(path.dirname(cached), { recursive: true })
        fs.copyFileSync(installed, cached)

        return { path: cached, source: 'installed-agent', commit: resolvedCommit, kind: installScriptKind() }
      } catch {
        // Cache copy failed (read-only FS, etc.) -- use the source path directly.
        return { path: installed, source: 'installed-agent', commit: resolvedCommit, kind: installScriptKind() }
      }
    }

    throw err
  }
}

// ---------------------------------------------------------------------------
// powershell wrapper
// ---------------------------------------------------------------------------

// Canonical PowerShell 5.1 location under a Windows root (%SystemRoot%).
function powershellUnderRoot(root) {
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

// Resolve the PowerShell interpreter to spawn.
//
// Spawning bare 'powershell.exe' trusts PATH to contain
// %SystemRoot%\System32\WindowsPowerShell\v1.0. On machines whose PATH was
// trimmed, truncated, or stored as a non-expanding REG_SZ (so %SystemRoot%
// never expands), that lookup fails and the spawn dies with ENOENT before
// install.ps1 ever runs — the installer stalls at "0 of 0 steps". Resolve by
// absolute path first, then fall back to PATH (powershell 5.1, then pwsh 7),
// then a bare name as a last resort.
function resolveWindowsPowerShell() {
  for (const v of ['SystemRoot', 'windir']) {
    const root = process.env[v]

    if (root) {
      const candidate = powershellUnderRoot(root)

      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate
        }
      } catch {
        void 0
      }
    }
  }

  const pathDirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)

  for (const exe of ['powershell.exe', 'pwsh.exe']) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, exe)

      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate
        }
      } catch {
        void 0
      }
    }
  }

  return 'powershell.exe'
}

function buildInstallerEnv(
  hermesHome: string | null | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    HERMES_HOME: hermesHome || baseEnv.HERMES_HOME || '',
    // The installer defaults remain upstream-compatible for direct CLI use.
    // Desktop bootstrap must install from the same branded repository as the
    // script/build stamp; otherwise a downstream branch is looked up on the
    // upstream remote and fresh install fails before the venv stage.
    HERMES_INSTALL_REPOSITORY_URL: REPOSITORY_URL,
    HERMES_INSTALL_REPOSITORY_SSH_URL: REPOSITORY_SSH_URL
  }
}

// install.sh (and the git/curl/uv children it drives) writes SGR colours,
// cursor/erase sequences, OSC titles and \r progress redraws into the pipe as
// if it were a TTY. The install overlay renders each line as plain text, so
// strip them ONCE here, at the emitter: the main-process log ring, the
// renderer's Details panel and "Copy output" all read the same clean line
// (#112675). \r redraws collapse to the last frame a terminal would show.
function cleanInstallerLogLine(raw: string): string {
  const frames = raw.split('\r').map(stripAnsi).filter(Boolean)

  return frames.length ? frames[frames.length - 1] : ''
}

function spawnPowerShell(scriptPath, args, { emit, stageName, abortSignal, hermesHome }: any = {}) {
  return new Promise<any>((resolve, reject) => {
    const ps = process.platform === 'win32' ? resolveWindowsPowerShell() : 'pwsh'
    const fullArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]

    const child = spawn(
      ps,
      fullArgs,
      hiddenWindowsChildOptions({
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildInstallerEnv(hermesHome)
      })
    )

    let stdout = ''
    let stderr = ''
    let killed = false

    const onAbort = () => {
      killed = true

      try {
        child.kill('SIGTERM')
      } catch {
        void 0
      }
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort()
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    // Stream stdout line-by-line so the renderer sees progress in real time.
    let stdoutBuf = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      stdoutBuf += chunk
      let nl

      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = cleanInstallerLogLine(stdoutBuf.slice(0, nl))
        stdoutBuf = stdoutBuf.slice(nl + 1)

        if (line) {
          emit && emit({ type: 'log', stage: stageName, line, stream: 'stdout' })
        }
      }
    })

    let stderrBuf = ''
    child.stderr.on('data', chunk => {
      stderr += chunk
      stderrBuf += chunk
      let nl

      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = cleanInstallerLogLine(stderrBuf.slice(0, nl))
        stderrBuf = stderrBuf.slice(nl + 1)

        if (line) {
          emit && emit({ type: 'log', stage: stageName, line, stream: 'stderr' })
        }
      }
    })

    child.on('error', err => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort)
      }

      reject(err)
    })

    child.on('close', (code, signal) => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort)
      }

      // Flush any trailing bytes
      const stdoutTail = cleanInstallerLogLine(stdoutBuf)
      const stderrTail = cleanInstallerLogLine(stderrBuf)

      if (stdoutTail) {
        emit && emit({ type: 'log', stage: stageName, line: stdoutTail, stream: 'stdout' } as any)
      }

      if (stderrTail) {
        emit && emit({ type: 'log', stage: stageName, line: stderrTail, stream: 'stderr' } as any)
      }

      resolve({ stdout, stderr, code, signal, killed } as any)
    })
  })
}

function spawnBash(scriptPath, args, { emit, stageName, abortSignal, hermesHome }: any = {}) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn('bash', [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildInstallerEnv(hermesHome)
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const onAbort = () => {
      killed = true

      try {
        child.kill('SIGTERM')
      } catch {
        void 0
      }
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort()
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    let stdoutBuf = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      stdoutBuf += chunk
      let nl

      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = cleanInstallerLogLine(stdoutBuf.slice(0, nl))
        stdoutBuf = stdoutBuf.slice(nl + 1)

        if (line) {
          emit && emit({ type: 'log', stage: stageName, line, stream: 'stdout' })
        }
      }
    })

    let stderrBuf = ''
    child.stderr.on('data', chunk => {
      stderr += chunk
      stderrBuf += chunk
      let nl

      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = cleanInstallerLogLine(stderrBuf.slice(0, nl))
        stderrBuf = stderrBuf.slice(nl + 1)

        if (line) {
          emit && emit({ type: 'log', stage: stageName, line, stream: 'stderr' })
        }
      }
    })

    child.on('error', err => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort)
      }

      reject(err)
    })

    child.on('close', (code, signal) => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort)
      }

      const stdoutTail = cleanInstallerLogLine(stdoutBuf)
      const stderrTail = cleanInstallerLogLine(stderrBuf)

      if (stdoutTail) {
        emit && emit({ type: 'log', stage: stageName, line: stdoutTail, stream: 'stdout' })
      }

      if (stderrTail) {
        emit && emit({ type: 'log', stage: stageName, line: stderrTail, stream: 'stderr' })
      }

      resolve({ stdout, stderr, code, signal, killed })
    })
  })
}

// ---------------------------------------------------------------------------
// Manifest + stage dispatch
// ---------------------------------------------------------------------------

// Build the installer branch/pin args from the install stamp. The commit pin
// is fresh-install only: once a managed checkout already exists, bootstrap is
// a repair/update path and must not let an old packaged app detach the checkout
// back to the commit baked into that app. All-zero fallback stamps are never
// passed as -Commit/--commit — only the branch is used (#50823 / #50864 review).
function buildPinArgs(installStamp, { pinCommit = true } = {}) {
  const args = []

  if (pinCommit && installStamp && isPinnedCommit(installStamp.commit)) {
    args.push('-Commit', installStamp.commit)
  }

  if (installStamp && installStamp.branch) {
    args.push('-Branch', installStamp.branch)
  }

  return args
}

function buildPosixPinArgs({ installStamp, activeRoot, hermesHome, pinCommit = true }) {
  const args = ['--dir', activeRoot, '--hermes-home', hermesHome]

  if (installStamp && installStamp.branch) {
    args.push('--branch', installStamp.branch)
  }

  if (pinCommit && installStamp && isPinnedCommit(installStamp.commit)) {
    args.push('--commit', installStamp.commit)
  }

  return args
}

async function fetchManifest({
  scriptPath,
  installerKind,
  emit,
  hermesHome,
  activeRoot,
  installStamp,
  pinCommit,
  abortSignal
}) {
  abortSignal?.throwIfAborted()
  const isPosix = installerKind === 'posix'

  const args = isPosix
    ? ['--manifest', ...buildPosixPinArgs({ installStamp, activeRoot, hermesHome, pinCommit })]
    : ['-Manifest', ...buildPinArgs(installStamp, { pinCommit })]

  const result = await (isPosix ? spawnBash : spawnPowerShell)(scriptPath, args, {
    emit,
    stageName: '__manifest__',
    abortSignal,
    hermesHome
  })

  if (result.code !== 0) {
    // The tail lands in the Setup failure banner, not the log ring, so strip
    // the installer's colour/OSC bytes here too (#112675).
    const tail = stripAnsi(result.stderr || result.stdout).trim()

    throw new Error(
      `${isPosix ? 'install.sh --manifest' : 'install.ps1 -Manifest'} failed: exit ${result.code}\n${tail}`
    )
  }

  // The manifest is the LAST JSON line on stdout (install.ps1 may print
  // banner / info lines first depending on Console.OutputEncoding effects).
  // Find the last line that parses as JSON with a `stages` field.
  const lines = result.stdout.split(/\r?\n/).filter(Boolean)

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])

      if (parsed && Array.isArray(parsed.stages)) {
        return parsed
      }
    } catch {
      void 0
    }
  }

  throw new Error(
    `${isPosix ? 'install.sh --manifest' : 'install.ps1 -Manifest'} produced no parseable JSON payload\n${result.stdout}`
  )
}

// Parse the JSON result frame from a stage run. The protocol guarantees
// exactly one JSON line per stage in -Json or -Stage mode (post #27224 fix
// for the double-emit bug we addressed in the install.ps1 PR).
function parseStageResult(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean)

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])

      if (parsed && typeof parsed.ok === 'boolean' && typeof parsed.stage === 'string') {
        return parsed
      }
    } catch {
      void 0
    }
  }

  return null
}

async function runStage({
  scriptPath,
  installerKind,
  stage,
  emit,
  hermesHome,
  activeRoot,
  abortSignal,
  installStamp,
  pinCommit
}) {
  const startedAt = Date.now()
  emit({ type: 'stage', name: stage.name, state: 'running' })

  const isPosix = installerKind === 'posix'

  const args = isPosix
    ? [
        '--stage',
        stage.name,
        '--non-interactive',
        '--json',
        ...buildPosixPinArgs({ installStamp, activeRoot, hermesHome, pinCommit })
      ]
    : ['-Stage', stage.name, '-NonInteractive', '-Json', ...buildPinArgs(installStamp, { pinCommit })]

  const result = await (isPosix ? spawnBash : spawnPowerShell)(scriptPath, args, {
    emit,
    stageName: stage.name,
    abortSignal,
    hermesHome
  })

  const durationMs = Date.now() - startedAt

  if (result.killed) {
    const ev = { type: 'stage', name: stage.name, state: 'failed', durationMs, error: 'cancelled by user' }
    emit(ev)

    return ev
  }

  const json = parseStageResult(result.stdout)

  if (!json) {
    const ev = {
      type: 'stage',
      name: stage.name,
      state: 'failed',
      durationMs,
      error: `${isPosix ? 'install.sh --stage' : 'install.ps1 -Stage'} ${stage.name} produced no JSON result frame (exit=${result.code})`,
      json: null
    }

    emit(ev)

    return ev
  }

  if (json.ok && json.skipped) {
    const ev = { type: 'stage', name: stage.name, state: 'skipped', durationMs, json }
    emit(ev)

    return ev
  }

  if (json.ok) {
    const ev = { type: 'stage', name: stage.name, state: 'succeeded', durationMs, json }
    emit(ev)

    return ev
  }

  const ev = {
    type: 'stage',
    name: stage.name,
    state: 'failed',
    durationMs,
    json,
    error: json.reason || `exit code ${result.code}`
  }

  emit(ev)

  return ev
}

// ---------------------------------------------------------------------------
// Per-run log file
// ---------------------------------------------------------------------------

function openRunLog(logRoot) {
  fs.mkdirSync(logRoot, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = path.join(logRoot, `bootstrap-${ts}.log`)
  const stream = fs.createWriteStream(logPath, { flags: 'a' })

  return { path: logPath, stream }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

async function runBootstrap(opts) {
  const {
    installStamp,
    activeRoot,
    sourceRepoRoot,
    hermesHome,
    logRoot,
    onEvent,
    abortSignal,
    writeMarker, // callback to write the bootstrap-complete marker; main.ts provides
    gitBinary // probed git path from main.ts; bare 'git' when absent
  } = opts

  // Bail before spawning anything if the user already cancelled — otherwise an
  // already-aborted signal would still fetch the manifest (a spawn) before the
  // in-loop abort check fires.
  if (abortSignal && abortSignal.aborted) {
    if (typeof onEvent === 'function') {
      try {
        onEvent({ type: 'failed', error: 'bootstrap cancelled by user' })
      } catch {
        void 0
      }
    }

    return { ok: false, cancelled: true }
  }

  const runLog = openRunLog(logRoot || path.join(hermesHome, 'logs'))

  // Tee every event to the runLog AND the caller's onEvent. This gives us a
  // forensic trail per bootstrap run AND lets the renderer subscribe live.
  const emit = ev => {
    try {
      runLog.stream.write(JSON.stringify(ev) + '\n')
    } catch {
      void 0
    }

    try {
      if (typeof onEvent === 'function') {
        onEvent(ev)
      }
    } catch (err) {
      // Don't let a subscriber bug crash the bootstrap
      runLog.stream.write(`emit error: ${err && err.message}\n`)
    }
  }

  emit({
    type: 'log',
    line:
      `[bootstrap] starting at ${new Date().toISOString()}; ` +
      `activeRoot=${activeRoot}; ` +
      `stamp=${installStamp ? installStamp.commit.slice(0, 12) : '<none>'}; ` +
      `runLog=${runLog.path}`
  })

  try {
    const existingCheckout = hasExistingGitCheckout(activeRoot)
    const pinCommit = !existingCheckout

    if (existingCheckout && installStamp && installStamp.commit) {
      emit({
        type: 'log',
        line:
          `[bootstrap] existing checkout detected at ${activeRoot}; ` +
          `not pinning to packaged install stamp ${installStamp.commit.slice(0, 12)}`
      })
    }

    // 1. Resolve the platform installer.
    const scriptInfo = await resolveInstallScript({ installStamp, sourceRepoRoot, hermesHome, emit })
    abortSignal?.throwIfAborted()

    const installerKind = scriptInfo.kind || 'powershell'

    // 2. Fetch manifest
    const manifest = await fetchManifest({
      scriptPath: scriptInfo.path,
      installerKind,
      emit,
      hermesHome,
      activeRoot,
      installStamp,
      pinCommit,
      abortSignal
    })

    abortSignal?.throwIfAborted()

    emit({
      type: 'manifest',
      stages: manifest.stages,
      protocolVersion: manifest.protocol_version || manifest.protocolVersion || null
    })

    // 3. Iterate stages in order. Stages flagged needs_user_input are still
    //    invoked -- install.ps1's own -NonInteractive handler in those stages
    //    emits skipped=true. We trust the protocol rather than filtering
    //    client-side.
    for (const stage of manifest.stages) {
      if (abortSignal && abortSignal.aborted) {
        emit({ type: 'failed', error: 'bootstrap cancelled by user' })

        return { ok: false, cancelled: true }
      }

      const ev = await runStage({
        scriptPath: scriptInfo.path,
        installerKind,
        stage,
        emit,
        hermesHome,
        activeRoot,
        abortSignal,
        installStamp,
        pinCommit
      })

      if (ev.state === 'failed') {
        emit({ type: 'failed', stage: stage.name, error: (ev as any).error || 'stage failed' })

        return { ok: false, failedStage: stage.name, error: (ev as any).error }
      }
    }

    // 4. Write the bootstrap-complete marker. Fallback (all-zero) stamps are
    // not real pins -- resolve HEAD from the checkout we just installed so
    // isBootstrapComplete() (pinnedCommit.length >= 7) accepts the marker
    // instead of re-running bootstrap on every launch (#50823 review).
    const pinnedCommit = resolveMarkerPinnedCommit(installStamp, activeRoot, {
      resolveHead: root => resolveCheckoutHead(root, { gitBinary })
    })

    if (!pinnedCommit) {
      emit({
        type: 'log',
        line:
          '[bootstrap] WARNING: could not resolve a real pinnedCommit for the ' +
          'bootstrap-complete marker; subsequent launches may re-run bootstrap'
      })
    } else if (installStamp && !isPinnedCommit(installStamp.commit)) {
      emit({
        type: 'log',
        line: `[bootstrap] fallback stamp resolved marker pin to ${pinnedCommit.slice(0, 12)} from checkout`
      })
    }

    const markerPayload = {
      pinnedCommit,
      pinnedBranch: installStamp ? installStamp.branch : null
    }

    const marker = typeof writeMarker === 'function' ? writeMarker(markerPayload) : markerPayload
    emit({ type: 'complete', marker })

    return { ok: true, marker }
  } catch (err) {
    if (abortSignal?.aborted) {
      emit({ type: 'failed', error: 'bootstrap cancelled by user' })

      return { ok: false, cancelled: true }
    }

    emit({ type: 'failed', error: err.message || String(err) })

    return { ok: false, error: err.message || String(err) }
  } finally {
    try {
      await new Promise<void>(resolve => runLog.stream.end(resolve))
    } catch {
      void 0
    }
  }
}

export {
  buildInstallerEnv,
  buildPinArgs,
  buildPosixPinArgs,
  cachedScriptPath,
  cleanInstallerLogLine,
  downloadInstallScript,
  hasExistingGitCheckout,
  installedAgentInstallScript,
  installRefForStamp,
  isPinnedCommit,
  // Exposed for testability
  parseStageResult,
  resolveCheckoutHead,
  resolveInstallScript,
  resolveLocalInstallScript,
  resolveMarkerPinnedCommit,
  runBootstrap
}
