export type BotNavigationMessages = {
  manage: string
  manageAll: string
  settings: string
  switchBot: string
  rosterOptions: string
  activityFilters: string
  hiddenBots: string
  title: string
  description: string
  configScope: string
  defaultScope: string
  independentScope: string
  noDescription: string
  collaborationTitle: string
  modelIdentity: string
  modelIdentityDescription: string
  returnBot: string
  groups: string
  groupsDescription: string
  createGroup: string
  sideChat: string
  compact: string
  searchChat: string
  chatOptions: string
  name: string
  appearance: string
  defaultModel: string
  inheritDefault: string
  inheritFrom: (name: string) => string
  freshModel: string
  modelPending: string
  modelFailed: string
}

export const BOT_NAVIGATION_LOCALES: Record<string, BotNavigationMessages> = {
  en: {
    manage: 'Manage bots',
    manageAll: 'Manage all bots',
    settings: 'Current bot settings',
    switchBot: 'Switch bot',
    rosterOptions: 'Roster options',
    activityFilters: 'Activity and connection filters',
    hiddenBots: 'Hidden bots',
    title: 'Bot management',
    description: 'Each bot has its own identity, model, memory and ongoing conversation.',
    configScope: 'Configuration scope',
    defaultScope: 'Default bot',
    independentScope: 'Independent settings',
    noDescription: 'Independent identity and ongoing conversation',
    collaborationTitle: 'Independent settings, ongoing collaboration',
    modelIdentity: 'Model and identity',
    modelIdentityDescription:
      'Open settings from the bot’s chat header. The composer’s model applies only to the current chat.',
    returnBot: 'Return to Bot',
    groups: 'Group chats',
    groupsDescription: 'Bring existing bots together, mention them by name, assign work and follow progress.',
    createGroup: 'Create group chat',
    sideChat: 'New ordinary side chat',
    compact: 'Compact chat context',
    searchChat: 'Search chat history',
    chatOptions: 'Chat options',
    name: 'Bot name',
    appearance: 'Avatar, description and connection',
    defaultModel: 'Default model',
    inheritDefault: 'Inherit current default',
    inheritFrom: name => `Inherit from ${name}`,
    freshModel: 'Fresh configuration — no inherited model',
    modelPending: 'Reading the effective model…',
    modelFailed: 'Could not read the inherited model. Retry or choose a model in Advanced.'
  },
  zh: {
    manage: '管理机器人',
    manageAll: '管理全部机器人',
    settings: '当前机器人设置',
    switchBot: '切换机器人',
    rosterOptions: '名单选项',
    activityFilters: '活动与连接筛选',
    hiddenBots: '隐藏的机器人',
    title: '机器人管理',
    description: '每个机器人都有自己的身份、模型、记忆和长期聊天。',
    configScope: '配置范围',
    defaultScope: '默认机器人',
    independentScope: '独立配置',
    noDescription: '独立身份与持续会话',
    collaborationTitle: '独立配置，持续协作',
    modelIdentity: '模型与身份',
    modelIdentityDescription: '在机器人聊天顶部打开设置；输入框内的模型只作用于当前聊天。',
    returnBot: '返回 Bot',
    groups: '群聊',
    groupsDescription: '把已有机器人组成小组，按名称提及、分工和查看执行进展。',
    createGroup: '创建群聊',
    sideChat: '新建普通侧聊',
    compact: '压缩聊天上下文',
    searchChat: '搜索聊天记录',
    chatOptions: '聊天选项',
    name: '机器人名称',
    appearance: '头像、简介与连接',
    defaultModel: '默认模型',
    inheritDefault: '继承当前默认',
    inheritFrom: name => `继承自 ${name}`,
    freshModel: '全新配置 · 不继承模型',
    modelPending: '正在读取实际模型…',
    modelFailed: '未能读取继承模型，可重试或在高级设置中选择模型。'
  },
  'zh-hant': {
    manage: '管理機器人',
    manageAll: '管理全部機器人',
    settings: '目前機器人設定',
    switchBot: '切換機器人',
    rosterOptions: '名單選項',
    activityFilters: '活動與連線篩選',
    hiddenBots: '隱藏的機器人',
    title: '機器人管理',
    description: '每個機器人都有自己的身分、模型、記憶和長期聊天。',
    configScope: '設定範圍',
    defaultScope: '預設機器人',
    independentScope: '獨立設定',
    noDescription: '獨立身分與持續會話',
    collaborationTitle: '獨立設定，持續協作',
    modelIdentity: '模型與身分',
    modelIdentityDescription: '在機器人聊天頂部開啟設定；輸入框內的模型只作用於目前聊天。',
    returnBot: '返回 Bot',
    groups: '群組聊天',
    groupsDescription: '將現有機器人組成小組，按名稱提及、分工和查看執行進度。',
    createGroup: '建立群組聊天',
    sideChat: '新增一般側聊',
    compact: '壓縮聊天上下文',
    searchChat: '搜尋聊天記錄',
    chatOptions: '聊天選項',
    name: '機器人名稱',
    appearance: '頭像、簡介與連線',
    defaultModel: '預設模型',
    inheritDefault: '繼承目前預設',
    inheritFrom: name => `繼承自 ${name}`,
    freshModel: '全新設定 · 不繼承模型',
    modelPending: '正在讀取實際模型…',
    modelFailed: '無法讀取繼承模型，可重試或在進階設定中選擇模型。'
  },
  ja: {
    manage: 'ボットを管理',
    manageAll: 'すべてのボットを管理',
    settings: '現在のボット設定',
    switchBot: 'ボットを切り替え',
    rosterOptions: '名簿オプション',
    activityFilters: 'アクティビティと接続の絞り込み',
    hiddenBots: '非表示のボット',
    title: 'ボット管理',
    description: '各ボットは独自のアイデンティティ、モデル、メモリ、継続する会話を持ちます。',
    configScope: '設定の範囲',
    defaultScope: '既定のボット',
    independentScope: '独立した設定',
    noDescription: '独立したアイデンティティと継続する会話',
    collaborationTitle: '独立した設定で継続して協力',
    modelIdentity: 'モデルとアイデンティティ',
    modelIdentityDescription:
      'チャット上部からボット設定を開きます。入力欄のモデルは現在のチャットだけに適用されます。',
    returnBot: 'Bot に戻る',
    groups: 'グループチャット',
    groupsDescription: '既存のボットでグループを作り、名前でメンションして作業を分担し、進捗を確認できます。',
    createGroup: 'グループを作成',
    sideChat: '通常のサイドチャットを開始',
    compact: 'チャットの文脈を圧縮',
    searchChat: 'チャット履歴を検索',
    chatOptions: 'チャットのオプション',
    name: 'ボット名',
    appearance: 'アバター、説明と接続',
    defaultModel: '既定のモデル',
    inheritDefault: '現在の既定を継承',
    inheritFrom: name => `${name} から継承`,
    freshModel: '新規設定 · モデルを継承しない',
    modelPending: '有効なモデルを読み込み中…',
    modelFailed: '継承モデルを読み込めません。再試行するか詳細設定でモデルを選択してください。'
  }
}
