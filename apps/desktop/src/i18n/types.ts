// Desktop i18n type contract.
//
// `Translations` is the single source of truth for every translatable string
// surface. Fully translated locale files may satisfy this interface directly;
// partial locales should use `defineLocale()` so missing desktop-only strings
// fall back to English while new keys remain type-checked.

import type { ErrorCodeKey } from '@/lib/error-surface'
import type { TipId } from '@/lib/tips/catalog'

export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ar' | 'ru'

/** One error-card entry: a short title and one plain sentence. Either may
 *  take the failing provider's display name (falls back to "the AI service"). */
export interface ErrorCardCopy {
  title: string | ((provider: string) => string)
  body: string | ((provider: string) => string)
}

export type ToolTitleKey =
  | 'browser_click'
  | 'browser_fill'
  | 'browser_navigate'
  | 'browser_snapshot'
  | 'browser_take_screenshot'
  | 'browser_type'
  | 'clarify'
  | 'cronjob'
  | 'edit_file'
  | 'execute_code'
  | 'image_generate'
  | 'list_files'
  | 'memory'
  | 'patch'
  | 'read_file'
  | 'search_files'
  | 'session_search_recall'
  | 'terminal'
  | 'todo'
  | 'vision_analyze'
  | 'web_extract'
  | 'web_search'
  | 'write_file'

interface ToolTitleCopy {
  done: string
  pending: string
  pendingAction: string
}

interface ModeOptionCopy {
  label: string
  description: string
}

interface AuxTaskCopy {
  label: string
  hint: string
}

interface UpstreamTranslations {
  connectors: {
    title: string
    connect: string
    skip: string
    cancel: string
    retry: string
    grant: string
    connected: string
    checking: string
    notConnected: string
    skipped: string
    disabled: string
    failed: string
    needsAuth: string
    opening: string
    waiting: string
    timeout: string
    refresh: string
    connectError: string
    connectErrorFor: (app: string) => string
    unavailable: string
    ownerMissing: string
    search: string
    empty: string
    disclaimer: string
    execution: string
    setup: (server: string) => string
    openInBrowser: string
    setupCancel: string
    authorizedToolsUnavailable: string
    required: string
  }
  sessionImport: {
    title: string
    subtitle: string
    action: string
    readingFrom: string
    connectedComputer: string
    destination: string
    all: string
    search: string
    scanning: string
    scanError: string
    scanHelp: string
    empty: string
    emptyHelp: string
    noMatches: string
    searchHelp: string
    skipped: string
    more: string
    messages: string
    choose: string
    chooseHelp: string
    previewLoading: string
    previewError: string
    previewHelp: string
    previewLimit: string
    you: string
    snapshot: string
    copyNotice: string
    importing: string
    open: string
    continue: string
    importError: string
  }
  platformUsage: {
    pending: string
    partial: string
    settled: string
    unverified: string
    unavailable: string
    signIn: string
    retry: string
    details: string
    empty: string
    truncated: string
    recordSettled: string
    notCharged: string
    purposes: {
      chat: string
      title: string
      compression: string
      vision: string
      delegation: string
      session_summary: string
      approval: string
      mcp: string
      tts_audio_tags: string
      side_question: string
      other_auxiliary: string
    }
  }
  platformBillingHistory: {
    orders: string
    usage: string
    empty: string
    previous: string
    next: string
    open: string
    error: string
    retry: string
    qrCode: string
    filters: string
    startDate: string
    endDate: string
    model: string
    modelPlaceholder: string
    purpose: string
    allPurposes: string
    search: string
    reset: string
    invalidDateRange: string
    timezone: (zone: string) => string
    totalRecords: (count: number) => string
    pageSize: string
    goToPage: (page: number) => string
    jumpToPage: string
    jump: string
    noMatches: string
    columns: { time: string; model: string; purpose: string; cost: string; status: string }
    details: string
    hideDetails: string
    copyField: (label: string) => string
    requestId: string
    sessionId: string
    turnId: string
    callId: string
    inputTokens: string
    outputTokens: string
    cacheReadTokens: string
    cacheWriteTokens: string
    unknown: string
    unknownPurpose: string
    unclassifiedHelp: string
  }
  platformModels: {
    switchBusy: string
    switchRecovery: string
    builtIn: string
    custom: string
    search: string
    signIn: string
    loading: string
    retry: string
    myAccount: string
    chooseCustom: string
    recoveryFor: (model: string) => string
    unavailable: string
    empty: string
    catalogError: string
    balance: string
    subscription: string
    insufficient_balance: string
    quota_exhausted: string
    details: string
    input: string
    output: string
    cacheRead: string
    cacheWrite: string
    context: string
    tools: string
    vision: string
    reasoning: string
    defaultModel: string
    followCustom: string
    defaultTag: string
    not_authenticated: string
    platform_account_changed: string
    bindingFailed: string
    unsupported: string
    rate: string
    tiers: string
    timePricing: string
    groupPeak: string
    unknown: string
    supported: string
    unsupportedCapability: string
  }
  common: {
    apply: string
    back: string
    save: string
    saving: string
    cancel: string
    change: string
    choose: string
    clear: string
    close: string
    actions: string
    collapse: string
    confirm: string
    connect: string
    connecting: string
    continue: string
    bots: string
    copied: string
    copy: string
    copyFailed: string
    clipboardUnavailable: string
    delete: string
    docs: string
    done: string
    error: string
    expand: string
    failed: string
    formatJson: string
    free: string
    loading: string
    notSet: string
    refresh: string
    remove: string
    replace: string
    retry: string
    run: string
    send: string
    set: string
    skip: string
    update: string
    tryHint: (term: string) => string
    on: string
    off: string
  }

  /** Empty-chat landing surface copy and quick actions. */
  home: {
    subtitle: string
    placeholder: string
    workspace: string
    actions: {
      analyze: { label: string; description: string; prompt?: string }
      review: { label: string; description: string; prompt?: string }
      research: { label: string; description: string; prompt?: string }
      report: { label: string; description: string; prompt?: string }
    }
  }

  fileMenu: {
    revealFinder: string
    revealExplorer: string
    revealFileManager: string
    revealInSidebar: string
    copyPath: string
    copyRelativePath: string
    download: string
    downloadSaved: string
    downloadFailed: string
    rename: string
    delete: string
    renameTitle: string
    renameLabel: string
    deleteTitle: (name: string) => string
    deleteBody: string
    pathCopied: string
    revealMissing: string
    revealUnavailable: string
  }

  boot: {
    ready: string
    desktopBootFailedWithMessage: (message: string) => string
    steps: {
      connectingGateway: string
      loadingSettings: string
      loadingSessions: string
      retryingRemoteBackend: string
      startingDesktopConnection: string
      startingHermesDesktop: string
    }
    errors: {
      backgroundExited: string
      backgroundExitedDuringStartup: string
      backendStopped: string
      restartHermes: string
      openLogs: string
      desktopBootFailed: string
      gatewayConnectionLost: string
      gatewayConnectionLostDetail: string
      reconnectNow: string
      connectionSettings: string
      gatewaySignInRequired: string
      gatewaySignInRequiredDetail: string
      signInAgain: string
      ipcBridgeUnavailable: string
      backendConnectionTimeout: string
      gatewayRevalidationTimeout: string
      gatewayReconnectTimeout: string
      gatewayWsRemintTimeout: string
      gatewayFallbackTimeout: string
      gatewayWsMintTimeout: string
    }
    causes: {
      exitedEarly: string
      timedOut: string
      permission: string
      diskFull: string
      portInUse: string
      installMissing: string
    }
    failure: {
      title: string
      description: string
      details: string
      remoteTitle: string
      remoteDescription: string
      retry: string
      repairInstall: string
      useLocalGateway: string
      gatewaySettings: string
      back: string
      openLogs: string
      repairHint: string
      remoteSignInHint: (signInLabel: string) => string
      signOutAndSignIn: string
      remoteFailureHint: string
      cloudDownTitle: string
      cloudDownDescription: string
      cloudDownHint: string
      cloudDownCheckPortal: string
      cloudDownDiscord: string
      hideRecentLogs: string
      showRecentLogs: string
      signedInTitle: string
      signedInMessage: string
      signInIncompleteTitle: string
      signInIncompleteMessage: string
      signInFailed: string
      signInToRemoteGateway: string
      signInWithProvider: (provider: string) => string
      identityProvider: string
      /** Fixed Electron boot prefixes with backend diagnostics appended. */
      backendStartFailed: (message: string, profile?: string) => string
      backendExitedBeforeReady: (status: string, suffix: string, profile?: string) => string
    }
  }

  notifications: {
    auxiliaryBillingSource: (provider: string) => string
    region: string
    hide: string
    show: string
    more: (count: number) => string
    clearAll: string
    dismiss: string
    details: string
    copyDetail: string
    copyDetailFailed: string
    backendOutOfDateTitle: string
    backendOutOfDateMessage: string
    installMethodUnsupportedTitle: string
    updateHermes: string
    updateReadyTitle: string
    updateReadyMessage: (count: number) => string
    updateReadyMessageUnknown: string
    seeWhatsNew: string
    mcp: {
      needsAuthTitle: string
      needsAuthMessage: (name: string) => string
      errorTitle: string
      errorMessage: (name: string) => string
      signIn: string
      view: string
      disable: string
      disabledMessage: (name: string) => string
      disableFailed: (name: string) => string
    }
    errors: {
      elevenLabsNeedsKey: string
      elevenLabsRejectedKey: string
      diskFull: string
      storageFailure: string
      gatewayAuthFailed: string
      methodNotAllowed: string
      microphonePermission: string
      openaiRejectedApiKey: string
      openaiRejectedApiKeyWithStatus: (status: string) => string
      openaiTtsNeedsKey: string
      codeSkewRestartRequired: string
      spawnFailed: string
      restartHermesFailed: string
    }
    actions: {
      restartHermes: string
      openKeys: string
      openGateways: string
      openMaintenance: string
    }
    voice: {
      configureSpeechToText: string
      couldNotStartSession: string
      microphoneAccessDenied: string
      microphoneConstraintsUnsupported: string
      microphoneFailed: string
      microphoneInUse: string
      microphonePermissionDenied: string
      microphoneStartFailed: string
      microphoneUnsupported: string
      noMicrophone: string
      noSpeechDetected: string
      playbackFailed: string
      recordingFailed: string
      sayStopToEnd: (phrase: string) => string
      transcriptionFailed: string
      transcriptionUnavailable: string
      tryRecordingAgain: string
      unavailable: string
      liveEnded: string
      liveEndedConnectionLost: string
      liveEndedClosed: string
      liveError: string
      liveDelegationFailed: string
      liveUnavailable: (reason: string) => string
    }
    // Native OS notification copy (titles + generic fallback bodies). Dynamic
    // bodies (the agent's reply, a command, an error) are passed through raw.
    native: {
      approvalTitle: string
      approvalTitleNamed: (session: string) => string
      approveAction: string
      rejectAction: string
      inputTitle: string
      inputTitleNamed: (session: string) => string
      inputBody: string
      turnDoneTitle: string
      turnDoneBody: string
      turnErrorTitle: string
      backgroundDoneTitle: string
      backgroundFailedTitle: string
      creditsTitle: string
    }
  }

  remoteDisplayBanner: {
    message: (reason: string) => string
  }

  billingBlock: {
    titleNous: string
    titleProvider: (provider: string) => string
    fallbackMessage: string
    openBilling: string
    addCredits: string
    dismiss: string
  }

  /** Billing settings page copy. Dynamic account values are supplied by the
   * backend; these strings describe the controls and known state transitions. */
  billing: {
    heading: string
    preview: string
    previewAria: string
    live: string
    summary: {
      balance: string
      plan: string
      autoRefill: string
    }
    sections: {
      plan: string
      paymentCredits: string
      usage: string
      invoices: string
    }
    notice: {
      loggedOutTitle: string
      loggedOutMessage: string
      openPortal: string
      addCard: string
      noCardTitle: string
      noCardMessage: string
    }
    plan: {
      detailsUnavailable: string
      changesTo: (tier: string, when: string) => string
      cancelsOn: (when: string) => string
      renews: (when: string) => string
      noActive: string
      monthlyPrice: (price: string) => string
      changePlan: string
      viewPlans: string
      adjustPlan: string
      choose: string
      current: string
      scheduled: string
      downgrade: string
      checking: string
      cannotMake: string
      alreadyOn: (tier: string) => string
      scheduledChange: (tier: string, when: string, delta?: string) => string
      cannotSchedule: string
      scheduling: string
      confirmDowngrade: string
      back: string
      title: string
      noPlans: string
      tryAgain: string
      cancel: string
      undo: string
      undoing: string
    }
    payment: {
      title: string
      addMethod: string
      update: string
      description: string
      differentCard: string
      provenance: Record<string, string>
    }
    credits: {
      title: string
      description: string
      buy: string
      customAmountAria: string
      processing: string
      added: (amount: string) => string
      balanceRefreshing: string
      openPortal: string
      retry: string
    }
    charge: {
      added: (amount: string) => string
      failedTitle: string
      authenticationRequired: string
      paymentMethodExpired: string
      cardDeclined: string
      failedReason: (reason: string) => string
      outcomeUnconfirmedTitle: string
      outcomeUnconfirmedMessage: (message: string) => string
      checkFailedTitle: string
      checkFailedMessage: string
      trackingFailedTitle: string
      trackingFailedMessage: string
      stillProcessingTitle: string
      stillProcessingMessage: string
    }
    refill: {
      title: string
      genericDescription: string
      managePortal: string
      turnOnPortal: string
      reconcile: string
      reconcileCaption: (card: string) => string
      enabled: string
      off: string
      threshold: string
      reloadTo: string
      thresholdAria: string
      reloadToAria: string
      turnOffQuestion: string
      turnOff: string
      disable: string
      saving: string
      save: string
      cancel: string
      manage: string
      updated: string
      turnedOff: string
      chargeDescription: (reloadTo: string, threshold: string) => string
      validationDollar: (label: string) => string
      validationPositive: (label: string) => string
      validationMinimum: (label: string, amount: string) => string
      validationMaximum: (label: string, amount: string) => string
      validationGreater: string
    }
    usage: {
      subscriptionRemaining: string
      subscriptionCredits: string
      creditsPerMonth: (amount: string) => string
      resets: (date: string) => string
      left: (remaining: string, monthly: string) => string
      over: (amount: string) => string
      topupCredits: string
      doesNotExpire: string
      monthlySpendCapUsed: string
      monthlySpendCap: string
      defaultCeiling: string
      monthlyRemoteSpending: string
      used: (spent: string, limit: string) => string
      usageFallback: (label: string) => string
    }
    status: {
      enabled: string
      off: string
    }
    stepUp: {
      openVerification: string
      dismiss: string
      waiting: string
      verify: string
      verificationNotApprovedTitle: string
      verificationNotApprovedMessage: string
      verificationCompleteTitle: string
      verificationCompleteMessage: string
    }
    refusal: {
      cardConfirmationTitle: string
      cardConfirmationMessage: string
      remoteApprovalTitle: string
      remoteApprovalMessage: string
      remoteStoppedTitle: string
      remoteStoppedByAdmin: string
      remoteStoppedByYou: string
      reconnectDevice: string
      sessionLoggedOutTitle: string
      sessionLoggedOutMessage: string
      spendingOffTitle: string
      spendingOffMessage: string
      adminRoleTitle: string
      adminRoleMessage: string
      freshTopupTitle: string
      freshTopupMessage: string
      noSavedCardTitle: string
      noSavedCardMessage: string
      orgAccessDeniedTitle: string
      orgAccessDeniedMessage: string
      monthlyCapTitle: string
      monthlyCapReached: string
      monthlyCapRemaining: (remaining: string) => string
      tooManyTitle: string
      tooManyMessage: (minutes?: number) => string
      stripeTitle: string
      stripeMessage: (minutes?: number) => string
      dailyLimitTitle: string
      dailyLimitMessage: string
      endpointUnavailableTitle: string
      endpointUnavailableMessage: string
      requestTimedOutTitle: string
      requestTimedOutMessage: string
      connectionFailedTitle: string
      connectionFailedMessage: string
      requestFailedTitle: string
      requestFailedMessage: string
    }
  }

