export interface OnboardingTranslations {
  headerTitle: string
  headerDesc: string
  preparingInstall: string
  starting: string
  setupSlowTitle: string
  setupSlowBody: string
  continueWithoutSetup: string
  lookingUpProviders: string
  collapse: string
  otherProviders: string
  haveApiKey: string
  chooseLater: string
  recommended: string
  connected: string
  featuredPitch: string
  fireworksPitch: string
  localModelsTitle: string
  localModelsPitch: string
  openRouterPitch: string
  apiKeyOptions: Record<string, { short: string; description: string; title?: string }>
  backToSignIn: string
  getKey: string
  replaceCurrent: string
  pasteApiKey: string
  localApiKeyPlaceholder: string
  localModelNamePlaceholder: string
  couldNotSave: string
  connecting: string
  update: string
  flowSubtitles: Record<string, string>
  startingSignIn: (provider: string) => string
  verifyingCode: (provider: string) => string
  connectedProvider: (provider: string) => string
  connectedPicking: (provider: string) => string
  signInFailed: string
  signInExpired: string
  signInDidNotFinish: (provider: string) => string
  tryAgain: string
  useApiKeyInstead: string
  errorDetails: string
  pickDifferentProvider: string
  signInWith: (provider: string) => string
  openedBrowser: (provider: string) => string
  authorizeThere: string
  copyAuthCode: string
  pasteAuthCode: string
  reopenAuthPage: string
  waitingAuthorize: string
  externalPending: (provider: string) => string
  signedIn: string
  deviceCodeOpened: (provider: string) => string
  reopenVerification: string
  copy: string
  defaultModel: string
  freeTier: string
  pro: string
  free: string
  price: (input: string, output: string) => string
  change: string
  startChatting: string
  docs: (provider: string) => string

  providerTitle: (id: string, fallback: string) => string

  genericApiKeyDescription: (provider: string) => string

  readyTitle: string

  readyMessage: (provider: string) => string

  gatewayToolsTitle: string

  gatewayToolsMessage: (tools: string) => string

  gatewayToolLabel: (tool: string) => string

  runtimeNotReadyTitle: string

  runtimeNotReadyMessage: string

  providerResolutionFailure: (detail?: string) => string

  startSignInFailed: (detail: string) => string

  pollFailed: (detail: string) => string

  signInStatus: (status: string) => string

  tokenExchangeFailed: string

  externalProviderUnreachable: (provider: string, command: string) => string

  enterValueFirst: string

  saveCredentialFailed: (label: string) => string

  endpointUrlFirst: string

  endpointUnreachable: (url: string) => string

  endpointNoModels: (url: string) => string

  savedEndpointUnreachable: (url: string) => string

  saveEndpointFailed: string

  couldNotChangeModel: string
}
