export interface ArtifactsCopy {
  search: string
  refresh: string
  refreshing: string
  indexing: string
  tabAll: string
  tabImages: string
  tabFiles: string
  tabLinks: string
  noArtifactsTitle: string
  noArtifactsDesc: string
  failedLoad: string
  openFailed: string
  itemsImage: string
  itemsLink: string
  itemsFile: string
  itemsGeneric: string
  zero: string
  rangeOf: (start: number, end: number, total: number) => string
  goToPage: (itemLabel: string, page: number) => string
  colTitleLink: string
  colTitleFile: string
  colTitleDefault: string
  colLocationLink: string
  colLocationFile: string
  colLocationDefault: string
  colSession: string
  kindImage: string
  kindFile: string
  kindLink: string
  chat: string
  copyUrl: string
  copyPath: string
  partialLoadMessage: (failed: number, total: number) => string
  safeLoadFailure: (count: number) => string
  unreadableFailure: (count: number) => string
}

export interface ArtifactCardCopy {
  kind: Record<'code' | 'html' | 'svg', string>
  generating: (lines: number) => string
  versionBadge: (count: number) => string
  open: string
  openWith: string
}

export interface ArtifactPreviewCopy {
  versionOf: (current: number, total: number) => string
  olderVersion: string
  newerVersion: string
  latest: string
  copyContent: string
  download: string
  openExternally: string
  openExternallyFailed: string
  missingTitle: string
  missingBody: string
}