  sendDiagnostics: {
    title: string
    privacyNotice: string
    upload: string
    uploading: string
    cancel: string
    close: string
    copyLink: string
    uploadIdFallback: (id: string) => string
    doneTitle: string
    doneDescription: string
    failedTitle: string
    failedHint: string
    gatewayUnavailable: string
    uploadFailed: string
    handoffLead: string
    links: {
      discord: string
      github: string
      portal: string
    }
  }

  titlebar: {
    hideSidebar: string
    showSidebar: string
    search: string
    searchTitle: string
    swapSidebarSides: string
    hideRightSidebar: string
    showRightSidebar: string
    unreadSessions: (count: number) => string
    muteHaptics: string
    unmuteHaptics: string
    openSettings: string
    openStarmap: string
    enterHud: string
    exitHud: string
    resetHudLayout: string
    layoutEditor: string
    layoutEditorTitle: (modifier: string) => string
  }

  summary: {
    aria: string
    title: string
    close: string
    environment: {
      title: string
      local: string
      remote: string
      project: string
      workingDirectory: string
      model: string
      provider: string
      profile: string
      branch: string
      connection: string
      noProject: string
      noSession: string
    }
    changes: {
      title: string
      files: (count: number) => string
      additions: string
      deletions: string
      staged: (count: number) => string
      noChanges: string
      unavailable: string
      viewDiff: string
      refresh: string
      stage: string
      unstage: string
      revert: string
    }
    git: {
      title: string
      branch: string
      tracking: string
      ahead: (count: number) => string
      behind: (count: number) => string
      commit: string
      pullRequest: string
      push: string
      reviewAndCommit: string
      clean: string
      unavailable: string
      noRepository: string
    }
    agents: {
      title: string
      dispatched: (count: number) => string
      finished: string
      status: Record<'running' | 'queued' | 'completed' | 'failed' | 'interrupted' | 'dispatched', string>
      running: (count: number) => string
      completed: (count: number) => string
      failed: (count: number) => string
      viewAll: string
      none: string
    }
    context: {
      title: string
      noData: string
    }
    outputs: {
      title: string
      create: string
      prompt: string
    }
    plan: {
      title: string
      progress: (done: number, total: number) => string
      recorded: string
      status: Record<'pending' | 'in_progress' | 'completed' | 'cancelled', string>
    }
    background: {
      title: string
      status: Record<'running' | 'done' | 'failed', string>
    }
    sources: {
      title: string
      add: string
      image: string
      skill: string
      tool: string
      attachments: string
      previews: string
      links: string
      none: string
      open: string
    }
    resources: {
      title: string
      ram: string
      gpu: string
      unavailable: string
      retry: string
    }
    state: {
      loading: string
      unavailable: string
      noData: string
      retry: string
      showAll: (count: number) => string
      showLess: string
      details: string
      historyUnavailable: string
    }
  }

  keybinds: {
    title: string
    subtitle: (open: string) => string
    search: string
    rebind: string
    reset: string
    resetAll: string
    pressKey: string
    set: string
    conflictWith: (label: string) => string
    categories: Record<string, string>
    actions: Record<string, string>
  }

  // Find-in-page bar (⌘F). `close` reuses common.close.
  findInPage: {
    next: string
    previous: string
  }

  language: {
    label: string
    description: string
    saving: string
    saveError: string
    switchTo: string
    searchPlaceholder: string
    noResults: string
  }

