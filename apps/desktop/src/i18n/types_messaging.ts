/** Messaging setup, platform status and connection copy shared by every locale. */
export interface MessagingTranslations {
  directory: {
    statusFilters: string
    title: string
    subtitle: string
    common: string
    commonHint: string
    more: string
    moreHint: string
    integrations: string
    integrationsHint: string
    all: string
    configured: string
    attention: string
    configure: string
    sendOnly: string
    privacy: string
    noMatches: string
    noMatchesHint: string
    showAll: string
    discardTitle: string
    discardHint: string
    discard: string
  }
  search: string
  statusFilter: Record<'all' | 'bad' | 'good' | 'muted' | 'warn', string>
  loading: string
  loadFailed: string
  states: Record<string, string>
  unknown: string
  hintPendingRestart: string
  sharedListenerUrl: string
  hintGatewayStopped: string
  credentialsSet: string
  needsSetup: string
  gatewayStopped: string
  getCredentials: string
  openSetupGuide: string
  required: string
  recommended: string
  advanced: (count: number) => string
  noTokenNeeded: string
  enabled: string
  disabled: string
  unsavedChanges: string
  saving: string
  saveChanges: string
  saved: string
  replaceValue: string
  openDocs: string
  clearField: (key: string) => string
  addListEntry: string
  removeListEntry: string
  listEntryPlaceholder: string
  enableAria: (name: string) => string
  disableAria: (name: string) => string
  platformEnabled: (name: string) => string
  platformDisabled: (name: string) => string
  restartToApply: string
  setupSaved: (name: string) => string
  restartToReconnect: string
  appliedLive: string
  connectingLive: string
  keyCleared: (key: string) => string
  setupUpdated: (name: string) => string
  failedUpdate: (name: string) => string
  failedSave: (name: string) => string
  failedClear: (key: string) => string
  pendingRequests: (count: number) => string
  pendingAria: (count: number) => string
  approvedUsers: (count: number) => string
  approve: string
  approving: string
  revoke: string
  revoking: string
  revokeAria: (name: string) => string
  revokeTitle: string
  revokeDesc: (name: string) => string
  approvedUser: (name: string) => string
  approvedHint: string
  revokedUser: (name: string) => string
  failedApprove: (name: string) => string
  failedRevoke: (name: string) => string
  pairingLockedOut: string
  waitingSince: (minutes: number) => string
  restartNeeded: string
  restartNow: string
  restarting: string
  restartFailedManual: string
  restartFailedManualDetail: string
  restartAgain: string
  openLogs: string
  relayLink: {
    title: string
    badge: string
    intro: (platform: string) => string
    link: (platform: string) => string
    linkAnother: (platform: string) => string
    linkedAccounts: string
    unlink: string
    unlinkFailed: string
    stepOpen: (platform: string) => string
    stepSend: string
    open: (platform: string) => string
    copy: string
    copied: string
    copyFailed: (command: string) => string
    waiting: string
    linked: (platform: string) => string
    expired: string
    refused: (platform: string) => string
    qrAlt: (platform: string) => string
    managed: string
    managedNote: (platform: string) => string
    managedIntro: string
    openPortal: string
    noNewAccount: (platform: string) => string
  }
  telegramQr: {
    title: string
    subtitle: string
    quickSetup: string
    recommended: string
    quickHelp: string
    createWithQr: string
    starting: string
    replaceWarning: string
    scanHint: string
    waiting: string
    expiresIn: (remaining: string) => string
    expired: string
    openTelegram: string
    ready: string
    allowedUsers: string
    ownerDetected: string
    addAtLeastOne: string
    userIdPlaceholder: string
    add: string
    numericOnly: string
    saveAndRestart: string
    applying: string
    pairingExpired: string
    stillWaiting: (detail: string) => string
    savedRestarting: string
    savedRestartFailed: (detail: string) => string
  }
  fieldCopy: Record<string, { label?: string; help?: string; placeholder?: string }>
  platformIntro: Record<string, string>
}
