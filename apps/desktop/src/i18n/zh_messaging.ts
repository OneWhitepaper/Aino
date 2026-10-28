import type { Translations } from './types'

export const zhMessaging = {
  directory: {
    statusFilters: '细分连接状态',
    title: '消息平台',
    subtitle: '在熟悉的聊天软件里，随时找 Aino 帮忙。',
    common: '常用平台',
    commonHint: '国内协作与日常沟通',
    more: '更多聊天平台',
    moreHint: '连接你正在使用的工具',
    integrations: '开发与集成',
    integrationsHint: '接口、事件与智能体互联',
    all: '全部平台',
    configured: '已配置',
    attention: '需要处理',
    configure: '配置',
    sendOnly: '仅发送',
    privacy: '各平台独立配置，账号凭据仅用于对应平台连接。',
    noMatches: '没有找到相关平台',
    noMatchesHint: '换个关键词试试，或查看全部平台。',
    showAll: '查看全部平台',
    discardTitle: '放弃未保存的配置？',
    discardHint: '此次修改尚未保存，关闭后不会保留这些配置。',
    discard: '放弃修改'
  },
  search: '搜索消息平台…',
  statusFilter: {
    all: '全部',
    bad: '错误',
    good: '已连接',
    muted: '未启用',
    warn: '需要关注'
  },
  loading: '正在加载消息平台…',
  loadFailed: '消息平台加载失败',
  states: {
    connected: '已连接',
    connecting: '连接中',
    disabled: '已禁用',
    fatal: '错误',
    gateway_stopped: '消息网关已停止',
    not_configured: '需要设置',
    pending_restart: '需要重启',
    retrying: '重试中',
    startup_failed: '启动失败'
  },
  unknown: '未知',
  hintPendingRestart: '在状态栏重启网关以应用此更改。',
  sharedListenerUrl: '通过共享网关监听器提供，地址为',
  hintGatewayStopped: '在状态栏启动网关以建立连接。',
  credentialsSet: '凭据已设置',
  needsSetup: '需要设置',
  gatewayStopped: '消息网关已停止',
  getCredentials: '获取你的凭据',
  openSetupGuide: '打开设置指南',
  required: '必填',
  recommended: '推荐',
  advanced: count => `高级 (${count})`,
  noTokenNeeded: '此平台无需在此填写令牌。请按上方设置指南操作，然后在下方启用。',
  enabled: '已启用',
  disabled: '已禁用',
  unsavedChanges: '有未保存的更改',
  saving: '保存中…',
  saveChanges: '保存更改',
  saved: '已保存',
  replaceValue: '替换当前值',
  openDocs: '打开文档',
  clearField: key => `清除 ${key}`,
  addListEntry: '再添加一个',
  removeListEntry: '移除',
  listEntryPlaceholder: '输入 ID',
  enableAria: name => `启用 ${name}`,
  disableAria: name => `禁用 ${name}`,
  platformEnabled: name => `${name} 已启用`,
  platformDisabled: name => `${name} 已禁用`,
  restartToApply: '此更改将在网关重启后生效。',
  setupSaved: name => `${name} 设置已保存`,
  restartToReconnect: '新凭据将在网关重启后生效。',
  appliedLive: '已应用到正在运行的网关。',
  connectingLive: '正在运行的网关正在使用新凭据连接。',
  keyCleared: key => `${key} 已清除`,
  setupUpdated: name => `${name} 设置已更新。`,
  failedUpdate: name => `更新 ${name} 失败`,
  failedSave: name => `保存 ${name} 失败`,
  failedClear: key => `清除 ${key} 失败`,
  pendingRequests: count => `待处理请求（${count}）`,
  pendingAria: count => `${count} 条待处理配对请求`,
  approvedUsers: count => `已批准用户（${count}）`,
  approve: '批准',
  approving: '批准中…',
  revoke: '撤销',
  revoking: '撤销中…',
  revokeAria: name => `撤销 ${name}`,
  revokeTitle: '撤销访问权限',
  revokeDesc: name => `${name} 将失去访问权限，下次发送消息时不再被识别。`,
  approvedUser: name => `已批准 ${name}`,
  approvedHint: '对方下次发送消息时会被自动识别。',
  revokedUser: name => `已撤销 ${name}`,
  failedApprove: name => `批准 ${name} 失败`,
  failedRevoke: name => `撤销 ${name} 失败`,
  pairingLockedOut: '批准失败次数过多，该平台已被暂时锁定，请稍后再试。',
  waitingSince: minutes => (minutes < 1 ? '刚刚' : `${minutes} 分钟前`),
  restartNeeded: '已保存。请重启消息网关以应用新设置。',
  restartNow: '立即重启',
  restarting: '正在重启…',
  restartFailedManual: '网关重启失败 — 请手动重启并检查网关日志。',
  telegramQr: {
    title: '选择连接 Telegram 机器人的方式',
    subtitle: '两种方式都会连接一个由你控制的机器人，凭据仅保存在此 Hermes 安装中。',
    quickSetup: '快速设置',
    recommended: '推荐',
    quickHelp: '扫描二维码并在 Telegram 中确认。Hermes 会自动创建机器人并识别你的 Telegram 用户 ID。',
    createWithQr: '通过二维码创建',
    starting: '正在启动…',
    replaceWarning: 'Telegram 凭据已配置。保存后，新的二维码设置或机器人令牌将替换当前机器人。',
    scanHint: '用手机上的 Telegram 应用扫描，或在这台电脑上打开链接。',
    waiting: '等待 Telegram 确认…',
    expiresIn: remaining => `${remaining} 后过期`,
    expired: '已过期',
    openTelegram: '打开 Telegram',
    ready: '机器人已创建',
    allowedUsers: '允许的用户',
    ownerDetected: '已识别所有者',
    addAtLeastOne: '请至少添加一个 Telegram 用户 ID。',
    userIdPlaceholder: 'Telegram 用户 ID',
    add: '添加',
    numericOnly: '允许的 Telegram 用户 ID 必须是数字。',
    saveAndRestart: '保存并重启',
    applying: '正在保存…',
    pairingExpired: 'Telegram 配对已过期。请重新开始二维码设置。',
    stillWaiting: detail => `仍在等待 Telegram。出错后重试：${detail}`,
    savedRestarting: 'Telegram 已保存；网关正在重启…',
    savedRestartFailed: detail => `Telegram 已保存；网关重启失败${detail}`
  },
  fieldCopy: {
    FEISHU_APP_ID: { label: '应用 ID', placeholder: '粘贴飞书 App ID', help: '飞书开放平台 → 应用 → 凭证与基础信息。' },
    FEISHU_APP_SECRET: { label: '应用密钥', placeholder: '粘贴 App Secret', help: '从飞书应用的凭证页面获取。' },
    FEISHU_ENCRYPT_KEY: {
      label: '事件加密密钥',
      placeholder: '填写 Encrypt Key',
      help: '与飞书事件订阅后台保持一致。'
    },
    FEISHU_VERIFICATION_TOKEN: {
      label: '事件校验令牌',
      placeholder: '填写 Verification Token',
      help: '与飞书事件订阅后台保持一致。'
    },
    DINGTALK_CLIENT_ID: { label: '应用标识', placeholder: '粘贴 Client ID / App Key', help: '从钉钉开发者后台获取。' },
    DINGTALK_CLIENT_SECRET: {
      label: '应用密钥',
      placeholder: '粘贴 Client Secret / App Secret',
      help: '请填写钉钉应用的密钥。'
    },
    WECOM_BOT_ID: {
      label: '群机器人标识',
      placeholder: '粘贴群机器人 ID / Webhook 密钥',
      help: '此方式仅用于向企业微信群发送消息。'
    },
    WECOM_SECRET: { label: '机器人密钥', placeholder: '粘贴机器人 Secret', help: '从企业微信群机器人配置中获取。' },
    WECOM_CALLBACK_CORP_ID: { label: '企业 ID', placeholder: '粘贴 Corp ID', help: '在企业微信管理后台查看企业 ID。' },
    WECOM_CALLBACK_CORP_SECRET: {
      label: '应用密钥',
      placeholder: '粘贴应用 Secret',
      help: '在企业微信自建应用中获取。'
    },
    WECOM_CALLBACK_AGENT_ID: { label: '应用 ID', placeholder: '粘贴 Agent ID', help: '在企业微信自建应用中获取。' },
    WECOM_CALLBACK_TOKEN: {
      label: '回调校验令牌',
      placeholder: '填写回调 Token',
      help: '与企业微信回调配置保持一致。'
    },
    WECOM_CALLBACK_ENCODING_AES_KEY: {
      label: '消息加解密密钥',
      placeholder: '填写 EncodingAESKey',
      help: '与企业微信回调配置保持一致。'
    },
    WEIXIN_ACCOUNT_ID: {
      label: '微信接入账号 ID',
      placeholder: '填写扫码后获取的账号 ID',
      help: '扫码接入后生成的账号标识。'
    },
    WEIXIN_TOKEN: {
      label: '微信接入令牌',
      placeholder: '填写扫码后获取的令牌',
      help: '扫码确认后生成的接入令牌，仅用于连接微信。'
    },
    WEIXIN_BASE_URL: {
      label: '接口地址',
      placeholder: 'https://ilinkai.weixin.qq.com',
      help: '通常保留原有扫码流程保存的地址。'
    },
    EMAIL_ADDRESS: {
      label: '邮箱地址',
      placeholder: '例如 assistant@example.com',
      help: '建议使用专门用于机器人的邮箱。'
    },
    EMAIL_PASSWORD: {
      label: '邮箱授权码',
      placeholder: '填写应用专用密码或授权码',
      help: '请先在邮箱后台开启 IMAP / SMTP。'
    },
    EMAIL_IMAP_HOST: {
      label: '收件服务器',
      placeholder: '例如 imap.example.com',
      help: '在邮箱服务商的帮助页面查看 IMAP 地址。'
    },
    EMAIL_SMTP_HOST: {
      label: '发件服务器',
      placeholder: '例如 smtp.example.com',
      help: '在邮箱服务商的帮助页面查看 SMTP 地址。'
    },
    YUANBAO_APP_ID: { label: '应用 ID', placeholder: '粘贴腾讯元宝 App ID', help: '从腾讯元宝接入流程获取。' },
    YUANBAO_APP_SECRET: { label: '应用密钥', placeholder: '粘贴腾讯元宝 App Secret', help: '从腾讯元宝接入流程获取。' },
    TELEGRAM_BOT_TOKEN: {
      label: '机器人令牌',
      help: '用 @BotFather 创建一个机器人，然后粘贴它给你的令牌。',
      placeholder: '粘贴 Telegram 机器人令牌'
    },
    TELEGRAM_ALLOWED_USERS: {
      label: '允许的 Telegram 用户 ID',
      help: '推荐。来自 @userinfobot 的数字 ID（每格一个）。不设置则任何人都能私信你的机器人。'
    },
    TELEGRAM_PROXY: { label: '代理 URL', help: '仅在 Telegram 被屏蔽的网络中需要。' },
    DISCORD_BOT_TOKEN: { label: '机器人令牌', help: '在 Discord 开发者门户创建应用，添加机器人，然后粘贴其令牌。' },
    DISCORD_ALLOWED_USERS: { label: '允许的 Discord 用户 ID', help: '推荐。Discord 用户 ID（每格一个）。' },
    DISCORD_REPLY_TO_MODE: { label: '回复方式', help: 'first、all 或 off。' },
    DISCORD_ALLOW_ALL_USERS: {
      label: '允许所有 Discord 用户',
      help: '仅用于开发。为 true 时，任何人都可以私信机器人，不需要允许列表。'
    },
    DISCORD_HOME_CHANNEL: { label: '主页频道 ID', help: '机器人主动发送消息的频道（cron 输出、提醒等）。' },
    DISCORD_HOME_CHANNEL_NAME: { label: '主页频道名称', help: '日志和状态输出中显示的主页频道名称。' },
    BLUEBUBBLES_ALLOW_ALL_USERS: { label: '允许所有 iMessage 用户', help: '为 true 时跳过 BlueBubbles 允许列表。' },
    MATTERMOST_ALLOW_ALL_USERS: { label: '允许所有 Mattermost 用户' },
    MATTERMOST_HOME_CHANNEL: { label: '主页频道' },
    QQ_ALLOW_ALL_USERS: { label: '允许所有 QQ 用户' },
    QQBOT_HOME_CHANNEL: { label: 'QQ 主页频道', help: 'cron 投递的默认频道或群组。' },
    QQBOT_HOME_CHANNEL_NAME: { label: 'QQ 主页频道名称' },
    SLACK_BOT_TOKEN: {
      label: 'Slack 机器人令牌',
      help: '安装 Slack 应用后，在 OAuth & Permissions 中找到机器人令牌。',
      placeholder: '粘贴 Slack 机器人令牌'
    },
    SLACK_APP_TOKEN: {
      label: 'Slack 应用令牌',
      help: 'Socket Mode 需要应用级令牌。',
      placeholder: '粘贴 Slack 应用令牌'
    },
    SLACK_ALLOWED_USERS: { label: '允许的 Slack 用户 ID', help: '推荐。Slack 用户 ID（每格一个）。' },
    MATTERMOST_URL: { label: '服务器 URL', placeholder: 'https://mattermost.example.com' },
    MATTERMOST_TOKEN: { label: '机器人令牌' },
    MATTERMOST_ALLOWED_USERS: { label: '允许的用户 ID', help: '推荐。Mattermost 用户 ID（每格一个）。' },
    MATRIX_HOMESERVER: { label: '主服务器 URL（Homeserver）', placeholder: 'https://matrix.org' },
    MATRIX_ACCESS_TOKEN: { label: '访问令牌' },
    MATRIX_USER_ID: { label: '机器人用户 ID', placeholder: '@hermes:example.org' },
    MATRIX_ALLOWED_USERS: { label: '允许的 Matrix 用户 ID', help: '推荐。@user:server 格式的用户 ID（每格一个）。' },
    SIGNAL_HTTP_URL: {
      label: 'Signal 桥接 URL',
      placeholder: 'http://127.0.0.1:8080',
      help: '运行中的 signal-cli REST 桥接的 URL。'
    },
    SIGNAL_ACCOUNT: { label: '电话号码', help: '在 signal-cli 桥接中注册的号码。' },
    SIGNAL_ALLOWED_USERS: { label: '允许的 Signal 用户', help: '推荐。Signal 标识符（每格一个）。' },
    WHATSAPP_ENABLED: { label: '启用 WhatsApp 桥接', help: '由下方开关自动设置。除非确知需要，否则请勿改动。' },
    WHATSAPP_MODE: { label: '桥接模式' },
    WHATSAPP_ALLOWED_USERS: { label: '允许的 WhatsApp 用户', help: '推荐。电话号码或 WhatsApp ID（每格一个）。' }
  },
  platformIntro: {
    telegram:
      '在 Telegram 中，与 @BotFather 对话，运行 /newbot，复制它给你的令牌。然后从 @userinfobot 获取你的数字用户 ID。',
    discord:
      '打开 Discord 开发者门户，创建应用，添加机器人，然后复制其令牌。用正确的权限范围把机器人邀请到你的服务器。',
    slack: '创建 Slack 应用，启用 Socket Mode，安装到你的工作区，然后复制机器人令牌和应用级令牌。',
    mattermost: '在你的 Mattermost 服务器上，创建机器人账户或个人访问令牌，然后在此粘贴服务器 URL 和令牌。',
    matrix: '用机器人账户登录你的主服务器（homeserver），然后复制访问令牌、用户 ID 和主服务器 URL。',
    signal: '在可访问的位置运行 signal-cli REST 桥接，然后把 Hermes 指向该 URL 和已注册的电话号码。',
    whatsapp: '启动 Hermes 自带的 WhatsApp 桥接，首次运行时扫描二维码，然后启用该平台。',
    bluebubbles: '在装有 iMessage 的 Mac 上运行 BlueBubbles Server，暴露其 API，然后用服务器密码把 Hermes 指向该 URL。',
    homeassistant: '在 Home Assistant 中打开你的个人资料并创建长期访问令牌。把它连同你的 HA URL 一起粘贴到这里。',
    email: '使用专用邮箱。对于 Gmail/Workspace，创建应用专用密码并使用 imap.gmail.com / smtp.gmail.com。',
    sms: '从 Twilio 控制台获取你的 Account SID 和访问令牌，以及一个可发送短信的电话号码。',
    dingtalk: '在开发者控制台创建钉钉应用，然后在此复制 Client ID(App key) 和 Client Secret。',
    feishu: '创建飞书 / Lark 应用，配置机器人能力，复制 App ID、应用密钥和事件加密密钥。',
    wecom: '在企业微信中添加群机器人，复制其 Webhook 密钥作为 WECOM_BOT_ID。仅可发送——双向请用企业微信（应用）选项。',
    wecom_callback: '设置一个企业微信自建应用，暴露其回调 URL，并提供 corp ID、secret、agent ID 和 AES key。',
    weixin:
      '运行 `hermes gateway setup`，选择 Weixin，然后使用个人微信账号扫描并确认二维码。Hermes 会通过腾讯 iLink Bot API 连接并保存凭据。',
    qqbot: '在 QQ 开放平台 (q.qq.com) 注册一个应用，复制 App ID 和 Client Secret。',
    api_server: '把 Hermes 暴露为兼容 OpenAI 的 API。设置一个鉴权密钥，然后把 Open WebUI / LobeChat 等指向 host:port。',
    webhook: '运行一个 HTTP 服务器，供其他工具（GitHub、GitLab、自定义应用）POST。用密钥验证签名。'
  },
  restartAgain: '再次重启',
  openLogs: '打开日志',
  restartFailedManualDetail: '请再次尝试重启；若仍然失败，请打开日志并发送诊断信息。'
} satisfies Translations['messaging']