  settings: {
    subpages: Record<string, string>
    closeSettings: string
    exportConfig: string
    importConfig: string
    resetToDefaults: string
    resetConfirm: string
    exportFailed: string
    resetFailed: string
    nav: {
      account: string
      providers: string
      providerAccounts: string
      providerApiKeys: string
      providerCustomEndpoints: string
      providerLocalModels: string
      gateway: string
      apiKeys: string
      keybinds: string
      keysTools: string
      keysSettings: string
      mcp: string
      archivedChats: string
      about: string
      billing: string
      notifications: string
      vault: string
    }
    account: {
      displayNameLabel: string
      editDisplayName: string
      displayNameHint: string
      displayNameSaved: string
      accountIdLabel: string
      loadingStatus: string
      refresh: string
      serviceUnavailable: string
      termsRequired: string
      legalDevelopmentNotice: string
      developmentCodeFor: string
      agreementUnavailable: string
      phoneLabel: string
      phonePlaceholder: string
      invitationCodeLabel: string
      invitationCodePlaceholder: string
      existingAccount: string
      registerAccount: string
      registrationClosed: string
      phoneAutoRegister: string
      phoneLoginUnavailable: string
      existingAccountPhoneHint: string
      registrationReturnHint: string
      registrationOpenFailed: string
      emailLabel: string
      emailPlaceholder: string
      passwordLabel: string
      passwordPlaceholder: string
      continueExisting: string
      rememberLabel: string
      totpDescription: string
      totpLabel: string
      completeSecondFactor: string
      switchPhone: string
      phoneMaskedLabel: string
      emailVerifiedLabel: string
      offlineDescription: string
      platformError: (code: string, retryAfter?: number) => string
      errors: {
        invalid_identifier: string
        missing_code: string
        invalid_code: string
        expired: string
        attempts_exceeded: string
        development_disabled: string
        retry_cooldown: string
        state_unavailable: string
        invalid_display_name: string
        not_authenticated: string
        unavailable: string
      }
      title: string
      signInTitle: string
      signInDescription: string
      codeTitle: string
      codeDescription: string
      identifierLabel: string
      identifierPlaceholder: string
      codeLabel: string
      codePlaceholder: string
      sendCode: string
      verify: string
      back: string
      resend: string
      resendIn: (seconds: number) => string
      signOut: string
      signedInDescription: string
      developmentHint: string
      termsLabel: string
      termsPrefix: string
      terms: string
      and: string
      privacy: string
      switchWechat: string
      codeSentTo: string
      wechatTitle: string
      wechatUnavailable: string
      switchIdentifier: string
    }
    plugins: {
      title: string
      blurb: string
      count: (n: number) => string
      openFolder: string
      rescan: string
      reveal: string
      enable: string
      disable: string
      failed: string
      empty: string
      errors: {
        desktopUnavailable: string
        resolveFolder: string
        openFolder: string
        backendHomeMissing: string
        unknown: string
        runtimeLoadFailed: (origin: string) => string
      }
      kinds: { bundled: string; disk: string; runtime: string }
      agentHalfMissing: string
      agentHalfMissingTip: string
      installModal: {
        installFromGit: string
        reviewRepository: string
        repoPlaceholder: string
        title: string
        description: string
        repoLabel: string
        includesHeading: string
        agentLabel: string
        desktopLabel: string
        agentTargetLocal: (profile: string, dir: string) => string
        agentTargetRemote: (profile: string) => string
        catalogPinned: (name: string, sha: string) => string
        reviewedHeading: string
        reviewedIntro: string
        restartToApply: string
        restartNow: string
        missingEnvAction: string
        alreadyInstalled: (name: string) => string
        desktopTarget: string
        desktopTargetFromPackage: string
        desktopOnlyNote: string
        insecureWarning: string
        securityHeading: string
        securityIntro: string
        sourceHeading: string
        viewRepository: string
        viewPluginFiles: string
        gitCloneLabel: string
        enableAgent: string
        forceReinstall: string
        pinToCommit: string
        pinToCommitPlaceholder: string
        pinToCommitHint: string
        pinToCommitInvalid: string
        install: string
        installing: string
        probing: string
        probeUnavailable: string
        desktopUnavailable: string
        selectComponent: string
        agentSuccess: (name: string) => string
        desktopSuccess: (name: string) => string
        agentFailed: string
        desktopFailed: string
        missingEnv: (name: string, vars: string) => string
      }
    }
    vault: {
      title: string
      blurb: string
      count: (n: number) => string
      loadFailed: string
      empty: string
      emptyDesc: string
      add: string
      addTitle: string
      addDescription: string
      added: string
      adding: string
      addConfirm: string
      kindField: string
      kinds: Record<'address' | 'login' | 'payment', string>
      labelField: string
      labelPlaceholder: string
      labelRequired: string
      originField: string
      originPlaceholder: string
      originPlaceholderCheckout: string
      originInvalid: string
      identifierTypeField: string
      identifierTypes: Record<'email' | 'phone' | 'username', string>
      identifierField: string
      identifierShown: (identifier: string) => string
      passwordField: string
      loginFieldsRequired: string
      cardNumberField: string
      cardNameField: string
      expMonthField: string
      expYearField: string
      cvcField: string
      postalField: string
      addressLine1Field: string
      addressLine2Field: string
      cityField: string
      stateField: string
      countryField: string
      optional: string
      createdOn: (date: string) => string
      deleteAction: string
      otpField: string
      otpPlaceholder: string
      otpHint: string
      twoFactorBadge: string
      deleteTitle: string
      deleteDescription: (label: string) => string
      deleteConfirm: string
      sources: {
        title: string
        blurb: string
        toggleFailed: string
        notInstalled: (name: string) => string
        disabledDesc: string
        lockedDesc: string
        unlockedDesc: string
        statusLocked: string
        statusNotDetected: string
        statusOff: string
        statusUnlocked: string
        unlock: string
        unlocking: string
        lock: string
        unlocked: (name: string) => string
        unlockTitle: (name: string) => string
        unlockDescription: string
        masterPasswordPlaceholder: string
      }
    }
    notifications: {
      title: string
      intro: string
      enableAll: string
      enableAllDesc: string
      focusedHint: string
      kinds: Record<
        'approval' | 'backgroundDone' | 'credits' | 'input' | 'plugin' | 'turnDone' | 'turnError',
        { label: string; description: string }
      >
      test: string
      testTitle: string
      testBody: string
      testSent: string
      testUnsupported: string
      completionSoundTitle: string
      completionSoundDesc: string
      completionSoundPreview: string
      completionSoundNames: Record<string, string>
    }
    sections: Record<string, string>
    searchPlaceholder: Record<'about' | 'config' | 'gateway' | 'keys' | 'mcp' | 'sessions', string>
    modeOptions: Record<'light' | 'dark' | 'system', ModeOptionCopy>
    appearance: {
      title: string
      intro: string
      colorMode: string
      colorModeDesc: string
      toolViewTitle: string
      toolViewDesc: string
      hideCodeDiffsTitle: string
      hideCodeDiffsDesc: string
      hideThreadTimelineTitle: string
      hideThreadTimelineDesc: string
      reasoningCollapsedTitle: string
      reasoningCollapsedDesc: string
      uiScaleTitle: string
      uiScaleDesc: (percent: number) => string
      sessionDensityTitle: string
      sessionDensityDesc: string
      sessionDensityCompact: string
      sessionDensityComfortable: string
      sessionDensityDetailed: string
      tabStripTitle: string
      tabStripDesc: string
      tabStripAuto: string
      tabStripAlways: string
      tabStripNever: string
      appActionsTitle: string
      appActionsDesc: string
      appActionsLeft: string
      appActionsRight: string
      terminalFontTitle: string
      terminalFontDesc: string
      terminalFontPlaceholder: string
      terminalFontPreview: string
      terminalFontReset: string
      chatFontTitle: string
      chatFontDesc: string
      chatFontPlaceholder: string
      chatFontPreview: string
      chatFontSample: string
      chatFontReset: string
      translucencyTitle: string
      translucencyDesc: string
      translucencyGlassDesc: string
      translucencyModeClear: string
      translucencyModeGlass: string
      translucencyTintTitle: string
      translucencyFadeTitle: string
      translucencyFrostTitle: string
      translucencyFrost: {
        'under-window': string
        popover: string
        titlebar: string
        header: string
      }
      translucencyScopeTitle: string
      translucencyScope: {
        window: string
        sidebar: string
      }
      backdropTitle: string
      backdropDesc: string
      userBubbleTitle: string
      userBubbleDesc: string
      introSplashTitle: string
      introSplashDesc: string
      reactionsTitle: string
      reactionsDesc: string
      tipsTitle: string
      tipsDesc: string
      tipsReset: (count: number) => string
      toursTitle: string
      toursDesc: string
      composerPopoutTitle: string
      composerPopoutDesc: string
      vibeHeartsTitle: string
      vibeHeartsDesc: string
      embedsTitle: string
      embedsDesc: string
      embedsAsk: string
      embedsAlways: string
      embedsOff: string
      embedsReset: (count: number) => string
      resumeLastSessionTitle: string
      resumeLastSessionDesc: string
      product: string
      productDesc: string
      technical: string
      technicalDesc: string
      themeTitle: string
      themeDesc: string
      themePresets: Record<string, { label: string; description: string }>
      themeProfileNote: (profile: string) => string
      installTitle: string
      installDesc: string
      installPlaceholder: string
      installButton: string
      installing: string
      installError: string
      installed: (name: string) => string
      themeImportErrors: {
        invalidJson: string
        notObject: string
        noColors: string
        noMarketplaceThemes: (extensionId: string) => string
        invalidMarketplaceId: string
        desktopOnly: string
        builtInCollision: (name: string) => string
        missingColors: string
      }
      removeTheme: string
      importedBadge: string
      themeSearchPlaceholder: string
      marketplaceHeading: string
      noInstalledThemesMatch: (query: string) => string
      pet: {
        title: string
        intro: string
        restartHint: string
        on: string
        off: string
        scaleTitle: string
        scaleDesc: string
        roamTitle: string
        roamDesc: string
        chooseTitle: string
        chooseDesc: string
        searchPlaceholder: string
        hatchingProgress: string
        messagePlaceholder: string
        openApp: (product: string) => string
        bubble: {
          run: readonly string[]
          review: readonly string[]
          failed: readonly string[]
          waiting: readonly string[]
        }
        unreachable: string
        noMatch: (query: string) => string
        installedTag: string
        generatedTag: string
        countCapped: (cap: number, total: number) => string
        count: (n: number) => string
        uninstall: (name: string) => string
        delete: (name: string) => string
        deleteTitle: (name: string) => string
        deleteBody: string
        deleteConfirm: string
        rename: (name: string) => string
        renameTitle: string
        renamePlaceholder: string
        renameSave: string
        exportPet: (name: string) => string
        adoptFailed: (slug: string) => string
        uninstallFailed: (slug: string) => string
        renameFailed: (slug: string) => string
        exportFailed: (slug: string) => string
        noneAvailable: string
        turnOnFailed: string
        turnOffFailed: string
        spriteLabel: (name: string) => string
      }
    }
    fieldLabels: Record<string, string>
    fieldDescriptions: Record<string, string>
    uninstallSection: {
      dangerZone: string
      confirmUninstall: string
      uninstallHermes: string
    }
    poolLimits: {
      warmBotBackendsAria: string
      warmBotBackendsTitle: string
      backendIdleTimeoutAria: string
      backendIdleTimeoutTitle: string
    }
    about: {
      heading: string
      version: (value: string) => string
      versionUnavailable: string
      bundleOutOfSync: string
      bundleOutOfSyncDesc: string
      bundleOutOfSyncAction: string
      bundleSwapPending: string
      bundleSwapPendingDesc: string
      bundleSwapPendingAction: string
      updates: string
      checkNow: string
      checking: string
      seeWhatsNew: string
      updateNow: string
      releaseNotes: string
      onLatest: string
      installing: string
      cantUpdate: string
      cantReach: string
      tapCheck: string
      updateReady: (count: number) => string
      updateReadyUnknown: string
      lastChecked: (age: string) => string
      justNowSuffix: string
      automaticUpdates: string
      automaticUpdatesDesc: string
      branchCommit: (branch: string, commit: string) => string
      never: string
      justNow: string
      minAgo: (count: number) => string
      hoursAgo: (count: number) => string
      daysAgo: (count: number) => string
    }
    config: {
      none: string
      noneParen: string
      builtinOnly: string
      notSet: string
      commaSeparated: string
      searchPlaceholder: string
      noResults: string
      systemDefault: string
      loading: string
      emptyTitle: string
      emptyDesc: string
      failedLoad: string
      autosaveFailed: string
      imported: string
      invalidJson: string
      toolsetsWipeConfirm: string
      keepAwakeTitle: string
      keepAwakeDesc: string
      disableF12Title: string
      disableF12Desc: string
      attachmentSizeTitle: string
      attachmentSizeDesc: string
      attachmentSizeUnit: string
      attachmentSizeLabel: string
      attachmentSizeSaveFailed: string
      showOptions: string
    }
    screenshot: {
      enabledTitle: string
      enabledDesc: string
      statusTitle: string
      checking: string
      disabled: string
      starting: string
      ready: string
      inputPermission: string
      screenPermission: string
      openSettings: string
      retry: string
      unavailable: string
      errorTitle: string
      loadFailed: string
      saveFailed: string
      permissionFailed: string
      captureFailed: string
      contextChanged: string
    }
    quickEntry: {
      enabledTitle: string
      enabledDesc: string
      shortcutTitle: string
      shortcutDesc: string
      active: string
      takenBy: string
      invalidShortcut: string
    }
    credentials: {
      pasteKey: string
      pasteLabelKey: (label: string) => string
      optional: string
      enterValueFirst: string
      couldNotSave: string
      remove: string
      getKey: string
      saving: string
    }
    envActions: {
      actions: string
      manageInKeys: string
      docs: string
      hideValue: string
      revealValue: string
      replace: string
      set: string
      clear: string
    }
    // v2 multi-connection registry: Settings → Connections.
    connections: {
      title: string
      localLabel: string
      intro: string
      stagedNote: string
      launchModeTitle: string
      launchModeDesc: string
      searchPlaceholder: string
      noSearchResults: string
      loadFailed: string
      currentPill: string
      primaryPill: string
      managedPill: string
      addConnection: string
      editConnection: string
      removeConnection: string
      removeConfirmTitle: string
      removeConfirmDesc: (label: string) => string
      makePrimary: string
      testConnection: string
      testOk: string
      testFailed: string
      saveFailed: string
      removeFailed: string
      updateAll: string
      updateAllRunning: string
      updateAllDone: string
      updateAllFailed: string
      updateSkippedCloud: string
      kindLocal: string
      kindRemote: string
      kindCloud: string
      kindSsh: string
      kindLocalDesc: string
      kindRemoteDesc: string
      kindCloudDesc: string
      kindSshDesc: string
      labelTitle: string
      labelDesc: string
      labelPlaceholder: string
      urlTitle: string
      sshHostTitle: string
      headersTitle: string
      headersDesc: string
      headerValuePlaceholder: string
      headerValueSaved: string
      headerAdd: string
      headerRemove: string
      duplicateLocal: string
      duplicateUrl: (label: string) => string
      duplicateSsh: (label: string) => string
      sameBackendHint: (label: string) => string
      localAddHint: string
      cloudAddHint: string
      save: string
      saving: string
      cancel: string
      empty: string
    }
    managedUpdates: {
      title: string
      intro: string
      sshConnection: string
      update: string
      updating: string
      progress: string
      updated: string
      partial: string
      refused: string
      failed: string
      alreadyRunning: string
      receipt: (id: string, outcome: string) => string
      receiptVersions: (pre: string, post: string) => string
      scopesRestored: (profiles: string) => string
      scopeNotRestored: (profile: string, error: string) => string
    }
    gateway: {
      loading: string
      unavailableTitle: string
      unavailableDesc: string
      registryConnectionsUnsupported: string
      title: string
      envOverride: string
      intro: string
      envOverrideTitle: string
      envOverrideDesc: string
      modeTitle: string
      localTitle: string
      localDesc: string
      remoteTitle: string
      remoteDesc: string
      remoteAuthHint: string
      cloudTitle: string
      cloudDesc: string
      cloudSignInTitle: string
      cloudSignIn: string
      cloudSignedIn: string
      cloudNeedsSignIn: string
      cloudSignedInDesc: string
      cloudAgentsTitle: string
      cloudOrgPickerTitle: string
      cloudOrgSelect: string
      cloudOrgChange: string
      cloudOrgRole: (role: string) => string
      cloudLoadingAgents: string
      cloudNoAgents: { before: string; linkText: string; after: string }
      cloudRefresh: string
      cloudConnect: string
      cloudSavedTitle: string
      cloudSavedDesc: string
      cloudUseSaved: string
      cloudActive: string
      cloudConnecting: string
      cloudDiscoverFailed: string
      cloudConnectFailed: string
      cloudSignInFailed: string
      cloudSignedOutTitle: string
      cloudSignedOutMessage: string
      cloudConnectedTitle: string
      cloudConnectedPill: string
      cloudConnectedTo: (name: string) => string
      cloudAgentProvisioning: string
      cloudStatusLabel: (status: string) => string
      remoteUrlTitle: string
      remoteUrlDesc: string
      probing: string
      probeError: string
      signedIn: string
      signIn: string
      signOut: string
      signInWith: (provider: string) => string
      authTitle: string
      authSignedInPassword: string
      authSignedInOauth: string
      authNeedsPassword: string
      authNeedsOauth: (provider: string) => string
      tokenTitle: string
      tokenDesc: string
      existingToken: (value: string) => string
      savedToken: string
      pasteSessionToken: string
      plainTextConfirmTitle: string
      plainTextConfirmDesc: string
      plainTextConfirmAction: string
      plainTextStoredTitle: string
      plainTextStoredDesc: string
      keychainEncryptionTitle: string
      keychainEncryptionDesc: string
      keychainEncryptionFailed: string
      testRemote: string
      saveForRestart: string
      saveAndReconnect: string
      diagnostics: string
      diagnosticsDesc: string
      openLogs: string
      incompleteTitle: string
      incompleteSignIn: string
      incompleteToken: string
      incompleteSignInTest: string
      incompleteTokenTest: string
      enterUrlFirst: string
      restartingTitle: string
      savedTitle: string
      restartingMessage: string
      savedMessage: string
      connectedTo: (baseUrl: string, version?: string) => string
      reachableTitle: string
      signedOutTitle: string
      signedOutMessage: string
      failedLoad: string
      signInFailed: string
      signOutFailed: string
      testFailed: string
      applyFailed: string
      saveFailed: string
      sshTitle: string
      sshDesc: string
      sshTrustHint: string
      sshHostTitle: string
      sshHostDesc: string
      sshHostPick: string
      sshHostPickTitle: string
      sshHostPickDesc: string
      sshHostCustom: string
      sshUserTitle: string
      sshUserDesc: string
      sshUserPlaceholder: string
      sshPortTitle: string
      sshPortDesc: string
      sshKeyTitle: string
      sshKeyDesc: string
      sshHermesPathTitle: string
      sshHermesPathDesc: string
      sshHermesPathPlaceholder: string
      sshTestConnection: string
      sshConnect: string
      sshButtonsHint: string
      sshReachable: (host: string, platform: string) => string
      sshIncompleteHost: string
      sshErrUnreachable: string
      sshErrAuth: string
      sshErrHostKey: string
      sshErrNotInstalled: string
      sshErrPlatform: string
      sshErrTimeout: string
      sshErrUpdateRequired: string
      sshErrUnknown: string
    }
    keys: {
      loading: string
      failedLoad: string
      empty: string
    }
    search: {
      placeholder: string
      pill: string
    }
    profileScope: {
      appliesTo: string
      editsProfile: (profile: string) => string
    }
    mcp: {
      loading: string
      failedLoad: string
      nameRequiredTitle: string
      nameRequiredMessage: string
      objectRequired: string
      invalidJson: string
      saveFailed: string
      removeFailed: string
      gatewayUnavailableTitle: string
      gatewayUnavailableMessage: string
      reloadedTitle: string
      reloadedMessage: string
      reloadFailed: string
      savedTitle: string
      savedMessage: (name: string) => string
      newServer: string
      reload: string
      reloading: string
      emptyTitle: string
      emptyDesc: string
      disabled: string
      editServer: string
      name: string
      serverJson: string
      remove: string
      saveServer: string
      test: string
      testing: string
      testOk: (count: number) => string
      testFailed: string
      enableServer: (name: string) => string
      disableServer: (name: string) => string
      serverEnabled: (name: string) => string
      serverDisabled: (name: string) => string
      toggleFailed: (name: string, enabled: boolean) => string
      tabServers: string
      tabCatalog: string
      catalogLoading: string
      catalogLoadFailed: string
      catalogEmpty: string
      catalogInstalled: string
      catalogEnabled: string
      catalogNeedsInstall: string
      catalogInstall: string
      catalogInstalling: string
      catalogInstallStarted: (name: string) => string
      catalogInstallFailed: (name: string) => string
      catalogEnvPrompt: (name: string) => string
      catalogEnvRequired: string
      oauthTag: string
      apiKeyTag: string
      oauthStartFailed: string
      oauthAuthorizationUrlMissing: string
      oauthAuthorizationFailed: string
      oauthCancelled: string
      /** Localized copy for bundled MCP catalog manifests. Unknown or
       * user-provided entries intentionally fall back to backend text. */
      catalogDescriptions: Record<string, string>
      capabilitySummary: (tools: number, prompts: number, resources: number) => string
      costTokens: (tokens: string) => string
      usage30d: (uses: string) => string
      unusedPill: string
      statusConnecting: string
      statusNeedsAuth: string
      statusError: string
      statusOff: string
      allServers: string
      authenticatedTitle: string
      authenticatedMessage: (server: string, count: number) => string
      waitingForBrowser: string
      authenticate: string
      unsavedConnect: string
      enableTool: (tool: string) => string
      disableTool: (tool: string) => string
      noOutput: string
      deepLinkTitle: string
      deepLinkDescription: string
      deepLinkStdioWarning: string
      deepLinkConfirm: string
      deepLinkNameInvalid: string
      deepLinkNameConflict: (name: string) => string
      deepLinkErrorTitle: string
      deepLinkErrorName: string
      deepLinkErrorConfig: string
      deepLinkErrorShape: string
      deepLinkErrorUrl: string
      deepLinkErrorTooLarge: string
      importExpectedObject: string
      importServerWrapperRequired: string
      importButton: string
      importPlaceholder: string
      importNoMatch: string
      importConfirm: string
      importConfirmMany: (count: number) => string
    }
    model: {
      loading: string
      appliesDesc: string
      provider: string
      model: string
      applying: string
      setupProvider: (provider: string) => string
      activating: string
      activate: string
      apiKeyPlaceholder: (key: string) => string
      providerNeedsApiKey: (provider: string) => string
      providerNeedsBrowser: (provider: string) => string
      defaultsLabel: string
      reasoning: string
      reasoningOff: string
      defaultsFailed: string
      loadFailed: string
      restartRequired: string
      restartBackend: string
      restartingBackend: string
      restartFailed: string
      auxiliaryTitle: string
      resetAllToMain: string
      auxiliaryDesc: string
      setToMain: string
      change: string
      autoUseMain: string
      inheritMainEffort: string
      providerDefault: string
      fallbackAdd: string
      fallbackEmpty: string
      notInCatalog: string
      otherProviders: string
      staleAuxiliary: (count: number, names: string, provider: string) => string
      moa: {
        title: string
        description: string
        preset: string
        enabled: string
        setDefault: string
        delete: string
        newPresetPlaceholder: string
        addPreset: string
        defaultLabel: string
        reference: (index: number) => string
        toggleReference: (enabled: boolean, index: number) => string
        remove: string
        addReferenceModel: string
        aggregator: string
      }
      moaTitle: string
      moaPreset: string
      moaDescription: string
      moaAggregator: string
      moaAggregatorBilled: string
      moaReferenceHint: string
      tasks: Record<string, AuxTaskCopy>
    }
    localModels: {
      title: string
      runtimeTitle: string
      runtimeReady: (backend: string) => string
      serverRunning: string
      runtimeInstalled: string
      runtimeInstalledDetail: (tag: string, backend: string) => string
      installTitle: string
      installDetail: string
      installAction: string
      installing: string
      installFailed: string
      hardwareTitle: string
      hardwareLoading: string
      vram: (label: string) => string
      ram: (label: string) => string
      unifiedMemory: string
      storage: (total: string, available: string) => string
      modelsTitle: string
      recommended: string
      /** Recommended-badge tooltip by resolver branch; unknown keys (newer
       *  backend) simply show no tooltip. */
      recommendedReason: Record<string, string>
      noRecommendationTitle: string
      noRecommendationDetail: string
      noRecommendationAction: string
      downloaded: string
      downloadAction: (size: string) => string
      downloadProgress: (done: string, total: string) => string
      downloadDoneToast: (model: string) => string
      installDoneToast: string
      quickstartTitle: string
      quickstartDetail: (model: string, size: string) => string
      quickstartDetailReady: (model: string) => string
      quickstartAction: string
      quickstartConfigure: string
      quickstartDoneToast: (model: string) => string
      quickstartFailed: string
      quickstartStageEngine: string
      quickstartStageModel: string
      quickstartStageFinish: string
      useAction: string
      activePill: string
      updateTitle: string
      updateDetail: (next: string, current: string) => string
      updateAction: string
      updating: string
      upToDateTitle: string
      upToDateDetail: (tag: string, backend: string) => string
      activeDetail: string
      activeNotLoaded: string
      loadedPill: string
      placementResident: string
      placementSpilled: string
      placementResidentTip: string
      placementSpilledTip: string
      loadingPill: string
      ejectTip: string
      ejected: string
      ejectFailed: string
      stopServer: string
      startServer: string
      runtimeRunningDetail: string
      serverStopped: string
      serverStarted: string
      serverStopFailed: string
      serverStartFailed: string
      activating: string
      activateFailed: (model: string) => string
      activateDoneToast: (model: string) => string
      downloadFailed: (model: string) => string
      pillFitsGpu: string
      pillUsesRam: string
      pillTooBig: string
      browseTitle: string
      browseHint: string
      browsePlaceholder: string
      browseSearching: string
      browseListing: string
      browseShowFiles: string
      browseRefresh: string
      browseDownloads: string
      browseLikes: string
      browseGated: string
      browseNoGguf: string
      browseFitUnknown: string
      browseAlreadyDownloaded: string
      addedByYou: string
      browseDownloadStarted: string
      browseDownloadAria: string
      sideloadButton: string
      sideloadTitle: string
      sideloadDone: string
      sideloadAlreadyPresent: string
      pillFullContext: (max: string) => string
      pillFullContextTip: string
      pillUpTo: (max: string) => string
      pillGrowsTip: string
      pillVision: string
      deleteAction: string
      deleteConfirm: (model: string) => string
      deleted: (model: string) => string
      deleteFailed: string
    }
    providers: {
      connectAccount: string
      haveApiKey: string
      intro: string
      connected: string
      collapse: string
      connectAnother: string
      otherProviders: string
      disconnect: string
      disconnectInTerminal: string
      removeConfirm: (provider: string) => string
      removeExternalGeneric: (provider: string) => string
      removeKeyManaged: (provider: string) => string
      removeTerminalConfirm: (provider: string, command: string) => string
      removeTerminalRunning: (provider: string) => string
      removedTitle: string
      removedMessage: (provider: string) => string
      failedRemove: (provider: string) => string
      noProviderKeys: string
      searchKeys: string
      noKeysMatch: string
      localEndpoint: {
        title: string
        description: string
      }
      descriptions: Record<string, string>
      loading: string
    }
    customEndpoints: {
      title: string
      active: string
      apiKeySet: string
      use: string
      deleteEndpoint: string
      emptyTitle: string
      emptyDescription: string
      editTitle: string
      addTitle: string
      name: string
      namePlaceholder: string
      providerId: string
      providerIdPlaceholder: string
      endpointUrl: string
      endpointUrlPlaceholder: string
      defaultModel: string
      defaultModelPlaceholder: string
      context: string
      contextPlaceholder: string
      apiKey: string
      apiKeyKeepPlaceholder: string
      apiKeyOptionalPlaceholder: string
      useForNewChats: string
      discoverModels: string
      test: string
      testing: string
      save: string
      saving: string
      newEndpoint: string
      loadFailed: string
      saved: string
      saveFailed: string
      validationFailed: string
      activationFailed: string
      deleteFailed: string
      deleteConfirm: (name: string) => string
      endpointReachable: string
      endpointReachableModels: (count: number) => string
      endpointReachableTransport: (transport: string, count: number) => string
      endpointValidationFailed: string
    }
    memory: {
      loadFailed: string
      loading: string
      settingsTitle: (label: string) => string
      fullConfig: string
      fullConfigDescription: (label: string, profile: string) => string
      configurationReference: string
      groupOther: string
      blankFallback: string
      cancel: string
      saveChanges: string
      savedTitle: (label: string) => string
      savedMessage: string
      saveFailed: (label: string) => string
      retry: string
      fieldAbout: (label: string) => string
      set: string
      notSet: string
      connectViaOAuth: string
      reconnect: string
      connect: string
      apiKeySet: string
      oauthSet: string
      waitingBrowserConsent: string
      cancelConnection: string
      startConnectionFailed: string
      failedStartConnection: string
      timedOut: string
      connectionFailed: string
    }
    computerUse: {
      checking: string
      unsupported: (platform: string) => string
      installDriver: string
      grantAfterInstall: string
      identityNote: string
      linuxNote: string
      windowsNote: string
      recheck: string
      accessibility: string
      accessibilityHint: string
      screenRecording: string
      screenRecordingHint: string
      driverHealth: string
      granted: string
      notGranted: string
      unknown: string
      ready: string
      notReady: string
      readyHint: string
      waitingApproval: string
      grantPermissions: string
      approveTitle: string
      approveMessage: string
      requestPermissionsFailed: string
      readStatusFailed: string
    }
    uninstall: {
      dangerZone: string
      checking: string
      confirmTitle: string
      confirmBody: (consequence: string) => string
      appPath: (path: string) => string
      uninstalling: string
      yesUninstall: string
      cancel: string
      heading: (name: string) => string
      intro: string
      guiTitle: string
      guiDescription: (name: string) => string
      guiConsequence: string
      liteTitle: string
      liteDescription: (name: string) => string
      liteConsequence: (name: string) => string
      fullTitle: string
      fullDescription: string
      fullConsequence: (name: string) => string
      couldNotStart: string
    }
    sessions: {
      loading: string
      archivedTitle: string
      archivedIntro: string
      emptyArchivedTitle: string
      emptyArchivedDesc: string
      unarchive: string
      deletePermanently: string
      messages: (count: number) => string
      restored: string
      deleteConfirm: (title: string) => string
      autoArchiveTitle: string
      autoArchiveDesc: string
      autoArchiveDaysLabel: string
      autoArchiveDaysUnit: string
      autoArchiveFailed: string
      defaultDirTitle: string
      defaultDirDesc: string
      defaultDirUpdated: string
      defaultsTo: (label: string) => string
      change: string
      choose: string
      clear: string
      notSet: string
      failedLoad: string
      unarchiveFailed: string
      deleteFailed: string
      updateDirFailed: string
      clearDirFailed: string
    }
    toolsets: {
      loadingConfig: string
      savedTitle: string
      savedMessage: (key: string) => string
      removedTitle: string
      removedMessage: (key: string) => string
      failedSave: (key: string) => string
      failedRemove: (key: string) => string
      failedReveal: (key: string) => string
      removeConfirm: (key: string) => string
      set: string
      notSet: string
      selectedTitle: string
      selectedMessage: (provider: string) => string
      failedSelect: (provider: string) => string
      failedLoad: string
      noProviderOptions: string
      noProviders: string
      ready: string
      needsSignIn: string
      needsSetup: string
      activeBackend: string
      activeBackendHint: string
      useBackend: string
      nousIncluded: string
      nousAuthNeededTitle: string
      nousAuthNeededMessage: (provider: string) => string
      nousAuthSignIn: string
      nousAuthDoneTitle: string
      nousAuthDoneMessage: string
      nousAuthFailed: string
      nousAuthFailedMessage: string
      nousAuthTryAgain: string
      noApiKeyRequired: string
      postSetupHint: (step: string) => string
      postSetupInstalledHint: string
      postSetupRun: string
      postSetupRerun: string
      postSetupInstalled: string
      postSetupRunning: string
      postSetupStarting: string
      postSetupCompleteTitle: string
      postSetupCompleteMessage: (step: string) => string
      postSetupErrorTitle: string
      postSetupErrorMessage: (step: string) => string
      postSetupOpenLogs: string
      postSetupRunAgain: string
      postSetupFailed: (step: string) => string
      webSearchActive: (backend: string) => string
      webExtractActive: (backend: string) => string
      webCapabilityUnset: string
      webUseForSearch: string
      webUseForExtract: string
      webUsedForSearch: string
      webUsedForExtract: string
      webCapabilitySelectedMessage: (provider: string, capability: string) => string
      failedSelectCapability: (provider: string) => string
      loadingModels: string
      modelSectionTitle: string
      modelCount: (count: number) => string
      modelInUse: string
      modelDefault: string
      modelInactiveHint: string
      modelSelectedTitle: string
      modelSelectedMessage: (model: string) => string
      failedSelectModel: (model: string) => string
      terminalBackend: {
        sectionTitle: string
        loading: string
        failedLoad: string
        ready: string
        needsSetup: string
        unavailable: string
        inUse: string
        selectedTitle: string
        selectedMessage: (backend: string) => string
        failedSelect: (backend: string) => string
        needsSetupHint: string
        needsSetupConfirmTitle: (backend: string) => string
        needsSetupConfirmDescription: (detail: string) => string
        needsSetupConfirmDescriptionGeneric: string
        needsSetupConfirmAction: string
        unavailableTitle: string
        unavailableMessage: (backend: string) => string
        openBackendSettings: string
        useLocal: string
        switchedToLocal: string
      }
      browserRealProfile: {
        label: string
        description: string
        enabledTitle: string
        enabledMessage: string
        disabledTitle: string
        disabledMessage: string
        failedSave: string
        prompt: {
          title: string
          body: string
          bulletSnapshot: string
          bulletLiveProfile: string
          bulletLocal: string
          dontShowAgain: string
          notNow: string
          enable: string
        }
      }
    }
  }

