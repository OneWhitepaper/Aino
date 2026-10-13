export type BotsMessages = {
  /** Left rail: the bot + group-chat roster. */
  editor: {
    fullConfigHint: string
    liveCapabilities: string
    editSoul: string
    remoteCapabilitiesHint: string
    skillsEnabled: (enabled: number, total: number) => string
    toolsetsEnabled: (enabled: number, total: number) => string
    mcpServers: string
    providerCustom: string
    modelCustom: string
    backToDropdowns: string
    inheritLaunch: string
    enterManually: string
    gatewayDefault: string
    modelNameExample: string
    modelSwitchFailed: string
    newDescription: string
    name: string
    title: string
    description: string
    createOn: string
    general: string
    capabilities: string
    skills: string
    tools: string
    cloneFrom: string
    freshProfile: string
    inheritedModel: string
    soul: string
    shareKeys: string
    shareKeysOn: (target: string) => string
    shareKeysHint: string
    needsModel: string
    configureModel: string
    createEmpty: string
    nameTakenHint: string
    nameFirstHint: string
    newerDesktop: string
    newerGateway: string
    emptySkillsHint: string
    defaultToolsHint: string
    catalog: string
    catalogInstalled: string
    mcpHint: string
    creating: string
    createBot: string
    auto: string
    autoHint: string
    unlock: string
    lockFace: string
    lockedHint: string
    unlockedHint: string
    noImageModel: string
    checkingImage: string
    chooseImage: string
    editDescription: (name: string, profile: string) => string
    nameTaken: (name: string) => string
    nameTakenOn: (name: string, target: string) => string
    currentConnection: (name: string) => string
    remoteHint: (target: string) => string
    cloneFromOn: (target: string) => string
    catalogHint: (source: string) => string
    sectionsFailed: (sections: string) => string
    updated: (name: string) => string
    created: (name: string) => string
    createdOn: (name: string, target: string) => string
  }
  roster: {
    title: string
    search: string
    searchPlaceholder: string
    newBotOrGroup: string
    groupChats: string
    emptyTitle: string
    emptyDesc: string
    noMatchQuery: (query: string) => string
    noMatchQueryOn: (query: string, gateway: string) => string
    noMatchFiltersOn: (gateway: string) => string
    noMatchFilters: string
    clearFilters: string
    newMenu: string
    activityToastsOn: string
    activityToastsOff: string
    filterRoster: string
    filterRosterActive: (count: number) => string
    globalGroupChats: (count: number) => string
    currentGateway: string
    staleRefresh: string
    gatewayUnreachable: (gateway: string) => string
    newMessageFor: (name: string) => string
    hasNewActivity: (name: string) => string
    openChatToSeeIt: string
    staleWaiting: string
    gatewayError: string
    deleteDescription: (name: string, path: string) => string
    deletedProfile: (name: string) => string
    deletedGroup: (name: string) => string
    deleting: string
    deleted: string
    allGateways: string
    hidden: string
    allHidden: string
    allHiddenDesc: string
    showHidden: string
    noHiddenMatch: string
    hiddenFromRoster: string
    pinned: string
    needsAttention: string
    needsInput: string
    /** The kind filter's three options, in menu order. */
    botsAndGroups: string
    botsOnly: string
    groupsOnly: string
    /** The activity filter's four options, in menu order. */
    anyActivity: string
    activeNow: string
    recentlyActive: string
    older: string
    /** How a row's owning gateway is doing — see `botSourceStatus`. */
    gatewayRemoved: string
    onDemand: string
    ready: string
    statusUnknown: string
    unavailable: string
    retryNow: string
    rosterUnavailable: (reason: string) => string
    waitingForGateway: string
  }
  /** User-made roster sections (folders the user files bots into). */
  sections: {
    newSection: string
    newTitle: string
    renameTitle: string
    nameLabel: string
    namePlaceholder: string
    create: string
    rename: string
    moveUp: string
    moveDown: string
    unassigned: string
    options: (name: string) => string
    headingTip: string
    emptyHint: string
    moveTo: string
    newSectionEllipsis: string
    removeFromSection: string
    deleted: (name: string, count: number) => string
    undo: string
  }
  /** Creating, editing and removing a bot. */
  bot: {
    newTitle: string
    /** Command-palette label for opening the New Bot dialog. */
    newCommand: string
    editTitle: string
    editMenu: string
    helpPromptPlaceholder: string
    descriptionHint: string
    newChatWith: string
    /** Re-opens the forever-chat on purpose. A plain row click only returns to
     *  the tabs already open, so a closed Bot Chat needs an explicit ask. */
    openBotChat: string
    /** Screen-reader label for the row spinner while a cold bot chat opens. */
    openingChat: string
    /** Row context menu: pin/hide toggles, their toasts, and the groups entry. */
    pinToTop: string
    unpin: string
    pinnedToast: (name: string) => string
    unpinnedToast: (name: string) => string
    hide: string
    unhide: string
    hiddenToast: (name: string) => string
    unhiddenToast: (name: string) => string
    groupsMenu: (groups: string) => string
    manageGroups: string
    metadataLoadFailed: string
    loadFailed: string
    groupsLoadFailed: string
    thisDevice: string
    /** Roster badge tooltips per attention class; `attentionFallback` when the class is unknown. */
    attentionFallback: string
    attentionProviderAuth: string
    attentionQuota: string
    attentionMissingConfig: string
    attentionBlocked: string
    duplicate: string
    duplicateFailed: string
    duplicateNameExhausted: string
    deleteTitle: string
    deleteFailed: (name: string) => string
    defaultDeleteBlocked: string
    remoteDeleteUnsupported: string
    removeFromAllGroups: string
    createFirstHint: string
    createFailed: string
    advanced: string
    advancedHint: string
    advancedFailed: string
    openAnotherChatUnsupported: string
    updateGatewayTitle: string
    updateGatewayMessage: (gateway: string) => string
    remoteConnectionsUnsupported: string
    /** Notice shown when /new is rerouted inside a canonical Bot Chat. */
    foreverChatTitle: string
    foreverChatMessage: string
    /** Bot-open failure toasts (canonical-chat.ts notifyBotOpenFailure). The
     *  raw RPC/connection error travels in the toast `detail`, never here. */
    openNeedsUpdateTitle: string
    openNeedsUpdateMessage: (connectionLabel: string) => string
    openUnreachableTitle: string
    openUnreachableMessage: string
    openChatFailedTitle: (botName: string) => string
    openChatFailedMessage: string
    openGateways: string
    /** Stands under the bot's name in a chat it has not spoken in yet. */
    chatEmpty: string
    /** First line of a brand-new bot's forever-chat — see `kickoffText`. */
    kickoff: string
    pinnedNotice: (name: string) => string
    unpinnedNotice: (name: string) => string
    hiddenNotice: (name: string) => string
    unhiddenNotice: (name: string) => string
    groupsLabel: (groups: string) => string
    duplicating: (name: string) => string
    duplicated: (name: string, source: string) => string
    chatOpenFailed: (name: string) => string
    storedSessionOpenUnsupported: string
    registryCheckFailed: (name: string, detail: string) => string
    attentionGeneric: string
    createDescription: string
    descriptionLabel: string
    createOn: string
    currentSuffix: string
    titlePlaceholder: string
    namePlaceholder: string
    fullConfigUnsupported: string
    remoteCapabilitiesHint: string
    soulConfigLabel: string
    skillsEnabled: (enabled: number, total: number) => string
    toolsetsEnabled: (enabled: number, total: number) => string
    mcpServers: string
    remoteCreateHint: (target: string) => string
    capabilitiesImmediate: string
    appearanceDescription: (name: string, slug: string) => string
    sectionsFailed: (sections: string) => string
    updated: (name: string) => string
    draftDiscarded: (name: string) => string
    draftCleanupFailed: (name: string) => string
    nameTaken: (slug: string) => string
    nameTakenOn: (slug: string, target: string) => string
    general: string
    capabilities: string
    skills: string
    tools: string
    mcp: string
    cloneFromProfile: string
    cloneFromRemote: (target: string) => string
    freshProfile: string
    inheritedModel: string
    soulLabel: string
    shareAuth: string
    shareAuthDescription: string
    noSkills: string
    capabilitiesNameTaken: string
    capabilitiesNameHint: string
    skillsUnsupported: string
    catalogUnsupported: string
    emptySkills: string
    catalogFrom: (source: string) => string
    toolsetHint: string
    mcpHint: string
    catalogInstalled: string
    catalog: string
    createAction: string
    creating: string
  }
  /** Avatar picker: shapes, blobs, pets, uploads, generation. */
  avatar: {
    classicShapes: string
    blobFromName: string
    unlockFollowsName: string
    randomize: string
    auto: string
    autoTitle: string
    /** The picker's four tabs, in order. */
    tabBot: string
    tabGenerate: string
    upload: string
    tabPet: string
    removeImage: string
    removeBackToShape: string
    describePlaceholder: string
    describeHint: string
    matchTheName: string
    pickPet: string
    petLoadFailed: string
    imageTooLarge: string
    generationFailed: string
    savedLocally: string
    savedLocallyDescriptionFailed: string
    generate: string
    generating: string
    keepExactFace: string
    lockFace: string
    unlockFace: string
    faceLocked: string
    faceFollowsName: string
    noImageModel: string
    checkingImageBackend: string
    chooseImage: string
    petGalleryEmpty: string
    petSearchPlaceholder: (count: number) => string
    petNoMatch: string
    petScrollMore: (visible: number, total: number) => string
  }
  /** Group chats: the room, its composer, threads and activity feed. */
  group: {
    newTitle: string
    newConversationHint: string
    manageDesc: string
    manageTitle: string
    settingsTitle: string
    settingsDesc: string
    nameLabel: string
    holdDetection: string
    holdDetectionHint: string
    compressHistory: string
    compressHistoryHint: (member: string) => string
    compressing: (member: string) => string
    compressDone: (member: string, compressed: number, detail: string) => string
    compressNothing: (member: string) => string
    compressFailed: (member: string, error: string) => string
    searchToAdd: string
    searchToAddPlaceholder: string
    removeFromSelection: string
    attachmentTooLarge: (name: string) => string
    disbandTitle: string
    disbandDescription: (group: string) => string
    deleteTitle: string
    deleteAction: string
    composerPlaceholder: string
    slashCommandsUnsupported: string
    attachHint: string
    newThread: string
    reply: string
    replyInThread: string
    replyInThreadPlaceholder: string
    openThread: string
    collapseThread: string
    collapseThreadLabel: string
    activity: string
    noActivityYet: string
    showActivity: string
    hideActivity: string
    activityActor: (who: string, action: string) => string
    activityBot: string
    activityDidSomething: string
    activityQueued: string
    activityWorking: string
    activityReplied: string
    activityPassed: string
    activityTimedOut: string
    activityFailed: string
    activityCancelled: string
    activitySettled: string
    activityCapped: string
    activityDelivered: string
    activityHeld: string
    activityStopped: string
    stop: string
    stopHint: string
    allHeldStatus: (count: number) => string
    heldMembersStatus: (members: string) => string
    holdReleaseHint: string
    needsYourInput: string
    noMembersToSend: (group: string) => string
    pictureGenerationFailed: string
    /** User-facing replacement for the agent-loop's `(empty)` sentinel. */
    emptyResponse: string
    nameTaken: (name: string) => string
    memberCount: (count: number) => string
    /** The reader's own lines in a room: the transcript speaker and the roster preview. */
    you: string
    /** How many of a room's members are reachable right now. */
    availableCount: (available: number, total: number) => string
    settingsHint: (group: string) => string
    settingsLabel: (group: string) => string
    disbandHint: (group: string) => string
    disbandLabel: (group: string) => string
    disbandAction: string
    disbanding: string
    disbandDone: string
    disbanded: (group: string) => string
    /** Wraps the bolded group name, so the name can lead the sentence in
     *  languages that put it there — see core's cron.deleteDesc* pair. */
    disbandDescPrefix: string
    disbandDescSuffix: (count: number) => string
    stopped: (group: string) => string
    removeAttachment: string
    threadFallback: string
    replyCount: (replies: number) => string
    dropToThread: string
    dropToRoom: string
    waitingForAnswer: string
    memberThinking: (name: string) => string
    roomWorking: string
    messageRoom: (group: string) => string
    newThreadPlaceholder: (group: string) => string
    everyoneMeta: string
    commandApproval: string
    answerFailed: (handle: string, error: string) => string
    wantsToRunCommand: (handle: string) => string
    asks: (handle: string) => string
    answerTo: (member: string) => string
    openGroupChat: string
    botCount: (count: number) => string
    availability: (available: number, total: number) => string
    noBotsInChat: string
    back: string
    hideFullHandle: string
    showFullHandle: string
    attachedFile: string
    attachedImage: string
    answerWithChoices: string
    answerPlaceholder: string
    answerOwnPlaceholder: string
    sending: string
    respond: string
    answer: string
    newDescription: (max: number) => string
    createAndJoin: string
    newGroupPlaceholder: string
    groupNameExample: string
    createdWith: (name: string, count: number) => string
    noBotsMatch: (query: string) => string
    noBotsYet: string
    pickAtLeast: (count: number) => string
    activityToastsTip: string
  }
  /** Skills hub + MCP setup surfaces embedded in the bot editor. */
  tools: {
    installHint: (name: string) => string
    searchHint: string
    resizeHint: string
    addServerFailed: string
    noTarget: string
    setKeyFailed: (name: string) => string
    configured: (name: string) => string
    authenticated: (name: string) => string
    testFailed: string
    completeSignIn: string
    needsSetup: (name: string) => string
    setUpDone: string
    saveTest: string
    authorizing: string
    setupFailed: string
    signIn: string
    setUp: string
    skillsHub: string
    filterSkills: string
    searchHub: string
    noMcpServers: string
    noHubMatch: string
    working: string
    search: string
    searchingShort: string
    browseHub: string
    hideHub: string
    hubHint: string
    searching: string
    added: string
    installed: (name: string) => string
    installTitle: (name: string) => string
    installing: (name: string) => string
    installFailed: (name: string) => string
  }

  /** Inline MCP server setup states. */
  mcp: {
    setupNeeded: (requires: string) => string
    setupDone: string
    saveTest: string
    authorizing: string
    setupFailed: string
    retry: string
    signIn: string
    setUp: string
    completeSignIn: string
    noTargetProfile: string
    couldNotAddServer: string
    failedToSet: (key: string) => string
    configured: (name: string) => string
    serverTestFailed: string
    oauthStartFailed: string
    oauthCallbackFailed: string
    oauthFailed: string
    authenticated: (name: string) => string
  }

  /** Provider/model picker copy that is not present in core model settings. */
  model: {
    providerLabel: string
    modelLabel: string
    providerCustom: string
    modelCustom: string
    providerPlaceholder: string
    modelPlaceholder: string
    providerCustomPlaceholder: string
    modelCustomPlaceholder: string
    gatewayDefault: string
    backToDropdowns: string
    inheritLaunch: string
    enterManually: string
    modelNamePlaceholder: string
  }

  /** Bot Screen: the bot's headless desktop on the gateway host, live in a pane. */
  screen: {
    title: string
    menu: string
    unsupportedTitle: string
    unsupportedBody: string
    notInstalledTitle: string
    notInstalledBody: string
    installHint: string
    install: string
    installing: string
    installCancelled: string
    installFailed: string
    noPackageManager: string
    portalTitle: string
    portalOpen: string
    heroStopped: string
    heroNotInstalled: string
    heroConnecting: string
    heroStale: string
    heroSuppressed: string
    heroOpenLive: string
    heroInstall: string
    heroStart: string
    portalWatching: string
    portalYouControl: string
    portalOtherControls: string
    portalStopped: string
    portalNotInstalled: string
    portalUnsupported: string
    portalUnavailable: string
    /** Managed runtimes (Hermes Cloud): updates are the platform's job, not the user's. */
    portalUnavailableManaged: string
    unavailableTitle: string
    autoOpenMenu: string
    autoOpenOnToast: (name: string) => string
    autoOpenOffToast: (name: string) => string
    stoppedTitle: string
    stoppedBody: string
    placementSandbox: (backend: string) => string
    imageSwitchTitle: string
    imageSwitchBody: (current: string, target: string) => string
    imageSwitchApprove: string
    imageSwitchKeep: string
    start: string
    attaching: string
    streamLost: string
    reconnect: string
    takeOver: string
    handBack: string
    handBackForce: string
    handBackForceHint: string
    openNeedsUpdate: string
    youControl: string
    otherControls: string
    agentControls: string
    controlTaken: string
  }

  /** Bot-scoped scheduled jobs. Generic scheduling chrome (weekday names,
   *  Daily/Hourly, the job verbs) resolves against core's `cron` section. */
  cron: {
    untitled: string
    nameNul: string
    instructionNul: string
    minutesFromNow: string
    hoursFromNow: string
    daysFromNow: string
    stopAfter: string
    runsHint: string
    detailDescription: string
    status: string
    active: string
    paused: string
    schedule: string
    rawSchedule: string
    repeat: string
    nextRun: string
    overdueSince: string
    lastRun: string
    lastResult: string
    workdir: string
    succeeded: string
    failed: string
    deliveryFailed: string
    blockedConfig: string
    legacyUnsafe: string
    filterHint: string
    needsRosterFirst: string
    staleNotice: string
    readFailure: string
    untitledJob: string
    jobNameNul: string
    jobInstructionNul: string
    statusActive: string
    statusPaused: string
    defaultTime: string
    rawPlaceholder: string
    createDesc: (bot: string) => string
    instruction: string
    whenToRun: string
    dayOfMonth: string
    sendResultsTo: string
    runHistoryOnly: string
    botChatTarget: (bot: string) => string
    continuity: string
    onceIn: (when: string) => string
    everyNDays: (days: number) => string
    everyNHours: (hours: number) => string
    everyNMinutes: (minutes: number) => string
    /** The frequency picker's eight options, in menu order. */
    freqOnce: string
    freqHourly: string
    freqDaily: string
    freqWeekdays: string
    freqWeekly: string
    freqMonthly: string
    freqInterval: string
    freqAdvanced: string
    unitMinutes: string
    unitHours: string
    unitDays: string
    /** One-line plain-language read-back of the picker's current state. */
    runsOnce: (count: number, unit: string) => string
    runsHourly: string
    runsDaily: (time: string) => string
    runsWeekdays: (time: string) => string
    runsWeekly: (day: string, time: string) => string
    runsMonthly: (day: string, time: string) => string
    runsInterval: (count: number, unit: string) => string
    runsRaw: string
    timesTotal: (count: number) => string
    jobDescription: string
    runsForever: string
    detailStatus: string
    detailSchedule: string
    detailScheduleRaw: string
    detailRepeat: string
    detailNextRun: string
    detailLastRun: string
    detailLastResult: string
    detailDeliversTo: string
    detailModel: string
    detailWorkingDirectory: string
    pausedSecurity: string
    onceMinutes: string
    onceHours: string
    onceDays: string
  }
}
