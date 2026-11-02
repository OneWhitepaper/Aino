export const DISCOVERY_PATH_KEYS = ['desktop.repo_scan_roots', 'desktop.repo_scan_exclude_paths']

export function workspaceDiscoveryPathsVisible(
  hasScanField: boolean,
  scanEnabled: boolean,
  revealDiscovery: boolean,
  targetField: string | null
) {
  return (
    !hasScanField ||
    scanEnabled ||
    revealDiscovery ||
    (targetField !== null && DISCOVERY_PATH_KEYS.includes(targetField))
  )
}

interface WorkspaceDiscoverySummaryCopy {
  disabled: string
  empty: string
  summary: string
}

export function workspaceDiscoverySummary(
  copy: WorkspaceDiscoverySummaryCopy,
  scanEnabled: boolean,
  rootsCount: number,
  exclusionsCount: number
) {
  return !scanEnabled
    ? copy.disabled
    : rootsCount === 0
      ? copy.empty
      : copy.summary.replace('{roots}', String(rootsCount)).replace('{excluded}', String(exclusionsCount))
}