  skills: {
    tabSkills: string
    tabToolsets: string
    configuringProfile: string
    tabMcp: string
    all: string
    searchSkills: string
    searchToolsets: string
    refresh: string
    refreshing: string
    loading: string
    noSkillsTitle: string
    noSkillsDesc: string
    noToolsetsTitle: string
    noToolsetsDesc: string
    noDescription: string
    configured: string
    needsKeys: string
    visionModelHint: string
    visionModelLink: string
    toolsetsEnabled: (enabled: number, total: number) => string
    configureToolset: (label: string) => string
    toggleToolset: (label: string, enabled: boolean) => string
    skillsLoadFailed: string
    toolsetsRefreshFailed: string
    skillEnabled: string
    skillDisabled: string
    toolsetEnabled: string
    toolsetDisabled: string
    appliesToNewSessions: (name: string) => string
    failedToUpdate: (name: string) => string
    sortMostUsed: string
    sortAlpha: string
    sortMostUsedDesc: string
    sortLeastUsedAsc: string
    enableAll: string
    disableAll: string
    disableUnused: string
    bulkUpdated: (count: number) => string
    bulkNoChange: string
    usageCount: (count: number | string) => string
    provenance: Record<'agent' | 'bundled' | 'hub', string>
    emptyNoneFound: (noun: string) => string
    emptyNothingMatches: (query: string) => string
    emptyNoneAvailable: (noun: string) => string
    changesApplyNewSessions: string
    skillUpdated: string
    edit: string
    archive: string
    skillArchivedTitle: string
    skillArchivedMessage: string
    tabPlugins: string
    plugins: {
      agentTitle: string
      agentBlurb: string
      pageBlurb: string
      halfDesktop: string
      halfDesktopHint: string
      halfAgent: string
      halfAgentIn: (profile: string) => string
      defaultProfile: string
      kindAgent: string
      kindDesktop: string
      kindBoth: string
      installAgentHere: string
      installAgentHereTip: (profile: string) => string
      installAgentHereNoOrigin: string
      desktopHalfPending: string
      desktopHalfPendingTip: string
      desktopHalfRemote: string
      desktopHalfRemoteTip: string
      emptyAll: string
      empty: string
      emptyHint: string
      loadFailed: string
      toggleFailed: (name: string) => string
      legacyBackend: string
      portableBadge: string
      catalogTitle: string
      catalogBrowse: string
      catalogHide: string
      catalogHint: string
      alreadyInstalled: (name: string) => string
      catalogProvenance: (sha: string) => string
      pinnedProvenance: (sha: string) => string
      pinnedBadge: (sha: string) => string
      tierOfficial: string
      tierCommunity: string
      updateToPin: (sha: string) => string
      updateFailed: (name: string) => string
      updated: (name: string) => string
      uninstall: string
      uninstallTip: (name: string, profile: string) => string
      uninstallConfirmTitle: (name: string) => string
      uninstallConfirmBody: (name: string, profile: string) => string
      uninstallFailed: (name: string) => string
      uninstalled: (name: string) => string
      uninstallDesktopTip: (name: string) => string
      uninstallDesktopConfirmBody: (name: string) => string
      uninstalledDesktop: (name: string) => string
      deepLinkErrorTitle: string
      deepLinkCatalogInvalidName: string
      deepLinkCatalogUnknown: (name: string) => string
      deepLinkCatalogUnavailable: string
    }
    officialCatalog: string
    officialPill: string
    archiveConfirmTitle: (name: string) => string
    archiveConfirmDescription: string
    hub: {
      searchPlaceholder: string
      search: string
      searching: string
      connectingHubs: string
      connectedHubs: string
      featured: string
      landingHint: string
      noResults: string
      resultCount: (count: number, ms: number | null) => string
      timedOut: (sources: string) => string
      installed: string
      install: string
      installing: string
      uninstall: string
      uninstalling: string
      updateAll: string
      updating: string
      preview: string
      scan: string
      scanning: string
      close: string
      files: string
      noReadme: string
      trust: Record<string, string>
      verdictSafe: string
      verdictCaution: string
      verdictDangerous: string
      policyAllow: string
      policyAsk: string
      policyBlock: string
      findings: (count: number) => string
      noFindings: string
      installStarted: (name: string) => string
      uninstallStarted: (name: string) => string
      updateStarted: string
      actionFailed: string
      installBlockedTitle: (name: string) => string
      installBlockedMessage: (findings: number, unverified: boolean) => string
      viewScan: string
      openLog: string
      actionLog: string
      alreadyInstalled: (name: string) => string
      pickerTitle: string
      pickerBrowse: string
      pickerHide: string
      pickerHint: string
      loadFailed: string
      previewFailed: string
      scanFailed: string
      searchFailed: string
    }
  }

  starmap: {
    title: string
    subtitle: (nodes: number, clusters: number) => string
    close: string
    refresh: string
    memory: string
    skill: string
    filterAll: string
    filterUsed: string
    filterLearned: string
    viewGraph: string
    loadFailed: string
    loading: string
    emptyTitle: string
    emptyDesc: string
    share: string
    shareHint: string
    shareTitle: string
    sharePlaceholder: string
    copy: string
    copied: string
    importMap: string
    importBtn: string
    importEmpty: string
    importSuccess: (nodes: number) => string
    importedBadge: string
    resetToMine: string
    legendAge: string
    playTimeline: string
    pauseTimeline: string
    timelineScrubber: string
    editNode: (kind: string, label: string) => string
    archiveSkill: string
    deleteMemory: string
    deleteMemoryDescription: string
    deleteMemoryTitle: (label: string) => string
    couldNotReadCode: string
  }
  agents: {
    extendedTranscript: string
    transcriptTruncated: string
    transcriptUnavailable: string
    close: string
    title: string
    subtitle: string
    emptyTitle: string
    emptyDesc: string
    defaultGoal: string
    timedOutAfter: (seconds: number | string) => string
    running: string
    failed: string
    done: string
    streaming: string
    files: string
    moreFiles: (count: number) => string
    moreAgents: (count: number) => string
    queued: string
    waitingActivity: string
    steer: string
    steerPlaceholder: string
    steerQueued: string
    stopRequested: string
    requestRejected: string
    delegation: (index: number) => string
    workers: (count: number) => string
    workersActive: (count: number) => string
    agentsCount: (count: number) => string
    activeCount: (count: number) => string
    failedCount: (count: number) => string
    toolsCount: (count: number) => string
    filesCount: (count: number) => string
    updatedAgo: (age: string) => string
    ageNow: string
    ageSeconds: (seconds: number) => string
    ageMinutes: (minutes: number) => string
    ageHours: (hours: number) => string
    ageDays: (days: number) => string
    durationSeconds: (seconds: string) => string
    durationMinutes: (minutes: number, seconds: number) => string
    tokens: (value: number | string) => string
  }

