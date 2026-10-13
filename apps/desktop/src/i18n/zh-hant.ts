import { defineLocale, type TranslationOverrides } from './define-locale'
import { introZhHant } from './intro-zh-hant'
import { zh } from './zh'
import { zhHantArtifacts } from './zh-hant_artifacts'
import { zhHantAssistant } from './zh-hant_assistant'
import { zhHantBoot } from './zh-hant_boot'
import { zhHantCapabilities } from './zh-hant_capabilities'
import { zhHantChat } from './zh-hant_chat'
import { zhHantChrome } from './zh-hant_chrome'
import { zhHantCommandCenter } from './zh-hant_command_center'
import { zhHantCommon } from './zh-hant_common'
import { zhHantConnectors } from './zh-hant_connectors'
import { zhHantDiagnostics } from './zh-hant_diagnostics'
import { zhHantSettings } from './zh-hant_settings'

export const zhHantOverrides = {
  skillDeepLink: {
    installTitle: (name: string) => `安裝「${name}」？`,
    installDescription: '此技能將於新的工作階段中可用。請僅安裝可信來源的內容。',
    installTo: '安裝至',
    thisComputer: '這部電腦',
    installing: '正在安裝…',
    installComplete: (name: string) => `已安裝「${name}」`,
    destinationChanged: '安裝目標已變更。請關閉此對話框並重新開啟安裝連結。',
    installed: '已安裝',
    source: '來源'
  },
  externalOpenFailed: {
    title: '無法開啟此連結',
    message: '沒有註冊用於開啟此位址的瀏覽器。請複製連結並手動開啟。',
    copyUrl: '複製連結',
    close: '關閉'
  },
  sharedMetrics: {
    consentTitle: '分享使用統計？',
    dialogTitle: '使用統計',
    consentBody:
      'Hermes 可以統計你的使用方式：工作階段長度、執行了哪些模型和工具，以及何時發生失敗。它絕不記錄你的訊息、檔案、路徑或錯誤文字。',
    whatIsCollected: '統計哪些內容',
    collectedActivity: '工作階段：長度、結果、錯誤類型、每日活躍時間',
    collectedModels: '模型：使用哪些模型、token 總量',
    collectedNames: '功能：使用或關閉的內建工具、指令、應用程式區域和設定',
    collectedMilestones: '設定：完成了哪些步驟、提供方連線、技能、外掛和排程工作的數量',
    collectedReliability: '應用程式健康狀態：當機、啟動與回覆速度、更新、訊息平台連線',
    collectedUsage: '代理品質：未成功的編輯、損壞的工具呼叫、卡住的迴圈、每個任務的成本',
    collectedMachine: '機器：作業系統、記憶體範圍、GPU 類型、Hermes 版本、本機模型使用情況',
    sending:
      '除非你選擇分享，否則統計資料只會保留在這台電腦上。分享的統計資料每天傳送給 Nous 一次，並附帶此設定檔的隨機 ID。除了一則 Hermes 已安裝的一次性記錄（僅在你同意後計入）之外，你同意之前的統計資料永遠不會被傳送。你可以隨時在設定中變更。',
    readDocs: '查看完整說明',
    share: '與 Nous 分享',
    local: '保留在這部電腦上',
    off: '不用了',
    saveFailed: '無法儲存你的選擇',
    collectLabel: '收集使用統計',
    collectDesc: '僅限計數，保留在這部電腦上。絕不包含你的訊息、檔案、路徑或錯誤文字。',
    sendLabel: '與 Nous 分享使用統計',
    sendDesc:
      '每天一次將統計資料連同此設定檔的隨機 ID 傳送給 Nous。除一次性的安裝記錄外，你同意之前的統計資料絕不會被傳送。需要先開啟收集。',
    unavailable: '請更新 Hermes 後端以變更此設定。',
    stripBody: '僅限計數，絕不包含你的訊息或檔案。',
    stripReaskBody: '再次詢問：舊版本可能在你看到此問題之前就已儲存了「不用了」。',
    stripChoices: { share: '與 Nous 分享', local: '保留在這部電腦上', off: '不用了' },
    stripDetails: '詳細資訊'
  },
  intro: introZhHant,
  sessionImport: zhHantConnectors.sessionImport,
  common: zhHantCommon.common,
  fileMenu: zhHantChrome.fileMenu,
  boot: zhHantBoot.boot,
  notifications: zhHantDiagnostics.notifications,
  remoteDisplayBanner: zhHantBoot.remoteDisplayBanner,
  butterbar: zhHantBoot.butterbar,
  billingBlock: zhHantCommon.billingBlock,
  sendDiagnostics: zhHantDiagnostics.sendDiagnostics,
  titlebar: zhHantChrome.titlebar,
  language: zhHantSettings.language,
  settings: zhHantSettings.settings,
  skills: zhHantCapabilities.skills,
  starmap: zhHantCapabilities.starmap,
  agents: zhHantCapabilities.agents,
  commandCenter: zhHantCommandCenter.commandCenter,
  messaging: zhHantCommandCenter.messaging,
  profiles: zhHantCommandCenter.profiles,
  modelAssignment: {
    saveFailed: 'Hermes 未儲存該模型變更。',
    confirmTitle: '模型選擇警告',
    confirmDetail: '僅在你接受此權衡時確認。',
    confirmAction: '確認',
    declined: '已取消模型變更 — 你拒絕了資料訓練層級警告。'
  },
  cron: zhHantCommandCenter.cron,
  artifacts: zhHantArtifacts.artifacts,
  artifactCard: zhHantArtifacts.artifactCard,
  artifactPreview: zhHantArtifacts.artifactPreview,
  sidebar: zhHantChrome.sidebar,
  composer: zhHantChat.composer,
  statusStack: zhHantChat.statusStack,
  updates: zhHantBoot.updates,
  install: zhHantBoot.install,
  onboarding: zhHantBoot.onboarding,
  modelPicker: zhHantSettings.modelPicker,
  modelVisibility: zhHantSettings.modelVisibility,
  shell: zhHantChrome.shell,
  rightSidebar: zhHantChrome.rightSidebar,
  preview: zhHantArtifacts.preview,
  interfaceMode: {
    title: '介面模式',
    hint: '只改變顯示的內容，不改變 Hermes 的能力。',
    sessionNote: '由簡潔模式設定。此處的變更僅在本次工作階段內生效；切換到進階模式即可保留為你的設定。',
    simple: {
      label: '簡潔',
      description: '用於與 Hermes 對話。只有側邊欄和聊天；沒有終端機、檔案或差異面板。'
    },
    advanced: {
      label: '進階',
      description: '面向開發者。終端機、檔案、差異、狀態列和版面配置，按你的設定顯示。'
    }
  },
  zones: zhHantChrome.zones,
  contextMenu: zhHantChrome.contextMenu,
  assistant: zhHantAssistant.assistant,
  prompts: zhHantChat.prompts,
  desktop: zhHantChat.desktop,
  errors: zhHantDiagnostics.errors,
  tips: zhHantChat.tips,
  ui: zhHantCommon.ui,
  handoffTour: {
    profileTitle: '你的第一個任務在預設設定檔中執行',

    profileText:
      '這條欄用來切換設定檔。現在亮著的是 default，任務工作階段就在這裡。另一個是設定用的設定檔，歡迎聊天在那裡。',

    sessionsTitle: '每個設定檔都有自己的工作階段',

    sessionsText:
      '這個清單屬於 default 設定檔。「新工作階段」會在目前選取的設定檔中開始。在欄上切換設定檔，清單也會跟著改變。',

    stayTitle: 'Hermes 一鍵可及',

    stayText: '需要幫忙時，切換到設定用的設定檔並開啟「歡迎使用 Hermes」。它會一直在那裡。',
    localTitle: '這台電腦可以在本機執行模型',
    localText: (model: string) =>
      `${model} 適合你的硬體。免費執行，對話不會離開你的電腦。隨時在這裡的模型選單中選擇它。`
  },
  freeTier: {
    offer: {
      heading: '繼續使用 Hermes',
      body: '你正在使用免費額度。繼續使用 Hermes 的話，你會開始遇到限制。登入免費的 Nous 帳戶，即可獲得更多額度。',
      signIn: '登入',
      notNow: '暫不'
    }
  },
  billing: {
    ...zh.billing,
    summary: { balance: '餘額', plan: '方案', autoRefill: '自動儲值' },
    freeTier: {
      signIn: '登入',
      title: '你正在使用 Nous 免費服務',
      message: '登入 Nous 帳戶以解鎖更多模型和工具。',
      caption: '使用 nous/welcome，包含連接器。登入後會保留連接器，並增加需要帳戶的工具和其他所有模型。',
      name: 'Nous · 免費服務',
      footnote: '免費服務沒有餘額，無需付款。登入 Nous 帳戶後才會顯示支付與用量。',
      plan: '免費服務',
      model: '模型',
      connectors: '連接器',
      included: '已包含'
    },
    plan: { ...zh.billing.plan, freeTier: '免費' },
    notice: { ...zh.billing.notice, loggedOutMessage: '登入 Nous 帳戶以管理帳單。' },
    refusal: {
      ...zh.billing.refusal,
      cardConfirmationTitle: '需要確認信用卡',
      cardConfirmationMessage: '請在入口網站確認這張信用卡，才能用於終端扣款。'
    }
  },

  platformRechargeErrors: {
    conflict: '較早的請求已建立訂單。請關閉此視窗，在訂單歷史中開啟原訂單，勿重複付款。',
    account: '登入狀態已變更，請重新登入原帳戶後恢復訂單。',
    amount: '金額不符合渠道限額或精度要求，請調整儲值金額。',
    recovery: '本機訂單恢復記錄無法使用。請關閉此視窗，從儲值訂單查詢原訂單，請勿重複下單。',
    disabled: '目前儲值渠道無法使用。已有訂單仍可在儲值記錄中查詢。',
    retry: '登入已恢復，請再次點擊操作。系統未自動重複下單。',
    expired: '付款碼已過期，請重新整理訂單確認付款結果。'
  },

  platformDevices: {
    title: '裝置授權',
    refresh: '重新整理裝置',
    empty: '尚無裝置授權',
    active: '有效',
    revoked: '已撤銷',
    lastUsed: '最近使用',
    expires: '到期時間',
    revoke: '撤銷',
    confirmTitle: '撤銷裝置授權？',
    confirmDescription: '此裝置上的平台模型任務可能中斷，登入工作階段也將失效。',
    stepUp: '請輸入驗證器中的驗證碼以繼續。',
    code: '驗證器驗證碼',
    verify: '驗證',
    reauthenticate: '請登出並重新登入，再撤銷此裝置授權。',
    success: '裝置授權已撤銷',
    failed: '無法撤銷裝置授權。'
  },

  webhooks: {
    webhookUrl: 'Webhook 網址'
  },

  platformUsage: {
    pending: '費用核對中',
    partial: '部分費用已結算',
    settled: '本回合費用',
    unverified: '費用尚未核實',
    unavailable: '暫時無法查詢費用',
    signIn: '登入原帳戶後查看費用',
    retry: '重新核對',
    details: '查看明細',
    empty: '暫無結算紀錄',
    truncated: '僅顯示前 200 筆紀錄，費用尚未全部核實',
    recordSettled: '已結算',
    notCharged: '不計費',
    purposes: {
      chat: '對話',
      title: '會話標題',
      compression: '上下文壓縮',
      vision: '圖像理解',
      delegation: '子任務',
      session_summary: '對話摘要',
      approval: '操作核准判斷',
      mcp: 'MCP 模型呼叫',
      tts_audio_tags: '語音表達標註',
      side_question: '旁支問答',
      other_auxiliary: '輔助呼叫（未細分）'
    }
  },

  platformWallet: {
    title: 'Aino 錢包',
    available: '可用餘額',
    frozen: '凍結金額',
    refresh: '重新整理',
    updated: '更新於',
    subscriptions: '有效訂閱',
    noSubscriptions: '暫無有效訂閱',
    unlimited: '不限額',
    expires: '到期時間',
    paymentDisabled: '儲值暫未開放'
  },

  platformRecharge: {
    title: '儲值',
    description: '入帳金額以平台帳本為準。',
    amount: '儲值金額',
    range: '單筆限額',
    quote: '查看報價',
    create: '確認建立訂單',
    payAmount: '付款金額',
    creditAmount: '入帳額度',
    fee: '手續費',
    orderId: '訂單編號',
    openPayment: '前往付款',
    refresh: '重新整理訂單',
    cancelOrder: '取消訂單',
    newOrder: '新增儲值',
    success: '儲值成功',
    confirmingBalance: '訂單已完成，正在核對餘額',
    changedQuote: '最終金額有所變更，請確認後付款。',
    confirmPrice: '確認最終金額',
    unknown: '訂單結果待確認，請繼續恢復原訂單，勿重複付款。',
    resume: '恢復原訂單',
    unavailable: '目前沒有可用儲值管道',
    error: '暫時無法完成操作，請重試或從訂單紀錄恢復。',
    methods: { alipay: '支付寶', wxpay: '微信支付' },
    status: {
      PENDING: '等待付款',
      PAID: '已付款，正在入帳',
      RECHARGING: '已付款，正在入帳',
      COMPLETED: '訂單已完成',
      EXPIRED: '訂單已過期',
      CANCELLED: '訂單已取消',
      FAILED: '訂單處理失敗',
      REFUND_REQUESTED: '已申請退款',
      REFUNDING: '退款處理中',
      REFUND_PENDING: '退款待確認',
      PARTIALLY_REFUNDED: '已部分退款',
      REFUNDED: '已退款',
      REFUND_FAILED: '退款失敗'
    }
  },

  platformBillingHistory: {
    orders: '儲值訂單',
    usage: '消費紀錄',
    empty: '暫無紀錄',
    previous: '上一頁',
    next: '下一頁',
    open: '查看訂單',
    error: '暫時無法讀取紀錄',
    retry: '重試',
    qrCode: '付款 QR Code',
    filters: '篩選消費紀錄',
    startDate: '開始日期',
    endDate: '結束日期',
    model: '模型',
    modelPlaceholder: '輸入完整模型名稱',
    purpose: '呼叫用途',
    allPurposes: '所有用途',
    search: '查詢',
    reset: '重設',
    invalidDateRange: '開始日期不能晚於結束日期。',
    timezone: zone => `本機時區：${zone}`,
    totalRecords: count => `共 ${count} 筆`,
    pageSize: '每頁筆數',
    goToPage: page => `第 ${page} 頁`,
    jumpToPage: '跳至頁碼',
    jump: '跳轉',
    noMatches: '沒有符合篩選條件的消費紀錄',
    columns: { time: '呼叫時間', model: '模型', purpose: '呼叫用途', cost: '費用（USD）', status: '結算狀態' },
    details: '查看詳情',
    hideDetails: '收起詳情',
    copyField: label => `複製${label}`,
    requestId: '請求 ID',
    sessionId: '對話 ID',
    turnId: '回合 ID',
    callId: '呼叫 ID',
    inputTokens: '輸入 tokens',
    outputTokens: '輸出 tokens',
    cacheReadTokens: '快取讀取 tokens',
    cacheWriteTokens: '快取寫入 tokens',
    unknown: '未記錄',
    unknownPurpose: '用途未記錄',
    unclassifiedHelp: '部分歷史紀錄未細分，或呼叫時未記錄具體用途，無法可靠還原為某一類呼叫。'
  },

  platformModels: {
    switchBusy: '請等待目前對話完成，再切換至 Aino 模型或從 Aino 模型切換。',
    switchRecovery: '模型切換尚未完成。可重試授權、選擇其他模型或取消選擇器，不會重新傳送訊息。',
    builtIn: 'Aino 內建模型',
    custom: '自訂模型',
    search: '搜尋模型',
    signIn: '登入 Aino',
    loading: '正在載入模型',
    retry: '重試',
    myAccount: '我的帳戶',
    chooseCustom: '選擇自訂模型',
    recoveryFor: model => `${model} 復原操作`,
    unavailable: '模型無法使用',
    empty: '此帳戶暫無可用模型',
    catalogError: '無法載入 Aino 模型',
    balance: 'Aino 餘額',
    subscription: '訂閱額度',
    insufficient_balance: '餘額不足',
    quota_exhausted: '額度已用完',
    details: '價格與能力',
    input: '輸入',
    output: '輸出',
    cacheRead: '快取讀取',
    cacheWrite: '快取寫入',
    context: '上下文視窗',
    tools: '工具呼叫',
    vision: '圖片',
    reasoning: '推理',
    defaultModel: '新對話預設模型',
    historyReadOnly: (owner: string) =>
      `此對話屬於原 Aino 帳戶 ${owner}。可以查看本機歷史，但不能使用目前帳戶繼續傳送。`,
    newChatCurrentAccount: '使用目前帳戶建立新對話',
    followCustom: '使用自訂模型預設設定',
    defaultTag: '預設',
    not_authenticated: '請先登入 Aino 再使用此模型',
    platform_account_changed: '此模型屬於其他帳戶。請登入原帳戶或重新選擇模型。',
    bindingFailed: '模型授權失敗，訊息尚未傳送。請重新選擇模型後重試。',
    unsupported: '此連線不支援 Aino 內建模型',
    rate: '帳戶倍率',
    tiers: '階梯價格',
    timePricing: '分時價格',
    groupPeak: '尖峰價格',
    unknown: '未提供',
    supported: '支援',
    unsupportedCapability: '不支援'
  },

  summary: {
    aria: '工作階段資源',
    title: '工作階段資源',
    close: '關閉工作階段資源',
    environment: {
      title: '環境資訊',
      project: '專案',
      workingDirectory: '工作目錄',
      model: '模型',
      provider: '提供方',
      profile: '設定檔',
      branch: '分支',
      connection: '連線狀態',
      noProject: '未開啟專案',
      noSession: '未選擇工作階段',
      local: '本機',
      remote: '遠端'
    },
    changes: {
      title: '工作區變更',
      files: count => `${count} 個檔案`,
      additions: '新增',
      deletions: '刪除',
      staged: count => `${count} 個已暫存`,
      noChanges: '沒有未提交的變更',
      unavailable: '暫時無法取得程式碼變更',
      viewDiff: '檢視差異',
      refresh: '重新整理變更',
      stage: '暫存檔案',
      unstage: '取消暫存',
      revert: '還原檔案'
    },
    git: {
      title: 'Git 狀態',
      branch: '分支',
      tracking: '遠端追蹤',
      ahead: count => `領先 ${count}`,
      behind: count => `落後 ${count}`,
      commit: '最近提交',
      pullRequest: '提取要求',
      push: '推送',
      reviewAndCommit: '審查、提交或建立 PR',
      clean: '沒有領先或落後的提交',
      unavailable: '此工作區暫時無法使用 Git',
      noRepository: '此工作區不是 Git 儲存庫'
    },
    agents: {
      title: '子代理',
      running: count => `執行中 ${count}`,
      completed: count => `已完成 ${count}`,
      failed: count => `失敗 ${count}`,
      viewAll: '檢視所有代理',
      none: '此工作階段沒有子代理',
      dispatched: count => `已派發 ${count}`,
      finished: '已結束',
      status: {
        running: '執行中',
        queued: '排隊中',
        completed: '已完成',
        failed: '失敗',
        interrupted: '已中斷',
        dispatched: '已派發'
      }
    },
    context: {
      title: '上下文用量',
      noData: '尚無上下文資料'
    },
    sources: {
      title: '來源',
      add: '新增來源',
      image: '圖片附件',
      skill: '技能',
      tool: '工具',
      attachments: '附件',
      previews: '預覽',
      links: '連結',
      none: '此工作階段沒有來源',
      open: '開啟來源'
    },
    outputs: {
      title: '輸出內容',
      create: '建立檔案或網頁',
      prompt: '幫我建立檔案或網頁：'
    },
    plan: {
      title: '任務計畫',
      progress: (done, total) => `已完成 ${done} / ${total} 項`,
      recorded: '工作階段中最後記錄的計畫',
      status: { pending: '待處理', in_progress: '進行中', completed: '已完成', cancelled: '已取消' }
    },
    background: {
      title: '背景處理程序',
      status: { running: '執行中', done: '已完成', failed: '失敗' }
    },
    resources: {
      title: '系統資源',
      ram: '記憶體',
      gpu: 'GPU',
      unavailable: '系統資源暫時無法使用',
      retry: '重試資源查詢'
    },
    state: {
      showAll: count => `檢視全部（${count}）`,
      showLess: '收合',
      details: '詳細資訊',
      historyUnavailable: '暫時無法讀取此工作階段的歷史記錄',
      loading: '載入中…',
      unavailable: '暫時無法使用',
      noData: '尚無資料',
      retry: '重試'
    }
  }
} satisfies TranslationOverrides

export const zhHant = defineLocale(zhHantOverrides)
