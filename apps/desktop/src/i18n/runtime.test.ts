import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fieldCopyForSchemaKey } from '@/app/settings/field-copy'

import { TRANSLATIONS } from './catalog'
import { setRuntimeI18nLocale, translateNow } from './runtime'
import { zh } from './zh'

describe('desktop i18n runtime translator', () => {
  beforeEach(() => {
    setRuntimeI18nLocale('en')
  })

  afterEach(() => {
    setRuntimeI18nLocale('en')
  })

  it('translates string paths for the active runtime locale', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('boot.ready')).toBe('Aino 桌面版已就绪')
    expect(translateNow('boot.errors.gatewayConnectionLostDetail')).toBe(
      '仍在后台重试。你可以继续阅读和撰写草稿；如果问题持续，请打开网关设置。'
    )
    expect(translateNow('notifications.voice.noSpeechDetected')).toBe('没有检测到语音')
    expect(translateNow('composer.lookupNoMatches')).toBe('没有匹配项。')
    expect(translateNow('assistant.tool.statusRecovered')).toBe('已恢复')
  })

  it('localizes gateway timeout and unavailable copy for Simplified Chinese users', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('boot.errors.gatewayRevalidationTimeout')).toBe('重新验证网关连接超时')
    expect(translateNow('boot.errors.gatewayReconnectTimeout')).toBe('重新连接 Aino 后端超时')
    expect(translateNow('boot.errors.gatewayWsRemintTimeout')).toBe('重新生成网关 WebSocket 地址超时')
    expect(translateNow('boot.errors.gatewayFallbackTimeout')).toBe('解析备用网关连接超时')
    expect(translateNow('boot.errors.gatewayWsMintTimeout')).toBe('生成网关 WebSocket 地址超时')
  })

  it('resolves Chinese copy for shared chat, accessibility, and quick entry affordances', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('ui.actions.addContext')).toBe('添加上下文')
    expect(translateNow('ui.actions.filters')).toBe('筛选')
    expect(translateNow('ui.accessibility.showOptions')).toBe('显示选项')
    expect(translateNow('ui.accessibility.openFullView')).toBe('打开完整视图')
    expect(translateNow('ui.accessibility.zoomOut')).toBe('缩小')
    expect(translateNow('ui.accessibility.resetZoom')).toBe('重置缩放')
    expect(translateNow('ui.accessibility.zoomIn')).toBe('放大')
    expect(translateNow('ui.accessibility.generatedImage')).toBe('生成的图片')
    expect(translateNow('assistant.thread.showMessage')).toBe('显示消息')
    expect(translateNow('desktop.quickEntry.currentChat')).toBe('当前对话')
    expect(translateNow('desktop.quickEntry.newSession')).toBe('新建会话')
  })

  it('localizes desktop bridge refusal messages', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('preview.drive.inactiveSession')).toBe('应用内浏览器操作只能在你当前查看的会话中执行。')
    expect(translateNow('preview.tour.disabled')).toBe('你已关闭引导导览。')
    expect(translateNow('preview.tour.inactiveSession')).toBe('引导导览只能在你当前查看的会话中运行。')
  })

  it('passes arguments to function translations', () => {
    expect(translateNow('notifications.updateReadyMessage', 2)).toBe('2 new changes available.')
  })

  it('translates migrated overlap keys for newly supported locales', () => {
    setRuntimeI18nLocale('ja')
    expect(translateNow('common.save')).toBe('保存')

    setRuntimeI18nLocale('zh-hant')
    expect(translateNow('cron.promptPlaceholder')).toBe('代理每次執行時應做什麼？')
  })

  it('translates settings copy for newly supported locales', () => {
    setRuntimeI18nLocale('ja')
    expect(translateNow('settings.appearance.title')).toBe('外観')
    expect(translateNow('settings.nav.providers')).toBe('プロバイダー')

    setRuntimeI18nLocale('zh-hant')
    expect(translateNow('settings.appearance.title')).toBe('外觀')
    expect(translateNow('settings.nav.providerApiKeys')).toBe('API 金鑰')

    setRuntimeI18nLocale('ar')
    expect(translateNow('settings.appearance.reasoningCollapsedTitle')).toBe('طي التفكير افتراضيًا')
    expect(translateNow('settings.appearance.reasoningCollapsedDesc')).toBe(
      'أبقِ التفكير المتدفق متاحًا دون توسيعه حتى تفتحه.'
    )
  })

  it('translates Russian model and Bot Mode labels', () => {
    setRuntimeI18nLocale('ru')

    expect(translateNow('settings.model.moaTitle')).toBe('Смесь агентов')
    expect(translateNow('common.bots')).toBe('Боты')
  })

  it('keeps translated settings field copy addressable from schema keys', () => {
    const field = ['display', 'show_reasoning'].join('.')

    expect(fieldCopyForSchemaKey(zh.settings.fieldLabels, field)).toBe('推理过程块')
    expect(fieldCopyForSchemaKey(zh.settings.fieldDescriptions, field)).toBe('当后端提供推理内容时予以显示。')
  })

  it('exposes Chinese copy for settings and lifecycle flows', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('settings.customEndpoints.emptyTitle')).toBe('暂无自定义端点')
    expect(translateNow('settings.customEndpoints.emptyDescription')).toBe('在下方添加一个 OpenAI 兼容端点。')
    expect(translateNow('settings.providers.descriptions.DeepSeek')).toBe('DeepSeek 直连接口（V3.x、R1）。')
    expect(translateNow('settings.providers.descriptions.AWS Bedrock')).toBe('使用 AWS 配置文件和区域进行认证。')
    expect(translateNow('settings.computerUse.ready')).toBe('已就绪')
    expect(translateNow('settings.uninstall.dangerZone')).toBe('危险区域')
    expect(translateNow('settings.appearance.themeSearchPlaceholder')).toBe(
      zh.settings.appearance.themeSearchPlaceholder
    )
    expect(translateNow('onboarding.runtimeNotReadyTitle')).toBe('运行时未就绪')
    expect(translateNow('updates.desktopBridgeUnavailable')).toBe('桌面桥接不可用。')
    expect(translateNow('updates.starting')).toBe('正在开始更新…')
    expect(translateNow('updates.backendApplied')).toBe('后端更新已应用。')
    expect(translateNow('updates.backendNoReturn')).toBe('后端未恢复在线。')
  })

  it('keeps gateway and provider status copy fully localized', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('settings.connections.localLabel')).toBe('此设备')
    expect(translateNow('rightSidebar.terminalStartFailed', 'PTY 不可用')).toBe('终端启动失败：PTY 不可用')
    expect(translateNow('settings.managedUpdates.scopeNotRestored', '工作', '连接失败')).toBe(
      '工作区“工作”未恢复：连接失败'
    )
    expect(translateNow('settings.providers.removeKeyManaged', 'OpenAI')).toBe(
      'OpenAI 由 API 密钥配置。请从 API 密钥中移除。'
    )
    expect(translateNow('shell.statusbar.connectionRemoteTooltip', 'server.example')).toBe('远程 · server.example')
  })

  it('localizes gateway setup terminology while preserving technical values', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('settings.managedUpdates.scopesRestored', '工作、个人')).toBe('已恢复的工作区：工作、个人')
    expect(translateNow('settings.managedUpdates.progress')).toBe('正在排空会话、更新远端安装并恢复工作区…')
    expect(translateNow('settings.gateway.remoteUrlDesc')).toBe(
      '远程仪表盘后端的基础 URL。支持路径前缀，例如 /hermes。'
    )
    expect(translateNow('settings.gateway.tokenTitle')).toBe('会话令牌')
    expect(translateNow('settings.gateway.tokenDesc')).toBe(
      '用于 REST 和 WebSocket 访问的仪表盘会话令牌。留空则保留已保存的令牌。'
    )
  })

  it('keeps gateway authentication and profile guidance in Simplified Chinese', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('settings.gateway.remoteAuthHint')).toBe(
      '托管网关使用 OAuth 或用户名密码；自托管网关也可能使用会话令牌。'
    )
    expect(translateNow('settings.gateway.plainTextConfirmTitle')).toBe('以明文存储网关令牌？')
    expect(translateNow('settings.gateway.incompleteToken')).toBe('切换到远程前，请输入远程 URL 和会话令牌。')
    expect(translateNow('settings.gateway.restartingMessage')).toBe(
      'Aino 桌面端将使用已保存设置重新连接（界面保持打开）。'
    )
    expect(translateNow('settings.gateway.sshErrUpdateRequired')).toBe(
      '使用桌面端 SSH 连接前，请更新远程主机上的 Aino。'
    )
    expect(translateNow('settings.profileScope.editsProfile', '工作')).toBe('此页面的更改将应用于工作区“工作”。')
  })

  it('localizes high-frequency English terminology in Simplified Chinese copy', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('sendDiagnostics.privacyNotice')).toContain('智能体、网关和桌面端日志')
    expect(translateNow('settings.plugins.installModal.insecureWarning')).toBe(
      '此 URL 使用了不安全的本地协议。生产环境请优先使用 https:// 或 git@。'
    )
    expect(translateNow('settings.appearance.themeProfileNote', '工作')).toBe(
      '已为工作区「工作」保存主题——每个工作区保留各自的主题。'
    )
    expect(translateNow('settings.about.bundleOutOfSyncDesc')).toContain('机器人模式')
    expect(translateNow('settings.managedUpdates.intro')).toContain('每个工作区')
    expect(translateNow('settings.mcp.reloadedMessage')).toBe('新的工具结构定义将在后续回合生效。')
    expect(translateNow('settings.sessions.defaultDirDesc')).toBe(
      '新会话默认从此文件夹开始，除非你选择其他目录。留空则使用你的主目录。'
    )
    expect(translateNow('cron.customPlaceholder')).toBe('0 9 * * * 或工作日 9:00')
    expect(translateNow('composer.githubSuggestions.doneTip')).toBe('发送消息后，智能体将引导你完成 GitHub 登录')
    expect(translateNow('desktop.emptySlashCommand')).toBe('空斜杠命令')
    expect(translateNow('desktop.slashInvalidResponse')).toBe('command.dispatch 返回无效响应')
    expect(translateNow('prompts.sudoDesc')).toBe(
      '输入 sudo 密码前，请先检查命令。密码会发送给执行命令的智能体，并在本次会话中缓存。'
    )
    expect(translateNow('install.fetchingManifest')).toBe('正在获取安装器清单…')
  })

  it('uses consistent Chinese agent, profile, and slash-command terminology', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('agents.close')).toBe('关闭智能体')
    expect(translateNow('agents.subtitle')).toBe('当前回合的子智能体实时活动。')
    expect(translateNow('agents.emptyTitle')).toBe('暂无活跃子智能体')
    expect(translateNow('agents.emptyDesc')).toBe('当某个回合派发任务时，子智能体会在此实时显示进度。')
    expect(translateNow('agents.agentsCount', 2)).toBe('2 个智能体')
    expect(translateNow('statusStack.agents')).toBe('智能体')
    expect(translateNow('statusStack.subagents', 2)).toBe('2 个子智能体')
    expect(translateNow('shell.statusbar.agents')).toBe('智能体')
    expect(translateNow('shell.statusbar.closeAgents')).toBe('关闭智能体')
    expect(translateNow('shell.statusbar.openAgents')).toBe('打开智能体')
    expect(translateNow('shell.statusbar.subagents', 2)).toBe('2 个子智能体')
    expect(translateNow('shell.statusbar.contextUsagePanel.categories.subagent_definitions')).toBe('子智能体定义')
    expect(translateNow('desktop.activity.agentTaskRunning')).toBe('智能体任务运行中')
    expect(translateNow('boot.failure.cloudDownTitle')).toBe('Nous Cloud 智能体不可用')
    expect(translateNow('boot.failure.cloudDownDescription')).toBe(
      '此网关连接的 Nous 托管云端智能体返回了服务器错误。无法从此处重启——请检查其状态、切换到本地网关或获取支持。'
    )
    expect(translateNow('settings.toolsets.browserRealProfile.description')).toContain('智能体使用该快照')
    expect(translateNow('preview.web.remoteLoopback')).toContain('运行智能体的那台机器')
    expect(translateNow('composer.commandDescs./whoami')).toBe('显示当前斜杠命令权限（管理员/用户）')
    expect(translateNow('desktop.slashUnavailable.advanced', '/debug')).toBe(
      '/debug 未在桌面斜杠命令面板中显示。请使用相应的桌面控件或终端界面。'
    )
    expect(translateNow('desktop.slashUnavailable.modelPicker', '/model')).toBe(
      '/model 使用桌面模型选择器，而不是斜杠命令。'
    )
    expect(translateNow('desktop.slashUnavailable.sessionPicker', '/resume')).toBe(
      '/resume 使用桌面会话选择器，而不是斜杠命令。'
    )
    expect(translateNow('tips.items.profiles.title')).toBe('工作区彼此独立')
  })

  it('localizes the built-in indicator command description', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('composer.commandDescs./indicator')).toBe('选择终端忙碌指示器样式')
  })

  it('localizes messaging setup terminology while preserving technical values', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('notifications.errors.elevenLabsRejectedKey')).toBe('ElevenLabs 拒绝了该 API 密钥 (401)。')
    expect(translateNow('notifications.errors.openaiRejectedApiKey')).toBe('OpenAI 拒绝了该 API 密钥。')
    expect(translateNow('notifications.errors.openaiRejectedApiKeyWithStatus', '401')).toBe(
      'OpenAI 拒绝了该 API 密钥 (401 invalid_api_key)。'
    )
    expect(translateNow('install.failedDesc')).toContain('桌面端日志')
    expect(translateNow('messaging.fieldCopy.TELEGRAM_BOT_TOKEN.label')).toBe('机器人令牌')
    expect(translateNow('messaging.fieldCopy.TELEGRAM_BOT_TOKEN.placeholder')).toBe('粘贴 Telegram 机器人令牌')
    expect(translateNow('messaging.fieldCopy.DISCORD_ALLOW_ALL_USERS.help')).toBe(
      '仅用于开发。为 true 时，任何人都可以私信机器人，不需要允许列表。'
    )
    expect(translateNow('messaging.fieldCopy.DISCORD_HOME_CHANNEL.help')).toBe(
      '机器人主动发送消息的频道（cron 输出、提醒等）。'
    )
    expect(translateNow('messaging.fieldCopy.SLACK_BOT_TOKEN.help')).toBe(
      '安装 Slack 应用后，在 OAuth & Permissions 中找到机器人令牌。'
    )
    expect(translateNow('messaging.fieldCopy.SLACK_APP_TOKEN.help')).toBe('Socket Mode 需要应用级令牌。')
    expect(translateNow('messaging.fieldCopy.MATRIX_USER_ID.label')).toBe('机器人用户 ID')
    expect(translateNow('messaging.platformIntro.discord')).toContain('添加机器人')
    expect(translateNow('messaging.platformIntro.slack')).toContain('机器人令牌和应用级令牌')
    expect(translateNow('messaging.platformIntro.matrix')).toContain('主服务器（homeserver）')
  })

  it('localizes artifact indexing and preview failure copy', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('artifacts.partialLoadMessage', 2, 5)).toBe('索引产物时跳过了最近 5 个会话中的 2 个。')
    expect(translateNow('artifacts.safeLoadFailure', 2)).toBe('其中 2 个会话超过了安全加载上限。')
    expect(translateNow('artifacts.unreadableFailure', 1)).toBe('其中 1 个会话无法读取。')
    expect(translateNow('preview.artifactWriteFailed')).toBe('无法写入产物文件。')
    expect(translateNow('preview.invalidPdfDataUrl')).toBe('PDF 数据地址无效。')
    expect(translateNow('preview.invalidPdfDataUrlType')).toBe('PDF 数据地址类型无效。')
    expect(translateNow('preview.invalidPdfDataUrlPayload')).toBe('PDF 数据地址内容无效。')
    expect(translateNow('preview.invalidPdfFileHeader')).toBe('PDF 文件头无效。')
    expect(translateNow('preview.pdfObjectUrlUnsupported')).toBe('当前环境不支持 PDF 对象地址。')
    expect(translateNow('preview.webviewNotReady')).toBe('预览页面尚未准备好，请稍后重试。')
    expect(translateNow('preview.webviewInputUnavailable')).toBe('预览页面暂不支持输入操作。')
  })

  it('uses the Chinese token term consistently in usage surfaces', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('settings.mcp.costTokens', 123)).toBe('每次调用约 123 个词元')
    expect(translateNow('composer.commandDescs./status')).toBe('显示会话、模型、词元和上下文信息')
    expect(translateNow('composer.commandDescs./usage')).toBe(
      '显示词元用量和速率限制；使用 reset 兑换已存储的 Codex 限额重置'
    )
    expect(translateNow('modelPicker.priceTitle')).toBe('每百万词元的输入/输出价格')
    expect(translateNow('shell.statusbar.contextUsagePanel.tokenSummary', 12, 100)).toBe('12 / 100 个词元')
    expect(translateNow('ui.actions.labels.tokens')).toBe('词元数')
  })

  it('uses the same 工作区 term for profile navigation and status copy', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('keybinds.categories.profiles')).toBe('工作区')

    const keybindActions = TRANSLATIONS.zh.keybinds.actions

    expect(keybindActions['nav.profiles']).toBe('打开工作区')
    expect(keybindActions['profile.default']).toBe('切换到默认工作区')
    expect(keybindActions['profile.switch.3']).toBe('切换到工作区 3')
    expect(keybindActions['profile.next']).toBe('下一个工作区')
    expect(keybindActions['profile.toggleAll']).toBe('切换全部工作区视图')
    expect(keybindActions['profile.create']).toBe('创建工作区')
    expect(translateNow('commandCenter.contributedActions.exportProfile')).toBe('导出工作区…')
    expect(translateNow('commandCenter.contributedActions.importProfile')).toBe('导入工作区…')
    expect(translateNow('sidebar.row.ownedByProfile', '工作')).toBe('工作区：工作')
  })

  it('translates clear Chinese equivalents while keeping configuration identifiers', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('settings.plugins.installModal.desktopLabel')).toBe('桌面界面')
    expect(translateNow('settings.fieldDescriptions.fallbackProviders')).toBe(
      '默认模型失败时尝试的备用“提供方:模型”条目。'
    )
    expect(translateNow('composer.snippets.implementationPlan.description')).toBe(
      '在动代码之前先勾勒方案，让代码差异保持聚焦。'
    )
    expect(translateNow('messaging.platformIntro.sms')).toContain('Account SID 和访问令牌')
    expect(translateNow('messaging.platformIntro.feishu')).toContain('App ID、应用密钥')
    expect(translateNow('messaging.platformIntro.wecom')).toContain('Webhook 密钥')
    expect(translateNow('messaging.platformIntro.webhook')).toBe(
      '运行一个 HTTP 服务器，供其他工具（GitHub、GitLab、自定义应用）POST。用密钥验证签名。'
    )
    expect(translateNow('messaging.platformIntro.email')).toBe(
      '使用专用邮箱。对于 Gmail/Workspace，创建应用专用密码并使用 imap.gmail.com / smtp.gmail.com。'
    )
  })

  it('describes the embedded skills-hub action in Simplified Chinese', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('skills.hub.pickerHint')).toBe(
      '点击任意技能卡片上的“添加到此智能体”按钮即可安装，安装后会出现在上方列表中。'
    )
  })

  it('falls back to English when the active locale cannot resolve a key', () => {
    const boot = TRANSLATIONS.ja.boot as { ready?: string }
    const originalReady = boot.ready

    try {
      boot.ready = undefined
      setRuntimeI18nLocale('ja')

      expect(translateNow('boot.ready')).toBe('Aino is ready')
    } finally {
      boot.ready = originalReady
    }
  })

  it('returns the key when no locale can resolve a path', () => {
    setRuntimeI18nLocale('zh')

    expect(translateNow('missing.path')).toBe('missing.path')
  })
})