  commandCenter: {
    close: string
    paletteTitle: string
    back: string
    searchPlaceholder: string
    goTo: string
    goToSession: string
    branches: string
    projects: string
    openFolder: string
    openFolderAt: (path: string) => string
    newSessionInProject: (project: string) => string
    commands: string
    startInBranch: (branch: string) => string
    commandCenter: string
    appearance: string
    settings: string
    contributedActions: {
      layoutEditMode: string
      reloadPlugins: string
      resetLayout: string
      toggleStatusbar: string
      toggleTabs: string
      keyboardShortcuts: string
      exportProfile: string
      importProfile: string
      toggleTerminal: string
      toggleLogs: string
      toggleYolo: string
    }
    changeTheme: string
    changeColorMode: string
    splitDirections: {
      right: string
      bottom: string
      left: string
      top: string
    }
    pets: {
      title: string
      placeholder: string
      loading: string
      error: string
      staleBackend: string
      empty: string
      turnOff: string
      turnOn: string
      installed: string
      generatedTag: string
      adoptFailed: string
      toggleFailed: (enabled: boolean) => string
      noneAvailable: string
    }
    generatePet: {
      title: string
      placeholder: string
      promptHint: string
      readyHint: string
      generate: string
      generating: string
      retry: string
      hatch: string
      spawning: string
      hatching: string
      hatchingSub: string
      hatched: string
      hatchRow: (state: string, done: number, total: number) => string
      hatchComposing: string
      hatchSaving: string
      namePlaceholder: string
      staleBackend: string
      backgroundHint: string
      slowProviderHint: string
      remix: string
      remixConfirmTitle: string
      remixConfirmBody: string
      genericError: string
      hatchingError: string
      referenceImageTooLarge: string
      referenceImageInvalid: string
      adopt: string
      startOver: string
      addReference: string
      unavailableTitle: string
      unavailableDescription: string
      setupImageGeneration: string
      grabKeyFrom: string
      background: {
        view: string
        draftsReadyTitle: string
        draftsReadyMessage: string
        generationFailedTitle: string
        retryMessage: string
        hatchedTitle: string
        hatchedMessage: string
        hatchingFailedTitle: string
        hatchingFailedMessage: string
      }
      examples: Record<string, string>
    }
    installTheme: {
      title: string
      pageTitle: string
      placeholder: string
      loading: string
      error: string
      empty: string
      install: string
      installing: string
      installed: string
      installs: (count: string) => string
    }
    settingsFields: string
    mcpServers: string
    archivedChats: string
    sections: Record<'maintenance' | 'sessions' | 'system' | 'usage', string>
    sectionDescriptions: Record<'maintenance' | 'sessions' | 'system' | 'usage', string>
    nav: Record<'newChat' | 'settings' | 'capabilities' | 'messaging' | 'artifacts', { title: string; detail: string }>
    sectionEntries: Record<'sessions' | 'system' | 'usage', { title: string; detail: string }>
    providerNavigate: string
    providerSessions: string
    refresh: string
    refreshing: string
    noResults: string
    pinSession: string
    unpinSession: string
    exportSession: string
    deleteSession: string
    noSessions: string
    gatewayRunning: string
    gatewayStopped: string
    hermesActiveSessions: (version: string, count: number) => string
    restartGateway: string
    openBrowser: string
    gatewayRestartFailed: string
    sharedGatewayRestartTitle: string
    sharedGatewayRestartDescription: (bots: string) => string
    sharedGatewayRestartConfirm: string
    sharedGatewayRestarted: (count: number) => string
    updateHermes: string
    reloadWindow: string
    actionRunning: string
    actionDone: string
    actionFailed: string
    actionStartedWaiting: string
    loadingStatus: string
    recentLogs: string
    noLogs: string
    days: (count: number) => string
    statSessions: string
    statApiCalls: string
    statTokens: string
    statCost: string
    actualCost: (cost: string) => string
    loadingUsage: string
    noUsage: (period: number) => string
    retry: string
    dailyTokens: string
    input: string
    output: string
    noDailyActivity: string
    topModels: string
    noModelUsage: string
    topSkills: string
    noSkillActivity: string
    actions: (count: string) => string
    logFile: string
    logLevel: string
    logSearchPlaceholder: string
    maintenance: {
      runOps: string
      doctor: string
      doctorDesc: string
      securityAudit: string
      securityAuditDesc: string
      backup: string
      backupDesc: string
      debugShare: string
      debugShareDesc: string
      debugShareRunning: string
      debugShareLinks: string
      debugShareFailed: string
      copyLink: string
      linkCopied: string
      curator: string
      curatorDesc: string
      curatorPaused: string
      curatorActive: string
      curatorDisabled: string
      curatorLastRun: (when: string) => string
      curatorNeverRan: string
      pause: string
      resume: string
      runNow: string
      memoryData: string
      memoryDataDesc: string
      memoryProvider: (name: string) => string
      builtinMemory: string
      memoryFile: string
      userFile: string
      bytes: (size: string) => string
      empty: string
      resetMemory: string
      resetUser: string
      resetAll: string
      resetConfirm: (target: string) => string
      resetDone: (files: string) => string
      resetFailed: string
      actionStarted: (name: string) => string
      actionFailed: (name: string) => string
      running: string
      viewLog: string
    }
  }

