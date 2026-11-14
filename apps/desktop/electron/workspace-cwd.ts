import path from 'node:path'

interface WorkspaceCwdOptions {
  defaultProjectDir: string | null | undefined
  accountHome?: string
  isPackaged: boolean
  sourceRepoRoot: string
  home: string
  directoryExists(directory: string): boolean
  isPackagedInstallPath(directory: string): boolean
  env?: NodeJS.ProcessEnv
  cwd?: string
}

/** Keep sessions and recovery helpers out of the app bundle, respecting the owning account. */
export function resolveWorkspaceCwd(options: WorkspaceCwdOptions): string {
  const env = options.env ?? process.env

  const candidates = [
    options.defaultProjectDir,
    options.accountHome ?? env.HERMES_DESKTOP_CWD,
    options.isPackaged ? null : env.INIT_CWD,
    options.isPackaged ? null : (options.cwd ?? process.cwd()),
    options.isPackaged ? null : options.sourceRepoRoot,
    options.home
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const resolved = path.resolve(String(candidate))

    if (!options.isPackagedInstallPath(resolved) && options.directoryExists(resolved)) {
      return resolved
    }
  }

  return options.home
}

/** True when `dir` lives inside a packaged app bundle / install tree. */
function isPackagedInstallPath(dir, { installRoots, isPackaged }: { installRoots: string[]; isPackaged: boolean }) {
  if (!isPackaged || !dir) {
    return false
  }

  let resolved

  try {
    resolved = path.resolve(String(dir))
  } catch {
    return false
  }

  const roots = new Set((installRoots ?? []).filter(Boolean).map(candidate => path.resolve(String(candidate))))

  for (const root of roots) {
    if (resolved === root) {
      return true
    }

    const rel = path.relative(root, resolved) as any

    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return true
    }
  }

  return false
}

export { isPackagedInstallPath }
