export interface BillingSurfaceTranslations {
  heading: string
  preview: string
  previewAria: string
  live: string
  freeTier: {
    signIn: string
    title: string
    message: string
    caption: string
    name: string
    footnote: string
    plan: string
    model: string
    connectors: string
    included: string
  }
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
    freeTier: string
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