  messaging: {
    search: string
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

  webhooks: {
    search: string
    loading: string
    loadFailed: string
    subscriptions: (count: number) => string
    hint: string
    empty: string
    disabledTitle: string
    disabledBody: string
    enable: string
    enabling: string
    enabled: (name: string) => string
    disabled: (name: string) => string
    enableRow: string
    disableRow: string
    delete: string
    deleting: string
    deleted: string
    deleteTitle: string
    deleteDescPrefix: string
    deleteDescSuffix: string
    deleteFailed: (name: string) => string
    toggleFailed: (name: string, enabled: boolean) => string
    newSubscription: string
    restarting: string
    restartNeeded: string
    restartGateway: string
    restartingGateway: string
    restartFailed: (detail: string) => string
    enabledRestarting: string
    all: string
    deliverOnly: string
    createdTitle: string
    createdSecretHint: string
    webhookUrl: string
    secretOnce: string
    done: string
    fieldName: string
    fieldNamePlaceholder: string
    fieldDescription: string
    fieldDescriptionPlaceholder: string
    fieldEvents: string
    fieldEventsPlaceholder: string
    fieldSkills: string
    fieldSkillsPlaceholder: string
    fieldDeliver: string
    fieldDeliverOnly: string
    fieldPrompt: string
    fieldPromptPlaceholder: string
    nameRequired: string
    create: string
    creating: string
    created: string
    createFailed: (detail: string) => string
    copy: string
    deliverOptions: Record<string, string>
  }

  profiles: {
    close: string
    workspaceDesc: string
    currentBadge: string
    overview: string
    capabilities: string
    configureModel: string
    nameHint: string
    title: string
    count: (count: number) => string
    search: string
    loading: string
    newProfile: string
    /** Verb + noun: the profiles-list button and the native file-dialog titles,
     *  which stand alone. Per-profile menus use the bare `exportMenu`. */
    importProfile: string
    exportProfile: string
    archiveFilter: string
    exportMenu: string
    imported: string
    exported: string
    failedImport: string
    failedExport: string
    allProfiles: string
    advanced: string
    showAllProfiles: string
    switchToProfile: (name: string) => string
    switchToConnection: (name: string) => string
    switchConnectionFailed: (name: string) => string
    switchProfileFailed: (name: string) => string
    openProfileFailed: (name: string) => string
    manageProfiles: string
    connectGateway: string
    fleet: {
      allOnGateway: string
      gateway: (gateway: string) => string
      gatewayUnreachable: (gateway: string) => string
      onGateway: (name: string, gateway: string) => string
      switchTo: (name: string, gateway: string) => string
      deleteOn: (gateway: string) => string
    }
    remoteOverride: {
      menuItem: string
      badge: (host: string) => string
      title: (profile: string) => string
      description: string
      urlLabel: string
      urlPlaceholder: string
      urlInvalid: string
      tokenLabel: string
      tokenPlaceholder: string
      tokenSavedHint: string
      plainTextOptIn: string
      collisionWarning: (label: string) => string
      confirmTitle: string
      confirmNote: (profile: string, host: string) => string
      confirmBack: string
      connect: string
      connecting: string
      disconnect: string
      savedTitle: string
      savedMessage: (profile: string, host: string) => string
      removedTitle: string
      removedMessage: (profile: string) => string
      removeFailed: string
      authFailedTitle: string
      authFailedMessage: (profile: string, host: string) => string
      updateToken: string
    }
    actions: string
    color: string
    colorFor: string
    openInNewWindow: string
    setAsDefault: string
    defaultProfile: string
    defaultSet: (name: string) => string
    defaultDescription: string
    failedSetDefault: string
    setColor: (color: string) => string
    autoColor: string
    noProfiles: string
    selectPrompt: string
    refresh: string
    refreshing: string
    default: string
    skills: (count: number) => string
    env: string
    defaultBadge: string
    rename: string
    renameMenu: string
    editSoul: string
    copySetup: string
    copying: string
    modelLabel: string
    skillsLabel: string
    notSet: string
    soulDesc: string
    soulOptional: string
    soulPlaceholder: (mode: string) => string
    soulPlaceholderCloned: string
    soulPlaceholderEmpty: string
    unsavedChanges: string
    loadingSoul: string
    emptySoul: string
    saving: string
    saveSoul: string
    deleteTitle: string
    deleteDescPrefix: string
    deleteDescMid: string
    deleteDescSuffix: string
    deleting: string
    createDesc: string
    nameLabel: string
    cloneFrom: string
    cloneFromNone: string
    cloneFromDesc: string
    cloneFromDefault: string
    cloneFromDefaultDesc: string
    invalidName: (hint: string) => string
    nameRequired: string
    profileNameRequired: string
    defaultProfileDeleteBlocked: string
    creating: string
    createAction: string
    renameTitle: string
    displayNameTitle: string
    displayNameDesc: string
    displayNameLabel: string
    renameDescPrefix: string
    renameDescSuffix: string
    newNameLabel: string
    renaming: string
    created: string
    renamed: string
    deleted: string
    setupCopied: string
    soulSaved: string
    failedLoad: string
    failedDelete: string
    failedCopy: string
    failedLoadSoul: string
    failedSaveSoul: string
    failedCreate: string
    failedRename: string
  }

  modelAssignment: {
    saveFailed: string
    confirmTitle: string
    confirmDetail: string
    confirmAction: string
    declined: string
  }

  cron: {
    close: string
    title: string
    count: (count: number) => string
    jobFallbackTitle: string
    modelImpact: {
      title: string
      message: (count: number) => string
      detailMore: (names: string, remaining: number) => string
      review: string
      saveFailed: string
      confirmTitle: string
      confirmDetail: string
      confirmAction: string
      declined: string
    }
    search: string
    loading: string
    states: Record<string, string>
    lastRunFailed: string
    editJob: string
    runAgain: string
    deliveryLabels: Record<string, string>
    scheduleLabels: Record<string, string>
    scheduleHints: Record<string, string>
    days: Record<string, string>
    dayFallback: (value: string) => string
    everyDayAt: (time: string) => string
    weekdaysAt: (time: string) => string
    everyDayOfWeekAt: (day: string, time: string) => string
    monthlyOnDayAt: (dayOfMonth: string, time: string) => string
    topOfHour: string
    everyHourAt: (minute: string) => string
    newCron: string
    emptyDescNew: string
    emptyDescSearch: string
    emptyTitleNew: string
    emptyTitleSearch: string
    last: string
    next: string
    overdueSince: string
    noRuns: string
    manage: string
    showRuns: string
    hideRuns: string
    runHistory: string
    actionsTitle: string
    resume: string
    pause: string
    resumeTitle: string
    pauseTitle: string
    triggerNow: string
    edit: string
    deleteTitle: string
    deleteDescPrefix: string
    deleteDescSuffix: string
    deleting: string
    resumed: string
    paused: string
    triggered: string
    deleted: string
    created: string
    updated: string
    failedLoad: string
    failedUpdate: string
    failedTrigger: string
    failedDelete: string
    failedSave: string
    editTitle: string
    createTitle: string
    editDesc: string
    createDesc: string
    nameLabel: string
    namePlaceholder: string
    promptLabel: string
    promptPlaceholder: string
    frequencyLabel: string
    deliverLabel: string
    deliverNeedsHomeChannel: string
    modelLabel: string
    modelDefault: string
    customScheduleLabel: string
    customPlaceholder: string
    customHint: string
    optional: string
    promptRequired: string
    promptScheduleRequired: string
    scheduleRequired: string
    scriptOnlyEditHint: string
    saveChanges: string
    createAction: string
    tabs: {
      jobs: string
      blueprints: string
    }
    blueprints: {
      tab: string
      startFrom: string
      custom: string
      subtitle: string
      dialogDesc: string
      scheduleIt: string
      scheduling: string
      scheduled: string
      loading: string
      failedLoad: string
      emptyTitle: string
      emptyDesc: string
      fieldLabels?: Record<string, string>
      fieldDescriptions?: Record<string, string>
      optionLabels?: Record<string, string>
      catalog: Record<
        string,
        {
          title: string
          description: string
          fields?: Record<
            string,
            { label?: string; help?: string; optionLabels?: Record<string, string>; displayDefault?: string }
          >
        }
      >
    }
  }

  artifacts: {
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
    partialLoadMessage: (failed: number, total: number) => string
    safeLoadFailure: (count: number) => string
    unreadableFailure: (count: number) => string
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
  }

  artifactCard: {
    kind: Record<'code' | 'html' | 'svg', string>
    generating: (lines: number) => string
    versionBadge: (count: number) => string
    open: string
  }

  artifactPreview: {
    versionOf: (current: number, total: number) => string
    olderVersion: string
    newerVersion: string
    latest: string
    copyContent: string
    download: string
    openInBrowser: string
    openInBrowserFailed: string
    missingTitle: string
    missingBody: string
  }

  sidebar: {
    sessionOptions: string
    gatewayGroups: {
      grouping: string
      rename: string
      aliasLabel: string
      aliasHint: string
      resetName: string
      moveUp: string
      moveDown: string
      reorder: string
      actions: string
    }
    profileRail: string
    nav: Record<string, string>
    /** Display names for built-in session sources (platform ids remain stable). */
    sources: Record<string, string>
    searchAria: string
    searchPlaceholder: string
    clearSearch: string
    noMatch: (query: string) => string
    results: string
    pinned: string
    recent: string
    sessions: string
    terminal: string
    files: string
    review: string
    logs: string
    cronJobs: string
    groupAriaGrouped: string
    groupAriaUngrouped: string
    showProjects: string
    showSessions: string
    groupTitleGrouped: string
    groupTitleUngrouped: string
    allPinned: string
    shiftClickHint: string
    noWorkspace: string
    projectEmpty: string
    projectLoadFailed: string
    noSessions: string
    noFilterMatches: string
    projects: {
      showAllSessions: string
      sectionLabel: string
      empty: string
      home: string
      autoDiscovered: string
      newButton: string
      createTitle: string
      createDesc: string
      renameTitle: string
      addFolderTitle: string
      namePlaceholder: string
      foldersLabel: string
      ideaLabel: string
      ideaPlaceholder: string
      ideaGenerate: string
      ideaGenerating: string
      ideaShuffle: string
      ideaTemplates: Record<string, { label: string; idea: string }>
      noFolders: string
      addFolder: string
      primaryBadge: string
      removeFolder: string
      create: string
      menu: string
      menuRename: string
      menuAppearance: string
      noColor: string
      menuAddFolder: string
      manageFolders: string
      setPrimaryFolder: string
      foldersDescription: string
      keepOneFolder: string
      contextChanged: string
      menuSetActive: string
      menuDelete: string
      moveToProject: string
      movedTo: (name: string) => string
      moveFailed: string
      moveNoFolder: string
      moveNoProjects: string
      reveal: string
      copyPath: string
      removeFromSidebar: string
      createFailed: string
      unavailableAllProfiles: string
      activeProfileChanged: string
      staleBackend: string
      deleteConfirm: string
      startWork: string
      newWorktreeTitle: string
      newWorktreeDesc: string
      branchPlaceholder: string
      branchOff: () => { after: string; before: string }
      baseBranchPlaceholder: string
      baseBranchNone: string
      startWorkFailed: string
      worktreeStaleBackend: string
      worktreeProjectLabel: string
      worktreeProjectPlaceholder: string
      worktreeProjectNone: string
      convertBranch: string
      convertBranchTitle: string
      convertBranchDesc: string
      convertBranchPlaceholder: string
      convertBranchInstead: string
      branchOpenExisting: string
      branchSwitchHome: string
      branchCreateWorktree: string
      branchTrackRemote: string
      branchesLoading: string
      noBranches: string
      removeWorktree: string
      removeWorktreeFailed: string
      removeWorktreeConfirm: string
      removeWorktreeDirty: string
      forceRemove: string
      enter: (label: string) => string
      reorder: (label: string) => string
      toggle: (label: string, open: boolean) => string
      showAllCount: (count: number) => string
      back: string
    }
    newSessionIn: (label: string) => string
    showMoreIn: (count: number, label: string) => string
    loading: string
    loadMore: string
    loadCount: (step: number) => string
    messageCount: (count: number) => string
    toolCallCount: (count: number) => string
    row: {
      pin: string
      unpin: string
      markUnread: string
      markRead: string
      unreadFailed: string
      copyId: string
      export: string
      branchFrom: string
      rename: string
      archive: string
      newWindow: string
      openInTerminal: string
      hideTabBar: string
      openInNewTab: string
      openInSplit: string
      copyIdFailed: string
      sessionActions: string
      sessionRunning: string
      needsInput: string
      waitingForAnswer: string
      finishedUnread: string
      backgroundRunning: string
      draftSession: string
      handoffOrigin: (platform: string) => string
      ownedByProfile: (profile: string) => string
      renamed: string
      renameFailed: string
      renameTitle: string
      renameDesc: string
      untitledPlaceholder: string
      deleteTitle: string
      deleteDesc: (title: string) => string
      deleting: string
      deleted: string
      untitledChat: (id: string) => string
      messageCount: (count: number) => string
      todoProgress: string
      ageNow: string
      ageDay: string
      ageHour: string
      ageMin: string
    }
    dateDivider: {
      today: string
      yesterday: string
      thisWeek: string
      lastWeek: string
      thisMonth: string
    }
    statusDivider: {
      working: string
      done: string
    }
    markAllRead: string
  }

  composer: {
    message: string
    automaticModel: string
    wakingProfile: (profile: string) => string
    placeholderStarting: string
    placeholderReconnecting: string
    placeholderFollowUp: string
    newSessionPlaceholders: readonly string[]
    followUpPlaceholders: readonly string[]
    startVoice: string
    openDirective: string
    queueMessage: string
    steer: string
    stop: string
    send: string
    speaking: string
    transcribing: string
    thinking: string
    muted: string
    listening: string
    muteMic: string
    unmuteMic: string
    stopListening: string
    stopShort: string
    endConversation: string
    endShort: string
    stopDictation: string
    transcribingDictation: string
    voiceControls: string
    voiceEngine: string
    voiceEngineChained: string
    voiceEngineLive: string
    voiceEngineLiveNeedsKey: string
    voiceEngineChangeFailed: string
    voiceEngineChainedShort: string
    voiceEngineLiveShort: string
    voiceDictation: string
    speakReplies: string
    stopSpeakingReplies: string
    wakeWord: (phrase: string) => string
    wakeWordListening: (phrase: string) => string
    wakeWordOff: (phrase: string) => string
    wakeWordPausedVoice: (phrase: string) => string
    wakeWordArming: string
    wakeWordClientMicrophoneFailed: string
    wakeWordGatewayUnavailable: string
    wakeWordDisabled: string
    wakeWordDisabledForSurface: string
    wakeWordOwnedByOtherSurface: string
    wakeWordUnavailable: string
    completionGroups: {
      commands: string
      configuration: string
      exit: string
      info: string
      options: string
      session: string
      sessions: string
      skills: string
      themes: string
      toolsAndSkills: string
    }
    referenceDescriptions: {
      file: string
      folder: string
      git: string
      image: string
      tool: string
      url: string
    }
    referenceLabels: {
      file: string
      folder: string
      git: string
      image: string
      tool: string
      url: string
    }
    browseAllSessions: string
    lookupLoading: string
    lookupNoMatches: string
    lookupTry: string
    lookupOr: string
    commonCommands: string
    hotkeys: string
    helpFooter: string
    commandDescs: Record<string, string>
    hotkeyDescs: Record<string, string>
    attachUrlTitle: string
    attachUrlDesc: string
    urlPlaceholder: string
    urlHintPre: string
    attach: string
    queued: (count: number) => string
    queuedPaused: (count: number) => string
    attachmentOnly: string
    emptyTurn: string
    hiddenQueued: string
    attachments: (count: number) => string
    editingInComposer: string
    editingQueuedInComposer: string
    restoredDraftNotice: string
    restoredDraftUndo: string
    queueEdit: string
    queueSendNext: string
    queueSend: string
    queueSteer: string
    queueDelete: string
    queueResume: string
    queueResumeTip: string
    queueStuckTitle: string
    queueStuckBody: string
    previewUnavailable: string
    previewLabel: (label: string) => string
    couldNotPreview: (label: string) => string
    removeAttachment: (label: string) => string
    dictating: string
    preparingAudio: string
    speakingResponse: string
    readingAloud: string
    themeSuggestions: string
    noMatchingThemes: string
    themeTryPre: string
    themeTryPost: string
    attachLabel: string
    files: string
    folder: string
    images: string
    pasteImage: string
    url: string
    promptSnippets: string
    tipPre: string
    tipPost: string
    snippetsTitle: string
    snippetsDesc: string
    snippets: Record<string, { label: string; description: string; text: string }>
    dropFiles: string
    dropSession: string
    mcpSuggestions: {
      label: (server: string) => string
      tip: (keyword: string) => string
      connecting: (server: string) => string
      cancelTip: string
      added: (server: string) => string
      addedTip: string
      connectFailed: (server: string) => string
    }
    skillSuggestions: {
      label: (skill: string) => string
      tip: (skill: string) => string
      done: (skill: string) => string
      doneTip: string
    }
    githubSuggestions: {
      label: string
      tip: string
      done: string
      doneTip: string
    }
    repairSuggestions: {
      label: (server: string) => string
      tip: (server: string) => string
      working: (server: string) => string
      workingTip: string
      done: (server: string) => string
      doneTip: string
      failed: (server: string) => string
    }
    cronSuggestions: {
      label: string
      tip: (phrase: string) => string
      prefix: string
      done: string
      doneTip: string
    }
  }

  statusStack: {
    hideStack: string
    showStack: string
    agents: string
    background: (count: number) => string
    goalActive: string
    goalBlocked: string
    goalDone: string
    goalPaused: string
    goalWaiting: string
    subagents: (count: number) => string
    todos: (done: number, total: number) => string
    running: string
    stop: string
    dismiss: string
    exit: (code: number) => string
    control: {
      goalActiveTurns: (turn: number, maxTurns: number) => string
      goalDoneTurns: (turns: number) => string
      goalTurn: (turn: number) => string
      goalActions: string
      viewDetails: string
      addCriterion: string
      addCriterionDialogTitle: string
      addCriterionPlaceholder: string
      criterionLabel: string
      pauseGoal: string
      resumeGoal: string
      resumeNow: string
      clearGoal: string
      clearGoalConfirmTitle: string
      clearGoalConfirmBody: string
      copyCriterion: (index: number) => string
      removeCriterion: (index: number) => string
      removeCriterionConfirmTitle: (index: number) => string
      removeCriterionConfirmBody: (index: number) => string
      clearCriteria: string
      clearCriteriaConfirmTitle: string
      clearCriteriaConfirmBody: string
      criteriaHeader: (count: number) => string
      noCriteria: string
      goalDetailsTitle: string
      objectiveLabel: string
      contractOutcome: string
      contractVerification: string
      contractConstraints: string
      contractBoundaries: string
      contractStopWhen: string
      waitBarrierTitle: string
      waitUntil: (target: string) => string
      waitSession: (target: string) => string
      waitPid: (pid: number) => string
      qualityGatesTitle: string
      gateCommand: string
      gateAttempts: (attempts: number, max: number) => string
      gateTimeout: (seconds: number) => string
      gateLastExit: (code: number | null) => string
      loopActive: string
      loopPaused: string
      loopDeferred: string
      loopFinished: string
      loopRuns: (runs: number) => string
      loopRunCount: (current: number, total: number) => string
      loopNext: (time: string) => string
      loopEverySeconds: (seconds: number) => string
      loopEveryMinutes: (minutes: number) => string
      loopEveryHours: (hours: number) => string
      loopSelfPaced: string
      loopActions: string
      pauseLoop: string
      resumeLoop: string
      stopLoop: string
      stopLoopConfirmTitle: string
      stopLoopConfirmBody: string
      dismissLoop: string
      loopPromptLabel: string
      loopCadenceLabel: string
      loopUntilLabel: string
      loopDeferredNotice: string
      loopAwaitingResponse: string
      heartbeatActive: string
      heartbeatPaused: string
      heartbeatEveryMinutes: (minutes: number) => string
      heartbeatEveryHours: (hours: number) => string
      heartbeatEverySeconds: (seconds: number) => string
      heartbeatNext: (time: string) => string
      heartbeatDueWaitingForIdle: string
      heartbeatActions: string
      pauseHeartbeat: string
      resumeHeartbeat: string
      clearHeartbeat: string
      clearHeartbeatConfirmTitle: string
      clearHeartbeatConfirmBody: string
      heartbeatFiredCount: (count: number) => string
      actionFailed: (msg: string) => string
      actionSucceeded: string
      copySuccess: string
      copyFailure: string
      continuationFailed: string
      continuationQueued: string
      continuationBusy: string
      controlUnavailable: (msg: string) => string
      dismissError: string
      add: string
    }
    backgroundProcess: string
    standingGoal: string
    coding: {
      selectProject: string
      noProject: string
      startProjectChat: string
      viewChanges: string
      title: string
      noBranch: string
      detached: string
      clean: string
      changed: (count: number) => string
      ahead: (count: number) => string
      behind: (count: number) => string
      review: string
      close: string
      openChanges: string
      openFile: string
      stage: string
      unstage: string
      stageAll: string
      viewAsTree: string
      viewAsList: string
      revert: string
      revertAll: string
      revertConfirm: string
      revertAllConfirm: string
      staged: string
      noChanges: string
      notRepo: string
      noDiff: string
      scopeUncommitted: string
      scopeBranch: string
      scopeLastTurn: string
      commit: string
      commitAndPush: string
      commitPlaceholder: (shortcut: string) => string
      generateCommitMessage: string
      stopGenerating: string
      createPr: string
      openPr: string
      ghMissing: string
      agentShip: string
      agentShipUnavailable: string
      agentShipPrompt: string
      newBranch: string
      branchOffFrom: (base: string) => string
      switchTo: (branch: string) => string
      switchFailed: (branch: string) => string
      worktrees: string
      workLocation: string
      localWork: string
      projectDirectory: string
      worktreeWork: string
      newChatLocation: string
      createWorktree: string
    }
  }

  updates: {
    stages: Record<string, string>
    checking: string
    checkFailedTitle: string
    tryAgain: string
    notAvailableTitle: string
    unsupportedMessage: string
    connectionRetry: string
    gitUnusable: string
    connectionSettings: string
    openDownloadPage: string
    latestBody: string
    latestBodyBackend: string
    allSetTitle: string
    availableTitle: string
    availableBody: string
    availableTitleBackend: string
    availableBodyBackend: string
    availableBodyNoChangelog: string
    updateNow: string
    maybeLater: string
    moreChanges: (count: number) => string
    manualTitle: string
    manualBody: string
    manualPickedUp: string
    /** GUI/backend skew (#45205): backend updated but the running desktop app
     *  package (AppImage/.deb/.rpm) was not changed and must be reinstalled. */
    guiSkewTitle: string
    guiSkewBody: string
    copy: string
    copied: string
    done: string
    applyingBody: string
    applyingBodyBackend: string
    applyingClose: string
    errorTitle: string
    errorBody: string
    blockerTitle: string
    blockerBody: string
    foreignBlockerTitle: string
    foreignBlockerBody: string
    mixedBlockerBody: string
    closePreviewsAndUpdate: string
    closePreviewsAndCheckAgain: string
    localPreview: string
    portLabel: (port: number) => string
    pidLabel: (pid: number) => string
    technicalDetails: string
    notNow: string
    /** Multi-target update flow: client nudge after a backend update, and
     *  per-row fan-out outcomes when updating every registered instance. */
    clientAlsoBehindTitle: string
    clientAlsoBehindMessage: string
    clientAlsoBehindAction: string
    everythingDispatched: string
    everythingSkipped: string
    everythingRowFailed: string
    everythingFanoutFailedTitle: string
    applyStatus: {
      preparing: string
      pulling: string
      restarting: string
      notAvailable: string
      failed: string
      noReturn: string
    }
    desktopBridgeUnavailable: string
    starting: string
    backendApplied: string
    backendNoReturn: string
    changelog: {
      groups: {
        new: string
        fixed: string
        faster: string
        improved: string
        other: string
      }
      fallbackItem: string
      fallbackLabel: string
    }
  }

  /** The guided first run's pre-written opening line — banked, not generated,
   *  so the first paint costs no model time. Translated per locale because the
   *  model is told to speak the user's language from its first real turn, and
   *  an English opener above a Japanese reply reads as two different agents.
   *  `nameSuggestion` offers the OS account name as a default. */
  handoffTour: {
    profileTitle: string
    profileText: string
    sessionsTitle: string
    sessionsText: string
    stayTitle: string
    stayText: string
  }
  guidedGreeting: {
    line: string
    nameSuggestion: (name: string) => string
  }
  install: {
    stageStates: Record<string, string>
    stageNames: Record<string, string>
    oneTimeTitle: string
    unsupportedDesc: (platform: string) => string
    installCommand: string
    copyCommand: string
    viewDocs: string
    installTo: string
    retryAfterRun: string
    setupChoiceTitle: string
    setupChoiceDesc: string
    connectExistingTitle: string
    connectExistingShort: string
    connectExistingDesc: string
    installLocalTitle: string
    installLocalDesc: string
    localStartUnavailable: string
    remoteSetupTitle: string
    remoteSetupDesc: string
    remoteUrlTitle: string
    remoteUrlDesc: string
    remoteUrlPlaceholder: string
    probing: string
    probeError: string
    probeErrorDetails: string
    identityProvider: string
    authTitle: string
    authNeedsOauth: (provider: string) => string
    authSignedIn: string
    connected: string
    signIn: string
    signInWith: (provider: string) => string
    enterUrlFirst: string
    signInIncomplete: string
    tokenTitle: string
    tokenDesc: string
    pasteSessionToken: string
    incompleteSignInTest: string
    incompleteTokenTest: string
    testConnection: string
    testSucceeded: (baseUrl: string, version?: string) => string
    applyRemote: string
    backToSetup: string
    failedTitle: string
    settingUpTitle: string
    finishingTitle: string
    failedDesc: string
    activeDesc: string
    progress: (completed: number, total: number) => string
    currentStage: (stage: string) => string
    fetchingManifest: string
    error: string
    hideOutput: string
    showOutput: string
    lines: (count: number) => string
    noOutput: string
    cancelling: string
    cancelInstall: string
    transcriptSaved: string
    copiedOutput: string
    copyOutput: string
    reloadRetry: string
    openLogs: string
  }

  onboarding: {
    headerTitle: string
    headerDesc: string
    providerTitle: (id: string, fallback: string) => string
    preparingInstall: string
    starting: string
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
    genericApiKeyDescription: (provider: string) => string
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
    autoBrowser: (provider: string) => string
    reopenSignInPage: string
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

  freeTier: {
    /** Settings › Providers row title while the Nous identity is the free tier. */
    providerRowTitle: string
    /** The featured row's pitch while the identity is the free tier: what signing in adds. */
    providerRowPitch: string
    // First-launch introduction (ready screen + composer strip).
    readyTitle: string
    readyCaption: string
    begin: string
    signInInstead: string
    otherProviders: string
    stripTitle: string
    stripBody: string
    openModelPicker: string
    dismiss: string
    // Statusbar chip.
    /** The status-bar chip's label: the provider name alone; the model id and the sign-in follow it. */
    providerName: string
    statusLabel: (model: string) => string
    // Sign-in dialog.
    signIn: string
    signInHeading: string
    settingUp: string
    codeBody: string
    copyLink: string
    doNotShare: string
    waiting: string
    finishingHeading: string
    finishingBody: string
    signedInAs: (email: string) => string
    signedIn: string
    completedBody: string
    defaultModel: string
    change: string
    done: string
    notNow: string
    tryAgain: string
    startAgain: string
    didNotComplete: string
    rejectedBody: string
    supersededBody: string
    timedOutHeading: string
    timedOutBody: string
    retiredBody: string
    errorBody: string
    /** The account service asked for a short wait mid sign-in (a busy account, a rate limit, the ops pause). */
    busyHeading: string
    busyBody: (wait: string) => string
    /** The account service could not be reached or errored mid sign-in. */
    unreachableBody: string
    alreadySignedInHeading: string
    alreadySignedInBody: string
    // First-launch set-up failure notice: the free tier could not be created at boot.
    // One sentence per backend code (`hermes_cli/anon_auth.py::ANON_*`); the copy never says
    // the free MODEL is off — what is unavailable is using Hermes without signing in.
    setupFailed: {
      gateClosed: string
      paused: string
      rateLimited: (wait: string) => string
      unreachable: string
      serverError: string
      powRequired: string
      locked: string
      generic: string
      /** The sign-in door, when the account service is reachable: the Nous row sits right below. */
      signInBelow: string
      tryAgain: string
      retrying: string
    }
  }

  modelPicker: {
    title: string
    current: string
    unknown: string
    search: string
    noModels: string
    addProvider: string
    loadFailed: string
    loadingIntoMemory: string
    downloading: string
    localDownloadsHeading: string
    noAuthenticatedProviders: string
    pro: string
    proNeedsSubscription: string
    free: string
    freeTier: string
    priceTitle: string
    wasPrice: string
  }

  modelVisibility: {
    title: string
    search: string
    noAuthenticatedProviders: string
    addProvider: string
  }

  shell: {
    windowControls: string
    paneControls: string
    appControls: string
    modelMenu: {
      search: string
      noModels: string
      editModels: string
      refreshModels: string
      fast: string
      moaPresets: string
      moaPrefix: string
    }
    modelOptions: {
      noOptions: string
      options: string
      thinking: string
      fast: string
      effort: string
      minimal: string
      low: string
      medium: string
      high: string
      xhigh: string
      max: string
      ultra: string
      /** The CLI's `/reasoning` clamp note, e.g. "sends Max on this route". */
      sendsOnRoute: (level: string) => string
      updateFailed: string
      fastFailed: string
    }
    gatewayMenu: {
      gateway: string
      connected: string
      connecting: string
      offline: string
      inferenceReady: string
      inferenceNotReady: string
      checkingInference: string
      disconnected: string
      reconnectGateway: string
      openSystem: string
      connection: (label: string) => string
      state: (state: string) => string
      recentActivity: string
      viewAllLogs: string
      messagingPlatforms: string
    }
    approvalMode: {
      title: string
      ariaLabel: (mode: string) => string
      manual: string
      manualDescription: string
      smart: string
      smartDescription: string
      off: string
      offDescription: string
    }
    statusbar: {
      unknown: string
      restart: string
      update: string
      updateInProgress: string
      commitsBehind: (count: number, branch: string) => string
      desktopVersion: (version: string) => string
      backendVersion: (version: string) => string
      clientLabel: (version: string) => string
      connectionSsh: (host: string) => string
      connectionRemote: (host: string) => string
      connectionCloud: (host: string) => string
      connectionCloudTooltip: (host: string) => string
      connectionSshTooltip: (host: string) => string
      connectionRemoteTooltip: (host: string) => string
      backendLabel: (version: string) => string
      commit: (sha: string) => string
      branch: (branch: string) => string
      closeCommandCenter: string
      openCommandCenter: string
      showTerminal: string
      hideTerminal: string
      gateway: string
      gatewayReady: string
      gatewayNeedsSetup: string
      gatewayUnavailable: string
      gatewayChecking: string
      gatewayConnecting: string
      gatewayOffline: string
      gatewayRestarting: string
      gatewayTitle: string
      noRecentGatewayLogs: string
      customizeTitle: string
      hideStatusbar: string
      resetStatusbar: string
      toggleApprovalMode: string
      toggleBackendVersion: string
      toggleCacheHitRate: string
      toggleCommandCenter: string
      toggleContextUsage: string
      toggleRunningTimer: string
      toggleSessionTimer: string
      toggleTerminal: string
      toggleTokensPerSecond: string
      toggleVersion: string
      toggleFreeTier: string
      toggleWorkspace: string
      cacheHitRateTitle: string
      tokensPerSecondTitle: string
      agents: string
      closeAgents: string
      openAgents: string
      subagents: (count: number) => string
      failed: (count: number) => string
      running: (count: number) => string
      cron: string
      openCron: string
      webhooks: string
      openWebhooks: string
      starmap: string
      openStarmap: string
      turnRunning: string
      contextUsage: string
      subtaskMonitor: string
      systemResources: {
        backendHost: string
        unavailable: string
        title: string
        loading: string
        gpuUtilization: string
        gpuMemory: string
        ram: string
        unifiedNote: string
        toggle: string
      }
      contextUsagePanel: {
        compacting: string
        categories: {
          conversation: string
          mcp: string
          memory: string
          rules: string
          skills: string
          subagent_definitions: string
          system_prompt: string
          tool_definitions: string
        }
        empty: string
        loading: string
        percentFull: (percent: number) => string
        title: string
        tokenSummary: (used: string, max: string) => string
      }
      session: string
      yoloOn: string
      yoloOff: string
      modelNone: string
      noModel: string
      modelFast: string
      modelEffort: (effort: string) => string
      modelVariant: (variant: string) => string
      modelStatusNoModel: string
      switchModel: string
      openModelPicker: string
      modelPinned: string
      modelTitle: (provider: string, model: string) => string
      providerModelTitle: (provider: string, model: string) => string
    }
  }

  rightSidebar: {
    aria: string
    panelsAria: string
    files: string
    terminal: string
    noFolderSelected: string
    changeCwdTitle: string
    remotePickerTitle: string
    remotePickerDescription: string
    remotePickerSelect: string
    folderTip: (cwd: string) => string
    openFolder: string
    refreshTree: string
    collapseAll: string
    showIgnored: string
    hideIgnored: string
    previewUnavailable: string
    couldNotPreview: (path: string) => string
    noProjectTitle: string
    noProjectBody: string
    noProjectOpen: string
    noDiffs: string
    unreadableTitle: string
    unreadableBody: (error: string) => string
    emptyTitle: string
    emptyBody: string
    treeErrorTitle: string
    treeErrorBody: string
    tryAgain: string
    loadingTree: string
    loadingFiles: string
    loadingPlaceholder: string
    unableToReadPlaceholder: (error: string) => string
    terminalHide: string
    terminalsAria: string
    terminalNew: string
    terminalCloseOthers: string
    terminalCloseAll: string
    terminalStartFailed: (error: string) => string
    addToChat: string
  }

  preview: {
    tab: string
    browserTab: string
    closePane: string
    loading: string
    unavailable: string
    opening: string
    hide: string
    openPreview: string
    openInBrowser: string
    openInExternal: string
    popIn: string
    popOut: string
    linkHint: string
    sourceLineTitle: string
    source: string
    renderedPreview: string
    diff: string
    unknownSize: string
    binaryTitle: string
    binaryBody: (label: string) => string
    largeTitle: string
    largeBody: (label: string, size: string) => string
    previewAnyway: string
    truncated: string
    noInlineTitle: string
    noInlineBody: (mimeType: string) => string
    desktopBridgeUnavailable: string
    artifactWriteFailed: string
    invalidPdfDataUrl: string
    invalidPdfDataUrlType: string
    invalidPdfDataUrlPayload: string
    invalidPdfFileHeader: string
    pdfObjectUrlUnsupported: string
    webviewNotReady: string
    webviewInputUnavailable: string
    couldNotOpenTarget: (target: string) => string
    edit: string
    editing: string
    unsavedChanges: string
    saveFailed: (message: string) => string
    diskChangedTitle: string
    diskChangedBody: string
    overwrite: string
    discardReload: string
    reader: {
      fileNote: string
      artifactNote: string
      loadingNote: string
    }
    tour: {
      noLivePage: string
      noAnswer: string
      disabled: string
      inactiveSession: string
    }
    drive: {
      noLivePage: string
      inactiveSession: string
      pageNavigated: string
      pageRejected: (message: string) => string
      noAnswer: string
      cannotLocate: string
      notTextField: (target: string) => string
      pointerMissed: (kind: string) => string
      overlayIntercepted: string
      nothingToScroll: string
      pageLoading: string
      clicked: (target: string) => string
      typed: (target: string, submitted: boolean) => string
      hovered: (target: string) => string
      pressed: (key: string, target: string) => string
      scrolledPage: string
    }
    console: {
      deselect: string
      select: string
      copyFailed: string
      copyEntry: string
      sendEntry: string
      messages: (count: number) => string
      resize: string
      title: string
      selected: (count: number) => string
      sendToChat: string
      copySelected: string
      copyAll: string
      copy: string
      clear: string
      empty: string
      promptHeader: string
      sentTitle: string
      sentMessage: (count: number) => string
    }
    web: {
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
      restartNoActiveSession: string
      restartMissingTaskId: string
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
    }
  }

  zones: {
    paneTitles: {
      sessions: string
      terminal: string
      files: string
      review: string
      logs: string
    }
    layoutTitles: {
      default: string
      focus: string
      terminalDeck: string
      quad: string
    }
    showTabStrip: string
    hideTabStrip: string
    showStripTab: (title: string) => string
    hideStripTab: (title: string) => string
    lastTabKeptTitle: string
    lastTabKeptBody: string
    toggleStripTab: (title: string) => string
    minimize: string
    restore: string
    closeRunningTitle: string
    closeRunningBody: string
    closeRunningConfirm: string
    reload: string
    closeOthers: string
    closeToRight: string
    closeAll: string
    newSessionTab: string
    newTab: string
    pluginDisabled: (pluginId: string) => string
    pluginDisabledBody: string
    missingPane: (paneId: string) => string
    editTitle: string
    editHint: string
    reset: string
    templates: string
    custom: string
    newGridLayout: string
    saveCurrentAs: string
    nameLayoutPlaceholder: string
    deletePreset: (name: string) => string
    zoneEditorTitle: string
    editorHintPre: string
    editorHintPost: string
    templateColumns: string
    templateRows: string
    templateGrid: string
    templatePriority: string
    zoneTag: (index: number) => string
    mergeZones: (count: number) => string
    customZoneName: (count: number) => string
    layoutNamePlaceholder: (fallback: string) => string
    saveApply: string
    notExpressible: string
    zoneCount: (count: number) => string
    tabCount: (count: number) => string
  }

  contextMenu: {
    link: {
      openInApp: string
      openExternal: string
      copyUrl: string
      copyResolvedUrl: string
    }
    image: {
      copyImage: string
      copyImageAddress: string
      saveImageAs: string
    }
    edit: {
      cut: string
      paste: string
      selectAll: string
      addToDictionary: string
    }
    page: {
      copyPageUrl: string
      inspectElement: string
    }
  }

  assistant: {
    markdown: {
      alerts: {
        caution: string
        important: string
        note: string
        tip: string
        warning: string
      }
      mediaFetchFailed: (name: string) => string
      openFile: (kind: 'audio' | 'video') => string
      openMedia: (name: string) => string
      imageLoadFailed: (name: string) => string
      openImage: string
      loading: (name: string) => string
    }
    thread: {
      loadingSession: string
      showEarlier: string
      loadingResponse: string
      loadingLocalModel: (model: string) => string
      processingPrompt: string
      summarizing: string
      working: string
      resumeWhenBackgroundDone: (count: number) => string
      thinking: string
      thought: string
      thoughtBriefly: string
      thoughtFor: (duration: string) => string
      turnDuration: (duration: string) => string
      replyMetrics: {
        duration: string
        tokens: string
        context: string
        cache: string
        nonAinoModelCalls: string
        details: string
        sessionElapsed: string
        input: string
        output: string
      }
      today: (time: string) => string
      yesterday: (time: string) => string
      copy: string
      refresh: string
      moreActions: string
      branchNewChat: string
      react: string
      emojiSearch: string
      emojiLoading: string
      emojiEmpty: string
      moreEmoji: string
      removeReaction: (emoji: string) => string
      reactedBy: (product: string) => string
      reactFailed: string
      noActiveSession: string
      gatewayNotConnected: string
      steered: string
      modelChanged: string
      modelChangedTo: (model: string) => string
      modelChangedFrom: (previousModel: string, model: string) => string
      dismissError: string
      /** Layer titles for the structured error card (agent/error_surface.py).
       *  `generic` is the fallback when the backend sent no descriptor. */
      errorLayers: {
        auth: string
        billing: string
        disk: string
        endpoint: string
        gateway: string
        generic: string
        provider: string
        runtime: string
        streaming: string
      }
      /** One plain sentence per layer — what happened and what to do — shown
       *  when the failure code has no dedicated entry in `errorCodes`. */
      errorLayerBodies: {
        auth: string
        billing: string
        disk: string
        endpoint: string
        gateway: string
        generic: string
        provider: string
        runtime: string
        streaming: string
      }
      /** Per failure code (agent/error_classifier.py FailoverReason values plus
       *  the gateway's site codes): a title and one plain sentence saying what
       *  happened and what to do. Function entries take the provider label. */
      errorCodes: Record<ErrorCodeKey, ErrorCardCopy>
      /** Auth layer, keyed on how the provider is credentialed. The OAuth
       *  body is `errorOauthExpired` (already translated per locale). */
      errorAuthKinds: { api_key: ErrorCardCopy; oauth: Pick<ErrorCardCopy, 'title'> }
      /** Collapsed "Details" line holding the raw provider/gateway text. */
      errorDetails: string
      /** Stands in for the provider name when the descriptor carries none. */
      errorGenericProvider: string
      /** Global toast title for a mid-turn gateway `error` event. */
      errorToastTitle: string
      errorRetry: string
      errorLimitResets: (time: string) => string
      /** Arms ONE client-side retry of this turn at the 429's `resets_at` (#98852). */
      errorRetryAtReset: (time: string) => string
      /** Countdown shown while that retry is armed; `wait` is "12m 03s". */
      errorRetryScheduled: (time: string, wait: string) => string
      errorRetryScheduledCancel: string
      /** Escape hatch when Retry would only reproduce SESSION_NOT_OWNED (#106217). */
      errorStartNewSession: string
      errorSwitchProvider: string
      errorChooseModel: string
      errorCompressConversation: string
      errorCompressFailed: string
      errorOpenHermesFolder: string
      errorOpenHermesFolderFailed: string
      errorUpdateApiKey: string
      /** One-click recovery for an expired/revoked OAuth grant: re-runs that
       *  provider's sign-in flow (auth layer, authKind 'oauth'). */
      errorSignInAgain: (provider: string) => string
      /** Free-tier refusals: opens the free sign-in dialog (signing in is free and lifts the refusal). */
      errorSignInFreeTier: string
      /** Explains WHY the turn failed for an OAuth 401 — the raw body
       *  ("HTTP 401: User not found.") doesn't say "sign in again". */
      errorOauthExpired: (provider: string) => string
      errorOpenLogs: string
      errorOpenLogsFailed: string
      errorOpenDesktopLogs: string
      errorCopyDiagnostics: string
      errorSendDiagnostics: string
      filesChanged: (count: number) => string
      reviewChanges: string
      readAloudFailed: string
      preparingAudio: string
      stopReading: string
      readAloud: string
      editMessage: string
      expandMessage: string
      scrollToBottom: string
      stop: string
      restorePrevious: string
      restoreCheckpoint: string
      restoreFromHere: string
      restoreTitle: string
      restoreBody: string
      restoreConfirm: string
      restoreFailed: string
      restoreNext: string
      goForward: string
      sendEdited: string
      attachingFile: string
      messaging: (target: string) => string
      messaged: (target: string) => string
      messageFrom: (sender: string) => string
      repliedTo: (sender: string) => string
      showMessage: string
      showReply: string
      output: string
    }
    approval: {
      gatewayDisconnected: string
      sendFailed: string
      reconnect: string
      timedOutSystemLine: string
      openSafetySettings: string
      run: string
      command: string
      moreOptions: string
      allowSession: string
      alwaysAllowMenu: string
      jumpToApproval: string
      reject: string
      alwaysTitle: string
      alwaysDescription: (pattern: string) => string
      alwaysAllow: string
    }
    clarify: {
      notReady: string
      gatewayDisconnected: string
      sendFailed: string
      loadingQuestion: string
      other: string
      placeholder: string
      skip: string
      skipped: string
      continueLabel: string
      confirmAndContinueLabel: string
      answeredBadge: string
      questionProgress: (answered: number, total: number) => string
      lateAnswer: (question: string, choice: string) => string
      lateAnswerTip: string
      lateAnswerHint: string
    }
    mcpSetup: {
      installTitle: string
      enableTitle: string
      authorizeTitle: string
      installAction: string
      enableAction: string
      authorizeAction: string
      installed: (server: string) => string
      enabled: (server: string) => string
      authorized: (server: string) => string
      failed: (server: string) => string
      toolCount: (count: number) => string
      envRequired: string
      sendFailed: string
      reloadFailed: string
      gatewayDisconnected: string
    }
    tool: {
      copyCode: string
      renderingImage: string
      copyOutput: string
      copyCommand: string
      copyContent: string
      copyUrl: string
      copyResults: string
      copyQuery: string
      copyFile: string
      copyPath: string
      failedCalls: (count: number) => string
      skillActivity: {
        loading: string
        loaded: string
        loadFailed: string
        readingResource: string
        readResource: string
        resourceFailed: string
        listing: string
        listed: string
        listFailed: string
        unavailable: string
      }
      outputAlt: string
      rawResponse: string
      truncatedOutput: (count: number) => string
      copyActivity: string
      arguments: string
      result: string
      payload: string
      search: string
      searchResults: string
      details: string
      stdout: string
      stderr: string
      errorDetails: string
      snapshotSummary: string
      delegatedTask: string
      taskNumber: (index: number) => string
      fallbacks: {
        returnedError: string
        returnedSuccessFalse: string
        returnedStatus: (status: string) => string
        commandFailedExitCode: (code: number) => string
      }
      cron: {
        noJobs: string
        noJobsScheduled: string
        jobsCount: (count: number) => string
        schedule: string
        repeat: string
        delivery: string
        nextRun: string
      }
      subtitles: {
        navigatedInBrowser: string
        capturedBrowserSnapshot: string
        clickedPage: string
        clickedPageElement: (target: string) => string
        filledPageInput: string
        fieldValue: (field: string, value: string) => string
        queriedWebSources: string
        query: (query: string) => string
        executedCommand: string
        changedFile: string
        fetchedWebpage: string
      }
      countLabel: (count: number, noun: string, plural: string) => string
      recoveredOne: string
      recoveredMany: (count: number) => string
      failedOne: string
      failedMany: (count: number) => string
      statusRunning: string
      statusError: string
      statusRecovered: string
      statusDone: string
      /** Over-budget / rejected memory write title — not "Saved to memory". */
      resultUnavailable: string
      resultInterrupted: string
      memoryWriteNoted: string
      actions: {
        read: string
        reading: string
        opened: string
        opening: string
        failedToOpen: string
        searched: string
        searching: string
        ran: string
        running: string
        ranCode: string
        runningCode: string
      }
      runSummary: {
        delegate: {
          count: (count: number) => string
          past: string
          present: string
        }
        edit: {
          count: (count: number) => string
          past: string
          present: string
        }
        explore: {
          count: (count: number) => string
          past: string
          present: string
        }
        other: {
          count: (count: number) => string
          past: string
          present: string
        }
        run: {
          count: (count: number) => string
          past: string
          present: string
        }
      }
      prefixes: {
        browser: string
        web: string
      }
      titleTemplates: {
        actionCommand: (action: string, command: string) => string
        actionQuoted: (action: string, value: string) => string
        actionTarget: (action: string, target: string) => string
        prefixedDone: (prefix: string, action: string) => string
        runningPrefixedTool: (prefix: string, action: string) => string
        runningTool: (action: string) => string
      }
      titles: Record<ToolTitleKey, ToolTitleCopy>
    }
  }

  prompts: {
    gatewayDisconnected: string
    dangerousCommand: string
    reconnect: string
    sudoSendFailed: string
    secretSendFailed: string
    sudoTitle: string
    sudoDesc: string
    sudoCommandUnavailable: string
    sudoPlaceholder: string
    secretTitle: string
    secretDesc: string
    secretPlaceholder: string
    vaultUnlockSendFailed: string
    vaultUnlockTitle: (name: string) => string
    vaultUnlockDesc: (name: string) => string
    vaultSaveSendFailed: string
    vaultSaveTitle: (site: string) => string
    vaultSaveDesc: (origin: string) => string
    vaultSaveIdentifierLabel: string
    vaultSaveIdentifierPlaceholder: string
    vaultSavePasswordPlaceholder: string
    vaultSaveFootnote: string
    vaultSaveDecline: string
    vaultSaveConfirm: string
    vaultCodeSendFailed: string
    vaultCodeTitle: (site: string) => string
    vaultCodeDesc: (site: string) => string
    vaultCodeLabel: string
    vaultCodeFootnote: string
    vaultCodeSkip: string
    vaultCodeConfirm: string
    vaultUnlockPlaceholder: string
    vaultUnlockKeepLocked: string
    vaultUnlockConfirm: string
  }

  desktop: {
    activity: {
      sessionTask: string
      agentTaskRunning: string
      previewRestart: string
      running: string
      completed: string
      unknown: string
      failed: (code: string) => string
    }
    fsBridgeUnavailable: (product: string) => string
    fsSavingUnavailable: string
    fsRenameUnavailable: string
    fsDeleteUnavailable: string
    audioReadFailed: string
    fileDownloadBridgeUnavailable: string
    sessionUnavailable: string
    gatewayConnectionClosed: string
    gatewayConnectionFailed: string
    gatewayNotConnected: string
    transcriptSafeLoadLimit: string
    createSessionFailed: string
    promptFailed: string
    platformVisionUnsupported: string
    chooseModel: string
    providerCredentialRequired: string
    emptySlashCommand: string
    desktopCommands: string
    skillCommandsAvailable: (count: number) => string
    agentReportedError: string
    warningLine: (message: string) => string
    errorLine: (message: string) => string
    wakeUsage: string
    wakeStartFailed: (reason: string) => string
    wakeStatus: {
      title: string
      state: (listening: boolean) => string
      phrase: (phrase: string) => string
      provider: (provider: string) => string
      surface: (surface: string) => string
      input: (input: string) => string
      audioSilent: string
      inputError: (error: string) => string
      hint: (hint: string) => string
      defaultPhrase: string
      unknown: string
      auto: string
      systemDefault: string
    }
    sessionTitleSet: (title: string, queued: boolean) => string
    sessionTitleCleared: string
    sessionBusyQueued: string
    sessionBusyInterrupt: string
    browserRemoteUnavailable: string
    browserUsage: string
    browserChecking: (url: string) => string
    browserStatusConnected: (url: string) => string
    browserNotConnected: string
    browserDisconnected: string
    browserConnected: string
    browserEndpoint: (url: string) => string
    browserNextCall: string
    browserUrlUnavailable: string
    petScaleUsage: string
    compressing: (focusTopic: string) => string
    compressedMessages: (count: number) => string
    nothingToCompress: string
    slashNoOutput: (name: string) => string
    slashEmptyOutput: string
    slashMissingMessage: (name: string) => string
    slashEmptyMessage: (name: string) => string
    slashInvalidResponse: string
    slashCommandFailed: (name: string, error: string) => string
    slashUnavailable: {
      advanced: (command: string) => string
      composerVoice: string
      messaging: (command: string) => string
      settings: (command: string) => string
      terminal: (command: string) => string
      modelPicker: (command: string) => string
      sessionPicker: (command: string) => string
      fallback: (command: string) => string
    }
    yoloArmed: string
    yoloOff: string
    yoloSystem: (active: boolean) => string
    yoloTitle: string
    yoloToggleFailed: string
    botMode: {
      selectBotBeforeNewChat: string
      updateForAnotherChat: (product: string) => string
      selectBotOrGroup: string
    }
    profileStatus: (current: string) => string
    unknownProfile: string
    noProfileNamed: (target: string, available: string) => string
    newChatsProfile: (name: string) => string
    setProfileFailed: string
    sttDisabled: string
    stopFailed: string
    modelSwitchConfirm: string
    regenerateFailed: string
    editFailed: string
    editTurnUnavailable: string
    resumeFailed: string
    restoreNoActiveSession: string
    restoreTargetMissing: string
    restoreEmptyMessage: string
    readOnlyTranscriptTitle: string
    readOnlyTranscriptBody: string
    readOnlyTranscriptSendBlocked: string
    resumeStrandedTitle: string
    resumeStrandedBody: string
    poolSlotTimeoutBody: string
    poolSlotTimeoutOpenSettings: string
    resumeRetry: string
    sessionStillAvailableRetry: string
    sessionUnavailableRetry: string
    nothingToBranch: string
    branchNeedsChat: string
    sessionBusy: string
    branchStopCurrent: string
    branchNoText: string
    branchTitle: (n: number) => string
    branchFailed: string
    stopProcessFailed: string
    gatewayReconnectUnavailable: string
    remoteAttachTooLarge: (label: string, maxMb?: number) => string
    attachmentReadFailed: (label: string) => string
    attachmentAttachFailed: (label: string) => string
    skinCommand: {
      noThemes: string
      switched: (label: string) => string
      listHeading: string
      listHint: string
      completionList: string
      completionNext: string
      completionCurrent: string
      unknownTheme: (name: string, available: string) => string
    }
    commandResults: {
      noCommands: string
      steerQueued: (text: string) => string
      steerQueuedNoText: string
      steerRejected: string
      stoppedProcesses: (count: number) => string
      noBackgroundProcesses: string
      savedTranscript: (path: string) => string
      usage: (calls: string, input: string, output: string, total: string) => string
      noBackgroundTasks: string
      processLine: (status: string, command: string, metadata: string) => string
    }
    openSessionWindowFailed: string
    openNewWindowFailed: string
    popOutBrowserFailed: string
    openSessionTerminalFailed: string
    deleteFailed: string
    archived: string
    archiveFailed: string
    sessionOwnershipUnavailable: string
    cwdChangeFailed: string
    cwdStagedTitle: string
    cwdStagedMessage: string
    modelSwitchConfirmBody: string
    modelSwitchConfirmLabel: string
    modelSwitchConfirmTitle: (model: string) => string
    modelSwitchConfirmTitleFallback: string
    modelSwitchFailed: string
    modelSwitchKeepLabel: string
    modelSwitchStaleNotice: string
    hydrationSyncing: (profile: string) => string
    sessionExported: string
    sessionExportFailed: string
    imageSaved: string
    downloadStarted: string
    restartToUseSaveImage: string
    restartToSaveImages: string
    imageDownloadFailed: string
    imageFetchFailed: (status: string) => string
    openImage: string
    downloadImage: string
    savingImage: string
    imagePreviewFailed: string
    imageAttach: string
    imageWriteFailed: string
    imageAttachFailed: string
    pastedContent: string
    pasteAttachFailed: string
    attachImages: string
    clipboard: string
    noClipboardImage: string
    clipboardPasteFailed: string
    dropFiles: string
    attachFailed: (target?: string) => string
    attachFolderFailed: (target?: string) => string
    pickFilesTitle: string
    pickFoldersTitle: string
    quickEntry: {
      label: string
      askPlaceholder: string
      disconnectedPlaceholder: string
      targetSession: string
      sendTo: string
      currentChat: string
      newSession: string
    }
    handoff: {
      pickPlatform: string
      success: (platform: string) => string
      systemNote: (platform: string) => string
      failed: (error: string) => string
      timedOut: string
      startMessaging: string
    }
  }

  tips: {
    close: string
    /** Keyed by `TipId`, so a new tip without copy is a type error. Plus the
     *  campaign tips, which live outside the rotation's catalog: they carry
     *  a button, and `action` is its label. */
    items: Record<TipId, { title: string; text: string }> & {
      'local-runtime-update': { title: string; text: string; action: string }
      'local-setup': { title: string; text: string; action: string }
    }
  }

  errors: {
    genericFailure: string
    boundaryTitle: string
    boundaryDesc: string
    contribFailedToRender: (id: string) => string
    contribFailedToRenderDetail: (id: string, error: string) => string
    logUnavailable: (error: string) => string
    boundaryDetails: string
    sendDiagnostics: string
    reloadWindow: string
    openLogs: string
  }

  ui: {
    actions: {
      addContext: string
      filters: string
      grouping: string
      ordering: string
      show: string
      inboxStyle: string
      status: string
      pullRequest: string
      profile: string
      project: string
      archived: string
      resetDefaults: string
      expandAll: string
      collapseAll: string
      markAllRead: string
      labels: Record<string, string>
    }
    accessibility: {
      showOptions: string
      removeReference: string
      referenceImage: string
      generatedImage: string
      youtubeEmbed: string
      spotifyEmbed: string
      frameEmbed: (label: string) => string
      conversationTimeline: string
      holdToZoom: string
      moreActions: string
      openFullView: string
      openDiagram: string
      zoomOut: string
      resetZoom: string
      zoomIn: string
      copy: string
      copied: string
      close: string
      openPullRequest: (number: number) => string
    }
    messages: {
      embedLoad: (label: string) => string
      embedAlwaysAllow: (label: string) => string
      embedLoadFailed: (label: string) => string
      noPageAt: (path: string) => string
    }
    routes: {
      artifacts: string
      messaging: string
      capabilities: string
    }
    search: {
      clear: string
    }
    pagination: {
      label: string
      previous: string
      previousAria: string
      next: string
      nextAria: string
    }
    sidebar: {
      title: string
      description: string
      toggle: (open: boolean) => string
    }
  }
}

/**
 * Keep the upstream contract strongly typed while allowing Aino's additive
 * locale overlays to carry keys introduced between release trains. Known
 * upstream keys retain their exact signatures; unknown nested keys resolve
 * through the runtime locale fallback chain.
 */
type DeepTranslationTree<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]: DeepTranslationTree<T[K]> } & Record<string, any>
      : T

export type Translations = DeepTranslationTree<UpstreamTranslations>
