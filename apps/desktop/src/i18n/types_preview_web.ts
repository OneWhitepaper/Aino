export interface PreviewWebCopy {
  embeddedPreviewHint: string
  appFailedToBoot: string
  serverNotFound: string
  remoteLoopback: string
  failedToLoad: string
  tryAgain: string
  restarting: string
  askRestart: string
  lookingRestart: (taskId: string) => string
  restartingTitle: string
  restartingMessage: string
  startRestartFailed: (message: string) => string
  restartFailed: string
  hideConsole: string
  showConsole: string
  hideDevTools: string
  openDevTools: string
  goBack: string
  goForward: string
  reload: string
  address: string
  addressPlaceholder: string
  blankPageBody: string
  finishedRestarting: (message?: string) => string
  failedRestarting: (message: string) => string
  unknownError: string
  restartedTitle: string
  reloadingNow: string
  restartFailedTitle: string
  restartFailedMessage: string
  stillWorking: string
  workspaceReloading: string
  fileChanged: (url: string) => string
  filesChanged: (count: number, url: string) => string
  watchFailed: (message: string) => string
  moduleMimeDescription: string
  loadFailedConsole: (code: number | undefined, message: string) => string
  unreachableDescription: string
  openTarget: (url: string) => string
  fallbackTitle: string
  annotate: string
  annotateOn: string
  annotateNeedPage: string
  annotateFailed: string
  commenting: string
  addComments: (count: number) => string
  commentPlaceholder: string
  commentTitle: (n: number) => string
  saveComment: string
  cancelComment: string
  vaultFill: string
  vaultTitle: (site: string) => string
  vaultLoading: string
  vaultEmpty: string
  vaultUnlock: (name: string) => string
  vaultOpenSettings: string
  vaultFilled: (label: string) => string
  vaultFillFailed: string
  vaultLoadFailed: string
  vaultPageNotReady: string

  restartNoActiveSession: string

  restartMissingTaskId: string
}
