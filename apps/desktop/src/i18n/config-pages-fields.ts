import type { BundledLocale } from './types'
import type { ConfigPageFieldCopy } from './types_config_pages'

export const fieldOverrides: Record<BundledLocale, Partial<Record<string, Partial<ConfigPageFieldCopy>>>> = {
  en: {
    'display.personality': {
      label: 'Reply style',
      description: 'Choose the default assistant style for new conversations.',
      help: 'Existing conversations keep their current prompt until their normal refresh or next session.'
    },
    timezone: {
      label: 'Time zone',
      description: 'Use this time zone for date and time context.',
      help: 'Leave empty to use the system time zone.'
    },
    'display.show_reasoning': {
      label: 'Show model reasoning',
      description: 'Display reasoning content when the model provides it.',
      help: 'This affects display, not the model’s reasoning effort.'
    },
    'agent.image_input_mode': {
      label: 'Image delivery',
      description: 'Choose how image attachments reach the model.'
    },
    'approvals.mode': {
      label: 'Approval behavior',
      description: 'Choose when Aino asks before operations requiring approval.'
    },
    'approvals.timeout': {
      label: 'Approval wait time',
      description: 'Wait this long for an approval before the runtime handles the unanswered request.',
      unit: 'seconds'
    },
    'approvals.mcp_reload_confirm': {
      label: 'Confirm MCP reloads',
      description: 'Ask before reloading MCP tool configuration.',
      help: 'Reloading tools may rebuild conversation context and affect prompt caching.'
    },
    command_allowlist: {
      label: 'Commands that need no repeated confirmation',
      description: 'Trusted command rules matched by the existing approval system.',
      help: 'Enter one rule per line. Add only commands you trust.'
    },
    'security.redact_secrets': {
      label: 'Hide sensitive information',
      description: 'Mask recognized secrets in supported tool output and logs.',
      help: 'Restart the runtime after changing this policy. Saved vault secrets remain protected.'
    },
    'security.allow_private_urls': {
      label: 'Allow local and private network addresses',
      description: 'Permit supported web tools to reach localhost, LAN and other private addresses.',
      help: 'Cloud metadata endpoints remain blocked. Browser routing is configured on the Browser page.'
    },
    'checkpoints.enabled': {
      label: 'Keep file snapshots',
      description: 'Keep recovery points before supported file edits.',
      help: 'Applies when a new agent starts. Snapshots do not replace version control.'
    },
    'browser.use_real_profile': {
      label: 'Use this computer’s browser identity',
      description: 'Use a managed copy of your default browser’s cookies and sign-ins.',
      help: 'Uses a copied snapshot, not your live profile. Requires a supported Chromium browser on the runtime computer; existing browser sessions keep their current identity.'
    },
    'browser.allow_private_urls': {
      label: 'Allow private websites',
      description: 'Permit non-local browser backends to reach local and private network URLs.',
      help: 'Local browser sessions already have local network access. Cloud metadata endpoints remain blocked.'
    },
    'browser.auto_local_for_private_urls': {
      label: 'Use a local browser for private URLs',
      description: 'When a cloud browser encounters a private URL, try the existing local browser sidecar.',
      help: 'The sidecar does not inherit the real-profile sign-in snapshot. Existing access checks still apply.'
    },
    'memory.memory_enabled': {
      label: 'Remember useful information',
      description: 'Allow built-in memory to keep information useful in future conversations.'
    },
    'memory.user_profile_enabled': {
      label: 'Remember your preferences',
      description: 'Maintain a concise profile of your preferences and personal context.'
    },
    'memory.memory_char_limit': {
      label: 'Memory content limit',
      description: 'Maximum text stored in built-in memory.',
      unit: 'characters'
    },
    'memory.user_char_limit': {
      label: 'User profile limit',
      description: 'Maximum text stored in the built-in user profile.',
      unit: 'characters'
    },
    'memory.provider': {
      label: 'External memory provider',
      description: 'Connect an installed memory service in addition to built-in memory.',
      help: 'Options are supplied by installed plugins; built-in and external memory can coexist.'
    },
    'context.engine': {
      label: 'Context engine',
      description: 'Choose the installed strategy for managing long conversations.'
    },
    'compression.enabled': {
      label: 'Organize long conversations automatically',
      description: 'Compress older context when a conversation approaches its capacity.'
    },
    'compression.threshold': {
      label: 'Start organizing at',
      description: 'Trigger compression when context usage reaches this share of capacity.',
      unit: 'percent'
    },
    'compression.target_ratio': {
      label: 'Target size after organizing',
      description: 'Aim to reduce context to this share of capacity.',
      unit: 'percent'
    },
    'compression.protect_last_n': {
      label: 'Keep recent messages',
      description: 'Keep this many recent messages outside older-context compression.',
      unit: 'messages'
    },
    'compression.codex_gpt55_autoraise': {
      label: 'Adjust supported Codex thresholds',
      description: 'For supported ChatGPT Codex OAuth models, automatically raise the trigger threshold to 85%.'
    },
    'auxiliary.compression.timeout': {
      label: 'Context organization timeout',
      description: 'Maximum wait for one call to the auxiliary compression model.',
      unit: 'seconds'
    },
    'voice.voice_chat_mode': {
      label: 'Voice conversation engine',
      description: 'Choose the engine used when the next voice conversation starts.',
      help: 'A conversation already in progress keeps its current engine.'
    },
    'voice.gpt_live.voice': {
      label: 'Real-time voice',
      description: 'Choose or enter a voice supported by the real-time voice service.'
    },
    'voice.gpt_live.instructions': {
      label: 'Real-time voice instructions',
      description: 'Add tone, pace or language preferences for the voice layer.',
      help: 'Aino retains its own system instructions and task model.'
    },
    'voice.max_recording_seconds': {
      label: 'Recording duration limit',
      description: 'End one recording when this duration is reached.',
      unit: 'seconds'
    },
    'voice.client_direct': {
      label: 'Connect to voice services from desktop',
      description: 'Let the desktop connect directly where the current voice path supports it.',
      help: 'Existing credentials and routing apply; cached configuration refreshes within about 60 seconds.'
    },
    'stt.enabled': {
      label: 'Enable speech recognition',
      description: 'Turn recordings into text for supported conversation and messaging paths.'
    },
    'stt.echo_transcripts': {
      label: 'Show transcripts in messaging platforms',
      description: 'Echo recognized voice-message text in supported messaging platforms.',
      help: 'This does not control text shown in the desktop composer.'
    },
    'stt.provider': {
      label: 'Speech recognition provider',
      description: 'Choose the service used to convert speech to text.'
    },
    'stt.streaming': {
      label: 'Streaming recognition',
      description: 'Show recognition results while speaking when the provider and voice mode support it.'
    },
    'voice.auto_tts': {
      label: 'Automatic speech in messaging and CLI',
      description: 'Automatically speak replies in supported messaging platforms and the CLI.',
      help: 'Desktop Read replies is a separate preference in the composer menu.'
    },
    'tts.provider': {
      label: 'Speech provider',
      description: 'Choose the service used to generate spoken audio.',
      help: 'Provider, model and voice names stay unchanged; custom values remain supported.'
    },
    'agent.max_turns': {
      label: 'Maximum turns per task',
      description: 'Limit model and tool round trips in one run.',
      unit: 'turns'
    },
    'agent.api_max_retries': {
      label: 'API retry limit',
      description: 'Retry eligible failed requests using the existing retry rules.',
      unit: 'retries'
    },
    'agent.service_tier': {
      label: 'Fast mode',
      description: 'Use the request speed policy supported by the current provider and model.',
      help: 'Supported values depend on the runtime. Keep provider-specific values unchanged.'
    },
    toolsets: {
      label: 'Tools Aino can use',
      description: 'Select the existing toolsets available to this profile.',
      help: 'Clearing every toolset still requires confirmation.'
    },
    'agent.tool_use_enforcement': {
      label: 'Tool-use policy',
      description: 'Configure the existing model tool-call enforcement strategy.',
      help: 'Supported values come from the runtime; this is not a system sandbox.'
    },
    'terminal.backend': {
      label: 'Command environment',
      description: 'Choose where tool commands actually run.'
    },
    'terminal.timeout': {
      label: 'Command timeout',
      description: 'Maximum wait for a single terminal tool command.',
      unit: 'seconds'
    },
    'terminal.docker_image': {
      label: 'Docker image',
      description: 'Image used when the Docker execution backend is selected.'
    },
    'terminal.singularity_image': {
      label: 'Singularity image',
      description: 'Image used when the Singularity execution backend is selected.'
    },
    'terminal.modal_image': {
      label: 'Modal image',
      description: 'Image used when the Modal execution backend is selected.'
    },
    'terminal.daytona_image': {
      label: 'Daytona image',
      description: 'Image used when the Daytona execution backend is selected.'
    },
    'tool_output.max_bytes': {
      label: 'Output size limit',
      description: 'Maximum bytes retained by the existing tool-output processing path.',
      unit: 'bytes'
    },
    'tool_output.max_lines': {
      label: 'File page length',
      description: 'Line limit used for file-reading pagination.',
      help: 'This is not a total line cap for every tool response.',
      unit: 'lines'
    },
    'tool_output.max_line_length': {
      label: 'Single-line length limit',
      description: 'Maximum length of one retained output line.',
      unit: 'characters'
    },
    'checkpoints.max_snapshots': {
      label: 'Snapshot retention count',
      description: 'Maximum file snapshots kept by the existing checkpoint mechanism.',
      help: 'Used only when file snapshots are enabled on the Safety page.',
      unit: 'snapshots'
    },
    'updates.non_interactive_local_changes': {
      label: 'Local changes during unattended updates',
      description: 'Choose how non-interactive source updates handle uncommitted local edits.',
      help: 'Discard can permanently remove local edits; interactive terminal updates keep their existing prompt.'
    },
    'local.attachmentSize': {
      label: 'Local attachment size limit',
      description: 'Limit attachment handling on this desktop.',
      unit: 'megabytes'
    },
    'local.maxBackends': {
      label: 'Warm idle profile connections',
      description:
        'Limit prewarmed idle connections to secondary profiles. Active connections and manually opened profiles are not blocked.',
      unit: 'connections'
    },
    'local.idleMs': {
      label: 'Idle connection retention',
      description: 'Disconnect idle viewers after this time without stopping backend processes or running tasks.',
      unit: 'minutes'
    },
    'tts.edge.voice': {
      label: 'Microsoft Edge · Voice',
      description: 'Use a value supported by Microsoft Edge. Custom model and voice identifiers remain unchanged.'
    },
    'tts.openai.model': {
      label: 'OpenAI · Speech model',
      description: 'Use a value supported by OpenAI. Custom model and voice identifiers remain unchanged.'
    },
    'tts.openai.voice': {
      label: 'OpenAI · Voice',
      description: 'Use a value supported by OpenAI. Custom model and voice identifiers remain unchanged.'
    },
    'tts.elevenlabs.voice_id': {
      label: 'ElevenLabs · Voice ID',
      description: 'Use a value supported by ElevenLabs. Custom model and voice identifiers remain unchanged.'
    },
    'tts.elevenlabs.model_id': {
      label: 'ElevenLabs · Model ID',
      description: 'Use a value supported by ElevenLabs. Custom model and voice identifiers remain unchanged.'
    },
    'tts.xai.voice_id': {
      label: 'xAI · Voice ID',
      description: 'Use a value supported by xAI. Custom model and voice identifiers remain unchanged.'
    },
    'tts.xai.language': {
      label: 'xAI · Speech language',
      description: 'Use a value supported by xAI. Custom model and voice identifiers remain unchanged.'
    },
    'tts.xai.speed': {
      label: 'xAI · Speaking speed',
      description: 'Playback speed: 1 is normal speed; smaller is slower and larger is faster.',
      unit: 'multiplier'
    },
    'tts.xai.auto_speech_tags': {
      label: 'xAI · Expressive audio tags',
      description: 'Allow the model to add expressive tags such as laughter before speech synthesis.'
    },
    'tts.xai.optimize_streaming_latency': {
      label: 'xAI · Streaming latency optimization',
      description: 'Balance latency and quality: 0 favors quality; 2 favors lower latency.'
    },
    'tts.xai.sample_rate': {
      label: 'xAI · Sample rate',
      description: 'Use a value supported by xAI. Custom model and voice identifiers remain unchanged.',
      unit: 'hertz'
    },
    'tts.xai.bit_rate': {
      label: 'xAI · Bit rate',
      description: 'Audio bit rate in bits per second; applies to MP3 output.',
      unit: 'bitsPerSecond'
    },
    'tts.minimax.model': {
      label: 'MiniMax · Speech model',
      description: 'Use a value supported by MiniMax. Custom model and voice identifiers remain unchanged.'
    },
    'tts.minimax.voice_id': {
      label: 'MiniMax · Voice ID',
      description: 'Use a value supported by MiniMax. Custom model and voice identifiers remain unchanged.'
    },
    'tts.mistral.model': {
      label: 'Mistral · Speech model',
      description: 'Use a value supported by Mistral. Custom model and voice identifiers remain unchanged.'
    },
    'tts.mistral.voice_id': {
      label: 'Mistral · Voice ID',
      description: 'Use a value supported by Mistral. Custom model and voice identifiers remain unchanged.'
    },
    'tts.gemini.model': {
      label: 'Gemini · Speech model',
      description: 'Use a value supported by Gemini. Custom model and voice identifiers remain unchanged.'
    },
    'tts.gemini.voice': {
      label: 'Gemini · Voice',
      description: 'Use a value supported by Gemini. Custom model and voice identifiers remain unchanged.'
    },
    'tts.neutts.model': {
      label: 'NeuTTS · Speech model',
      description: 'Use a value supported by NeuTTS. Custom model and voice identifiers remain unchanged.'
    },
    'tts.neutts.device': {
      label: 'NeuTTS · Execution device',
      description: 'Use a value supported by NeuTTS. Custom model and voice identifiers remain unchanged.'
    },
    'tts.kittentts.model': {
      label: 'KittenTTS · Speech model',
      description: 'Use a value supported by KittenTTS. Custom model and voice identifiers remain unchanged.'
    },
    'tts.kittentts.voice': {
      label: 'KittenTTS · Voice',
      description: 'Use a value supported by KittenTTS. Custom model and voice identifiers remain unchanged.'
    },
    'tts.piper.voice': {
      label: 'Piper · Voice',
      description: 'Use a value supported by Piper. Custom model and voice identifiers remain unchanged.'
    },
    'tts.deepinfra.model': {
      label: 'DeepInfra · Speech model',
      description: 'Use a value supported by DeepInfra. Custom model and voice identifiers remain unchanged.'
    },
    'tts.deepinfra.voice': {
      label: 'DeepInfra · Voice',
      description: 'Use a value supported by DeepInfra. Custom model and voice identifiers remain unchanged.'
    },
    'stt.local.model': {
      label: 'Local · Recognition model',
      description: 'Use a value supported by Local. Custom model and voice identifiers remain unchanged.'
    },
    'stt.local.language': {
      label: 'Local · Recognition language',
      description: 'Use a value supported by Local. Custom model and voice identifiers remain unchanged.'
    },
    'stt.openai.model': {
      label: 'OpenAI · Recognition model',
      description: 'Use a value supported by OpenAI. Custom model and voice identifiers remain unchanged.'
    },
    'stt.openai.streaming_model': {
      label: 'OpenAI · Streaming recognition model',
      description: 'Use a value supported by OpenAI. Custom model and voice identifiers remain unchanged.'
    },
    'stt.groq.model': {
      label: 'Groq · Recognition model',
      description: 'Use a value supported by Groq. Custom model and voice identifiers remain unchanged.'
    },
    'stt.mistral.model': {
      label: 'Mistral · Recognition model',
      description: 'Use a value supported by Mistral. Custom model and voice identifiers remain unchanged.'
    },
    'stt.xai.model': {
      label: 'xAI · Recognition model',
      description: 'Use a value supported by xAI. Custom model and voice identifiers remain unchanged.'
    },
    'stt.deepinfra.model': {
      label: 'DeepInfra · Recognition model',
      description: 'Use a value supported by DeepInfra. Custom model and voice identifiers remain unchanged.'
    },
    'stt.elevenlabs.model_id': {
      label: 'ElevenLabs · Model ID',
      description: 'Use a value supported by ElevenLabs. Custom model and voice identifiers remain unchanged.'
    },
    'stt.elevenlabs.language_code': {
      label: 'ElevenLabs · Language code',
      description: 'Use a value supported by ElevenLabs. Custom model and voice identifiers remain unchanged.'
    },
    'stt.elevenlabs.tag_audio_events': {
      label: 'ElevenLabs · Mark audio events',
      description: 'Include recognized non-speech audio events in transcripts.'
    },
    'stt.elevenlabs.diarize': {
      label: 'ElevenLabs · Identify speakers',
      description: 'Label different speakers when supported by the recognition service.'
    }
  },
  zh: {
    'display.personality': {
      label: '回答风格',
      description: '选择新会话默认使用的回答风格。',
      help: '现有会话仍沿用原有提示词更新与新会话生效规则。'
    },
    timezone: {
      label: '时区',
      description: '用于日期、提醒与时间相关的表达。',
      help: '留空时使用系统时区。'
    },
    'display.show_reasoning': {
      label: '显示模型思考',
      description: '在回复中显示模型提供的思考内容。',
      help: '仅控制内容展示，不改变模型的推理强度。'
    },
    'agent.image_input_mode': {
      label: '发送图片的方式',
      description: '决定图片以什么形式交给模型。'
    },
    'approvals.mode': {
      label: '批准方式',
      description: '选择执行需要审批的操作前，如何征求你的同意。'
    },
    'approvals.timeout': {
      label: '等待批准的时间',
      description: '超过等待时间后，按现有运行时规则处理未批准的操作。',
      unit: 'seconds'
    },
    'approvals.mcp_reload_confirm': {
      label: '重载 MCP 前确认',
      description: 'MCP 工具配置重新加载前，先请求你的确认。',
      help: '重载工具可能重建会话上下文，影响提示词缓存。'
    },
    command_allowlist: {
      label: '无需重复确认的命令',
      description: '按现有审批匹配规则信任的命令列表。',
      help: '每行一条规则，请只添加你确认可信的命令。'
    },
    'security.redact_secrets': {
      label: '隐藏敏感信息',
      description: '对现有流程识别到的密钥等敏感内容进行脱敏。',
      help: '修改后需重启运行服务。已登记的密码库秘密仍受保护。'
    },
    'security.allow_private_urls': {
      label: '允许访问本地与私有网络地址',
      description: '允许相关网络工具访问 localhost、局域网或其他私有地址。',
      help: '云服务元数据地址仍禁止访问。浏览器路由方式可在“浏览器”中设置。'
    },
    'checkpoints.enabled': {
      label: '启用文件快照',
      description: '在支持的文件修改操作前保留可恢复的快照。',
      help: '新建智能体运行环境时生效；文件快照不能替代项目版本控制。'
    },
    'browser.use_real_profile': {
      label: '使用本机浏览器身份',
      description: '复用默认浏览器 Cookie、登录状态与偏好设置的受管理快照。',
      help: '使用复制的快照，不直接打开正在使用的配置。运行服务所在电脑需安装支持的 Chromium 浏览器；已有浏览器会话保留原身份。'
    },
    'browser.allow_private_urls': {
      label: '允许浏览器访问本地与私有网址',
      description: '允许非本地浏览器后端访问本机服务、局域网及其他私有网址。',
      help: '本地浏览器会话本身可访问本地网络；云服务元数据地址仍禁止访问。'
    },
    'browser.auto_local_for_private_urls': {
      label: '私有网址自动使用本地浏览器',
      description: '云浏览器遇到私有地址时，尝试使用现有本地浏览器 sidecar。',
      help: '本地 sidecar 不自动带入真实浏览器登录快照，仍遵循原有访问检查。'
    },
    'memory.memory_enabled': {
      label: '记住重要信息',
      description: '允许内置记忆保存有助于后续会话的重要信息。'
    },
    'memory.user_profile_enabled': {
      label: '记住你的偏好',
      description: '允许保存与你有关的偏好和精简用户资料。'
    },
    'memory.memory_char_limit': {
      label: '记忆内容上限',
      description: '限制内置记忆可保存的文字量。',
      unit: 'characters'
    },
    'memory.user_char_limit': {
      label: '用户资料上限',
      description: '限制内置用户资料可保存的文字量。',
      unit: 'characters'
    },
    'memory.provider': {
      label: '外部记忆提供方',
      description: '在内置记忆以外连接已安装的外部记忆服务。',
      help: '选项由已安装插件提供；外部记忆与内置记忆可以同时使用。'
    },
    'context.engine': {
      label: '上下文处理引擎',
      description: '使用已安装的上下文引擎整理长对话。'
    },
    'compression.enabled': {
      label: '自动整理长对话',
      description: '对话接近容量限制时压缩较早内容，为后续对话保留空间。'
    },
    'compression.threshold': {
      label: '何时开始整理',
      description: '上下文使用量达到这个比例时开始压缩。',
      unit: 'percent'
    },
    'compression.target_ratio': {
      label: '整理后的目标占比',
      description: '尽量将压缩后的上下文控制在容量的这个比例。',
      unit: 'percent'
    },
    'compression.protect_last_n': {
      label: '保留最近的消息',
      description: '最近这些消息尽量保留原文，不参与较早内容的压缩。',
      unit: 'messages'
    },
    'compression.codex_gpt55_autoraise': {
      label: 'Codex OAuth 自动调整阈值',
      description: '仅对受支持的 ChatGPT Codex OAuth 模型，将压缩触发阈值自动提高到 85%。'
    },
    'auxiliary.compression.timeout': {
      label: '整理等待时间',
      description: '限制辅助模型执行一次上下文整理的等待时长。',
      unit: 'seconds'
    },
    'voice.voice_chat_mode': {
      label: '语音引擎',
      description: '选择开始下一次语音对话时使用的引擎。',
      help: '进行中的语音对话仍使用原先引擎。'
    },
    'voice.gpt_live.voice': {
      label: '实时对话音色',
      description: '选择或填写实时语音服务支持的音色名称。'
    },
    'voice.gpt_live.instructions': {
      label: '实时对话说明',
      description: '为实时语音引擎补充语气、语速或交流语言偏好。',
      help: 'Aino 仍保留自己的系统提示词与任务模型。'
    },
    'voice.max_recording_seconds': {
      label: '单次录音时长上限',
      description: '达到上限后，按现有录音流程结束当前录音。',
      unit: 'seconds'
    },
    'voice.client_direct': {
      label: '桌面直接处理语音',
      description: '在现有支持范围内，让桌面端直接连接语音服务。',
      help: '沿用现有凭据与连接规则；配置缓存最多约 60 秒刷新。'
    },
    'stt.enabled': {
      label: '启用语音转文字',
      description: '将录音识别为文字，供现有对话与消息平台流程使用。'
    },
    'stt.echo_transcripts': {
      label: '消息平台显示识别文字',
      description: '在消息平台回显语音消息的识别结果。',
      help: '不控制桌面输入框是否显示识别文字。'
    },
    'stt.provider': {
      label: '识别提供方',
      description: '选择将语音转换为文字的服务。'
    },
    'stt.streaming': {
      label: '流式识别',
      description: '在所选提供方与当前语音模式支持时，边说边生成识别结果。'
    },
    'voice.auto_tts': {
      label: '消息平台与命令行自动语音回复',
      description: '控制消息平台与 CLI 的自动语音回复。',
      help: '桌面“朗读回复”由输入区菜单的本机偏好单独控制。'
    },
    'tts.provider': {
      label: '语音提供方',
      description: '选择生成语音使用的服务。',
      help: '提供方、模型与音色名称保持原样，仍支持填写自定义值。'
    },
    'agent.max_turns': {
      label: '单次任务最多轮次',
      description: '限制一次任务中模型与工具往返的最大轮次。',
      unit: 'turns'
    },
    'agent.api_max_retries': {
      label: '接口失败重试次数',
      description: '请求失败时，按现有重试规则再次尝试。',
      unit: 'retries'
    },
    'agent.service_tier': {
      label: '快速模式',
      description: '沿用当前服务与模型支持的快速请求规则。',
      help: '支持值由当前运行时决定，保留提供方原有选项。'
    },
    toolsets: {
      label: '允许使用的工具集',
      description: '选择当前工作区允许 Aino 使用的现有工具集。',
      help: '清空全部工具集仍需再次确认。'
    },
    'agent.tool_use_enforcement': {
      label: '工具使用约束',
      description: '配置当前模型调用工具时使用的现有约束策略。',
      help: '可用值以运行时为准；此项不是系统级沙箱。'
    },
    'terminal.backend': {
      label: '命令运行环境',
      description: '选择工具命令实际在哪种已有执行环境中运行。'
    },
    'terminal.timeout': {
      label: '命令超时时间',
      description: '限制单个终端工具命令的等待时长。',
      unit: 'seconds'
    },
    'terminal.docker_image': {
      label: 'Docker 镜像',
      description: '使用 Docker 执行后端时采用的镜像。'
    },
    'terminal.singularity_image': {
      label: 'Singularity 镜像',
      description: '使用 Singularity 执行后端时采用的镜像。'
    },
    'terminal.modal_image': {
      label: 'Modal 镜像',
      description: '使用 Modal 执行后端时采用的镜像。'
    },
    'terminal.daytona_image': {
      label: 'Daytona 镜像',
      description: '使用 Daytona 执行后端时采用的镜像。'
    },
    'tool_output.max_bytes': {
      label: '输出总大小上限',
      description: '限制现有工具输出处理保留的最大字节数。',
      unit: 'bytes'
    },
    'tool_output.max_lines': {
      label: '文件读取分页行数',
      description: '用于文件读取分页时的行数限制。',
      help: '不是全部工具输出的总行数。',
      unit: 'lines'
    },
    'tool_output.max_line_length': {
      label: '单行长度上限',
      description: '限制工具输出中一行的最大长度。',
      unit: 'characters'
    },
    'checkpoints.max_snapshots': {
      label: '最多保留的快照数量',
      description: '按现有文件快照保留机制限制保存数量。',
      help: '仅在“安全”页面启用文件快照后生效。',
      unit: 'snapshots'
    },
    'updates.non_interactive_local_changes': {
      label: '非交互更新遇到本地改动时',
      description: '设置无需人工交互的源码更新流程如何处理尚未提交的本地改动。',
      help: '“丢弃”可能永久删除本地修改；终端交互更新仍沿用原有询问。'
    },
    'local.attachmentSize': {
      label: '本机附件处理上限',
      description: '设置桌面端处理附件时使用的本地大小限制。',
      unit: 'megabytes'
    },
    'local.maxBackends': {
      label: '闲置工作区预热上限',
      description: '限制提前连接并保留的闲置次级工作区数量；不阻止活动连接或手动打开工作区。',
      unit: 'connections'
    },
    'local.idleMs': {
      label: '闲置连接保留时间',
      description: '到时断开闲置连接，不停止后端进程或正在进行的任务。',
      unit: 'minutes'
    },
    'tts.edge.voice': {
      label: 'Microsoft Edge · 音色',
      description: '按 Microsoft Edge 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.openai.model': {
      label: 'OpenAI · 合成模型',
      description: '按 OpenAI 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.openai.voice': {
      label: 'OpenAI · 音色',
      description: '按 OpenAI 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.elevenlabs.voice_id': {
      label: 'ElevenLabs · 音色 ID',
      description: '按 ElevenLabs 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.elevenlabs.model_id': {
      label: 'ElevenLabs · 模型 ID',
      description: '按 ElevenLabs 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.xai.voice_id': {
      label: 'xAI · 音色 ID',
      description: '按 xAI 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.xai.language': {
      label: 'xAI · 语音语言',
      description: '按 xAI 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.xai.speed': {
      label: 'xAI · 语速',
      description: '播放速度，1 为正常；较小的值更慢，较大的值更快。',
      unit: 'multiplier'
    },
    'tts.xai.auto_speech_tags': {
      label: 'xAI · 自动语音标记',
      description: '合成前允许模型添加笑声、叹气等表现性语音标记。'
    },
    'tts.xai.optimize_streaming_latency': {
      label: 'xAI · 流式延迟优化',
      description: '平衡延迟与质量：0 更偏向质量，2 更偏向低延迟。'
    },
    'tts.xai.sample_rate': {
      label: 'xAI · 采样率',
      description: '按 xAI 支持的设置填写，保留自定义模型、音色或语言标识。',
      unit: 'hertz'
    },
    'tts.xai.bit_rate': {
      label: 'xAI · 比特率',
      description: '音频比特率，单位为 bit/s；仅在 MP3 输出时生效。',
      unit: 'bitsPerSecond'
    },
    'tts.minimax.model': {
      label: 'MiniMax · 合成模型',
      description: '按 MiniMax 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.minimax.voice_id': {
      label: 'MiniMax · 音色 ID',
      description: '按 MiniMax 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.mistral.model': {
      label: 'Mistral · 合成模型',
      description: '按 Mistral 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.mistral.voice_id': {
      label: 'Mistral · 音色 ID',
      description: '按 Mistral 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.gemini.model': {
      label: 'Gemini · 合成模型',
      description: '按 Gemini 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.gemini.voice': {
      label: 'Gemini · 音色',
      description: '按 Gemini 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.neutts.model': {
      label: 'NeuTTS · 合成模型',
      description: '按 NeuTTS 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.neutts.device': {
      label: 'NeuTTS · 运行设备',
      description: '按 NeuTTS 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.kittentts.model': {
      label: 'KittenTTS · 合成模型',
      description: '按 KittenTTS 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.kittentts.voice': {
      label: 'KittenTTS · 音色',
      description: '按 KittenTTS 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.piper.voice': {
      label: 'Piper · 音色',
      description: '按 Piper 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.deepinfra.model': {
      label: 'DeepInfra · 合成模型',
      description: '按 DeepInfra 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'tts.deepinfra.voice': {
      label: 'DeepInfra · 音色',
      description: '按 DeepInfra 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.local.model': {
      label: 'Local · 识别模型',
      description: '按 Local 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.local.language': {
      label: 'Local · 识别语言',
      description: '按 Local 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.openai.model': {
      label: 'OpenAI · 识别模型',
      description: '按 OpenAI 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.openai.streaming_model': {
      label: 'OpenAI · 流式识别模型',
      description: '按 OpenAI 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.groq.model': {
      label: 'Groq · 识别模型',
      description: '按 Groq 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.mistral.model': {
      label: 'Mistral · 识别模型',
      description: '按 Mistral 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.xai.model': {
      label: 'xAI · 识别模型',
      description: '按 xAI 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.deepinfra.model': {
      label: 'DeepInfra · 识别模型',
      description: '按 DeepInfra 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.elevenlabs.model_id': {
      label: 'ElevenLabs · 模型 ID',
      description: '按 ElevenLabs 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.elevenlabs.language_code': {
      label: 'ElevenLabs · 语言代码',
      description: '按 ElevenLabs 支持的设置填写，保留自定义模型、音色或语言标识。'
    },
    'stt.elevenlabs.tag_audio_events': {
      label: 'ElevenLabs · 标记声音事件',
      description: '在识别结果中标记检测到的非语音声音事件。'
    },
    'stt.elevenlabs.diarize': {
      label: 'ElevenLabs · 区分不同说话人',
      description: '在识别服务支持时标注不同说话人。'
    }
  },
  'zh-hant': {
    'voice.client_direct': { label: '桌面直接處理語音' },
    'stt.streaming': { label: '串流辨識' },
    'voice.gpt_live.instructions': { label: '即時對話說明' },
    'voice.gpt_live.voice': { label: '即時對話音色' },
    'voice.voice_chat_mode': { label: '語音引擎' },
    'security.redact_secrets': {
      help: '修改後需重新啟動執行服務。'
    },
    'checkpoints.enabled': {
      description: '在新的智慧體執行環境中，為支援的檔案修改建立還原點；不能取代版本控制。'
    },
    'browser.use_real_profile': {
      label: '使用本機瀏覽器身分',
      description: '使用執行服務電腦上預設 Chromium 瀏覽器的受管理快照，不直接開啟即時設定檔；既有對話保留原身分。'
    },
    'browser.allow_private_urls': {
      description: '允許非本機瀏覽器後端存取私人網址；本機瀏覽器已可存取本機網路，雲端中繼資料網址仍受封鎖。'
    },
    'browser.auto_local_for_private_urls': {
      description: '雲端瀏覽器可透過既有本機 sidecar 存取私人網址；不會自動帶入真實瀏覽器的登入快照。'
    },
    'memory.memory_char_limit': {
      description: '限制既有記憶儲存可保留的文字量。'
    },
    'memory.user_char_limit': {
      description: '限制既有記憶儲存可保留的文字量。'
    },
    'compression.threshold': {
      description: '上下文使用量達此比例時開始壓縮，以百分比顯示。'
    },
    'compression.target_ratio': {
      description: '壓縮後的上下文目標大小，以容量百分比顯示。'
    },
    'compression.protect_last_n': {
      description: '最近這些訊息盡量保留原文，不參與較早內容的壓縮。'
    },
    'stt.echo_transcripts': {
      label: '訊息平台顯示辨識文字',
      description: '在訊息平台回顯語音辨識結果，不控制桌面輸入框的文字顯示。'
    },
    'voice.auto_tts': {
      description: '控制訊息平台與 CLI 的自動語音回覆；桌面「朗讀回覆」由輸入區選單另行設定。'
    },
    'tool_output.max_lines': {
      description: '用於檔案讀取分頁的行數限制，不是所有工具輸出的總行數。'
    },
    'updates.non_interactive_local_changes': {
      description: '選擇無人值守的原始碼更新暫存或捨棄本機變更；捨棄可能永久刪除未提交的修改。'
    },
    'local.attachmentSize': {
      label: '附件大小',
      description: '依目前執行環境支援的值設定此選項。'
    },
    'local.maxBackends': {
      label: '閒置工作區預熱上限',
      description: '限制預先連接並保留的閒置次要工作區數量；不阻止使用中的連線或手動開啟工作區。'
    },
    'local.idleMs': {
      description: '到時中斷閒置連線，不停止後端處理程序或執行中的任務。',
      label: '執行服務資源'
    },
    'tts.xai.speed': {
      description: '1 為正常速度，較小的值更慢，較大的值更快。'
    },
    'tts.xai.auto_speech_tags': {
      description: '合成前允許模型加入笑聲、嘆氣等表現性語音標記。'
    },
    'tts.xai.optimize_streaming_latency': {
      description: '平衡品質與延遲：0 偏向品質，2 偏向低延遲。'
    },
    'tts.xai.bit_rate': {
      description: '單位為 bit/s，僅適用於 MP3 輸出。'
    },
    'stt.elevenlabs.tag_audio_events': {
      description: '在辨識結果中標記偵測到的非語音聲音事件。'
    },
    'stt.elevenlabs.diarize': {
      description: '辨識服務支援時標記不同說話人。'
    }
  },
  ja: {
    'voice.client_direct': { label: 'デスクトップから音声サービスへ接続' },
    'stt.streaming': { label: 'ストリーミング認識' },
    'voice.gpt_live.instructions': { label: 'リアルタイム音声の指示' },
    'voice.gpt_live.voice': { label: 'リアルタイムの音声' },
    'voice.voice_chat_mode': { label: '音声エンジン' },
    'security.redact_secrets': {
      help: '変更後は実行サービスを再起動してください。'
    },
    'checkpoints.enabled': {
      description:
        '新しいエージェント環境で対応するファイル編集前に復元点を作ります。バージョン管理の代わりにはなりません。'
    },
    'browser.use_real_profile': {
      label: 'このコンピューターのブラウザー情報を使用',
      description:
        '実行するコンピューターの既定 Chromium プロファイルのコピーを使用します。実際のプロファイルを直接開かず、既存のセッションは変更しません。'
    },
    'browser.allow_private_urls': {
      description:
        'リモートのブラウザーにプライベートURLへのアクセスを許可します。ローカルブラウザーは元から利用でき、クラウドのメタデータURLは引き続き禁止されます。'
    },
    'browser.auto_local_for_private_urls': {
      description:
        'クラウドブラウザーは既存のローカル sidecar を使用できます。実際のブラウザーのログイン情報は引き継ぎません。'
    },
    'memory.memory_char_limit': {
      description: '既存の記憶ストアが保持する文字量を制限します。'
    },
    'memory.user_char_limit': {
      description: '既存の記憶ストアが保持する文字量を制限します。'
    },
    'compression.threshold': {
      description: 'コンテキストがこの使用率に達したら圧縮します。'
    },
    'compression.target_ratio': {
      description: '圧縮後のコンテキストサイズを容量の割合で指定します。'
    },
    'compression.protect_last_n': {
      description: '最近の指定件数は古い文脈の圧縮から保護します。'
    },
    'stt.echo_transcripts': {
      label: 'メッセージングで認識結果を表示',
      description: 'メッセージングで音声認識の結果を表示します。デスクトップ入力欄の表示には影響しません。'
    },
    'voice.auto_tts': {
      description:
        'メッセージングと CLI の自動読み上げを制御します。デスクトップの読み上げは入力欄メニューで別途設定します。'
    },
    'tool_output.max_lines': {
      description: 'ファイル読み取りのページ行数です。全ツール出力の総行数ではありません。'
    },
    'updates.non_interactive_local_changes': {
      description:
        '無人のソース更新で変更を退避するか破棄するか選びます。破棄すると未コミットの変更が失われる場合があります。'
    },
    'local.attachmentSize': {
      label: '添付サイズ',
      description: '現在の実行環境が対応する値で設定します。'
    },
    'local.maxBackends': {
      label: '待機プロファイルの事前接続数',
      description:
        '待機中の追加プロファイルへ事前接続して保持する数を制限します。使用中の接続や手動で開いたプロファイルは制限しません。'
    },
    'local.idleMs': {
      description: 'アイドル状態の接続だけを切断し、バックエンドや実行中のタスクは停止しません。',
      label: '接続リソース'
    },
    'tts.xai.speed': {
      description: '1 が通常速度です。小さい値は遅く、大きい値は速くなります。'
    },
    'tts.xai.auto_speech_tags': {
      description: '音声合成前に表現タグの追加をモデルに許可します。'
    },
    'tts.xai.optimize_streaming_latency': {
      description: '0 は品質を、2 は低遅延を優先します。'
    },
    'tts.xai.bit_rate': {
      description: '単位は bit/s。MP3 出力にのみ適用します。'
    },
    'stt.elevenlabs.tag_audio_events': {
      description: '認識した会話以外の音を文字起こしに含めます。'
    },
    'stt.elevenlabs.diarize': {
      description: '認識サービスが対応する場合に話者を区別します。'
    }
  },
  ar: {
    'voice.client_direct': { label: 'اتصال الصوت مباشرة من سطح المكتب' },
    'stt.streaming': { label: 'التعرف المتدفق' },
    'voice.gpt_live.instructions': { label: 'تعليمات الصوت الفوري' },
    'voice.gpt_live.voice': { label: 'صوت المحادثة الفورية' },
    'voice.voice_chat_mode': { label: 'محرك المحادثة الصوتية' },
    'security.redact_secrets': {
      help: 'أعد تشغيل الخدمة بعد تغيير هذه السياسة.'
    },
    'checkpoints.enabled': {
      description:
        'ينشئ نقاط استعادة قبل تعديلات الملفات المدعومة في بيئات الوكلاء الجديدة، ولا يستبدل إدارة الإصدارات.'
    },
    'browser.use_real_profile': {
      label: 'استخدام هوية متصفح هذا الجهاز',
      description:
        'يستخدم نسخة مُدارة من ملف Chromium الافتراضي على جهاز التشغيل، ولا يفتح الملف الفعلي؛ تحتفظ الجلسات الحالية بهويتها.'
    },
    'browser.allow_private_urls': {
      description:
        'يسمح لخلفيات المتصفح غير المحلية بزيارة العناوين الخاصة. المتصفح المحلي يصل للشبكة المحلية أصلًا؛ تظل عناوين بيانات السحابة الوصفية محظورة.'
    },
    'browser.auto_local_for_private_urls': {
      description: 'يمكن لمتصفح السحابة استخدام sidecar المحلي الحالي للعناوين الخاصة، دون وراثة لقطة تسجيلات الدخول.'
    },
    'memory.memory_char_limit': {
      description: 'يحد كمية النص المحفوظ في مخزن الذاكرة الحالي.'
    },
    'memory.user_char_limit': {
      description: 'يحد كمية النص المحفوظ في مخزن الذاكرة الحالي.'
    },
    'compression.threshold': {
      description: 'نسبة استخدام السياق التي تبدأ عندها عملية الضغط.'
    },
    'compression.target_ratio': {
      description: 'حجم السياق المستهدف بعد الضغط كنسبة من السعة.'
    },
    'compression.protect_last_n': {
      description: 'احتفظ بهذا العدد من الرسائل الحديثة خارج ضغط السياق الأقدم.'
    },
    'stt.echo_transcripts': {
      label: 'عرض النص المعترف به في الرسائل',
      description: 'يعرض نص الرسائل الصوتية في منصات الرسائل ولا يتحكم بنص محرر سطح المكتب.'
    },
    'voice.auto_tts': {
      description:
        'يتحكم بالكلام التلقائي في منصات الرسائل وCLI. قراءة ردود سطح المكتب لها إعداد منفصل في قائمة الإدخال.'
    },
    'tool_output.max_lines': {
      description: 'حد أسطر صفحات قراءة الملفات، وليس إجمالي أسطر كل مخرجات الأدوات.'
    },
    'updates.non_interactive_local_changes': {
      description:
        'اختر حفظ تعديلات المصدر أو تجاهلها عند التحديث دون تفاعل. قد يحذف التجاهل التعديلات غير الملتزم بها نهائيًا.'
    },
    'local.attachmentSize': {
      label: 'حجم المرفقات',
      description: 'اضبط هذا الخيار بالقيم التي تدعمها بيئة التشغيل الحالية.'
    },
    'local.maxBackends': {
      label: 'حد اتصالات الملفات الخاملة المسبقة',
      description:
        'يحد الاتصالات المسبقة المحتفظ بها للملفات الثانوية الخاملة، دون منع الاتصالات النشطة أو الملفات المفتوحة يدويًا.'
    },
    'local.idleMs': {
      description: 'يقطع الاتصالات الخاملة فقط، دون إيقاف العمليات الخلفية أو المهام الجارية.',
      label: 'موارد الاتصالات'
    },
    'tts.xai.speed': {
      description: '1 هي السرعة العادية؛ القيم الأصغر أبطأ والأكبر أسرع.'
    },
    'tts.xai.auto_speech_tags': {
      description: 'اسمح للنموذج بإضافة وسوم تعبيرية قبل توليد الكلام.'
    },
    'tts.xai.optimize_streaming_latency': {
      description: '0 يفضّل الجودة؛ 2 يفضّل التأخير الأقل.'
    },
    'tts.xai.bit_rate': {
      description: 'معدل البت بوحدة bit/s وينطبق على مخرجات MP3 فقط.'
    },
    'stt.elevenlabs.tag_audio_events': {
      description: 'ضمّن الأحداث الصوتية غير الكلامية في النص المتعرف عليه.'
    },
    'stt.elevenlabs.diarize': {
      description: 'ميّز المتحدثين عندما تدعم خدمة التعرف ذلك.'
    }
  },
  fr: {
    'voice.client_direct': { label: 'Connexion vocale directe du bureau' },
    'stt.streaming': { label: 'Reconnaissance en continu' },
    'voice.gpt_live.instructions': { label: 'Instructions de voix en temps réel' },
    'voice.gpt_live.voice': { label: 'Voix en temps réel' },
    'voice.voice_chat_mode': { label: 'Moteur de conversation vocale' },
    'security.redact_secrets': {
      help: 'Redémarrez le service après avoir modifié cette règle.'
    },
    'checkpoints.enabled': {
      description:
        'Crée des points de restauration avant les modifications prises en charge dans les nouveaux agents ; ne remplace pas le contrôle de version.'
    },
    'browser.use_real_profile': {
      label: 'Utiliser le profil du navigateur local',
      description:
        'Utilise une copie gérée du profil Chromium par défaut sur la machine d’exécution, jamais le profil actif. Les sessions ouvertes conservent leur identité.'
    },
    'browser.allow_private_urls': {
      description:
        'Autorise les navigateurs distants à visiter des URL privées. Les navigateurs locaux y accèdent déjà ; les métadonnées cloud restent bloquées.'
    },
    'browser.auto_local_for_private_urls': {
      description:
        'Un navigateur cloud peut utiliser le sidecar local existant, sans récupérer les connexions du profil réel.'
    },
    'memory.memory_char_limit': {
      description: 'Limite le texte conservé dans le stockage de mémoire existant.'
    },
    'memory.user_char_limit': {
      description: 'Limite le texte conservé dans le stockage de mémoire existant.'
    },
    'compression.threshold': {
      description: 'Part du contexte utilisé qui déclenche la compression.'
    },
    'compression.target_ratio': {
      description: 'Taille cible du contexte après compression, en pourcentage de la capacité.'
    },
    'compression.protect_last_n': {
      description: 'Préserve ce nombre de messages récents de la compression des anciens échanges.'
    },
    'stt.echo_transcripts': {
      label: 'Afficher les transcriptions dans les messageries',
      description: 'Affiche les transcriptions dans les messageries ; ne contrôle pas le champ de saisie du bureau.'
    },
    'voice.auto_tts': {
      description:
        'Contrôle la parole automatique des messageries et du CLI. La lecture du bureau se règle séparément dans le menu de saisie.'
    },
    'tool_output.max_lines': {
      description: 'Limite de pagination de lecture de fichiers, pas de toutes les sorties des outils.'
    },
    'updates.non_interactive_local_changes': {
      description:
        'Choisissez de remiser ou d’abandonner les modifications lors des mises à jour sans interaction. L’abandon peut supprimer définitivement les modifications non validées.'
    },
    'local.attachmentSize': {
      label: 'Taille des pièces jointes',
      description: 'Utilisez les valeurs prises en charge par l’environnement actuel.'
    },
    'local.maxBackends': {
      label: 'Profils inactifs préconnectés',
      description:
        'Limite les connexions préchauffées conservées vers les profils secondaires inactifs, sans bloquer les connexions actives ni les profils ouverts manuellement.'
    },
    'local.idleMs': {
      description: 'Déconnecte les vues inactives sans arrêter les processus ni les tâches en cours.',
      label: 'Ressources des connexions'
    },
    'tts.xai.speed': {
      description: '1 correspond à la vitesse normale ; une valeur inférieure ralentit la voix.'
    },
    'tts.xai.auto_speech_tags': {
      description: 'Autorise le modèle à ajouter des balises expressives avant la synthèse.'
    },
    'tts.xai.optimize_streaming_latency': {
      description: '0 favorise la qualité ; 2 favorise une latence réduite.'
    },
    'tts.xai.bit_rate': {
      description: 'Débit en bit/s ; concerne uniquement les sorties MP3.'
    },
    'stt.elevenlabs.tag_audio_events': {
      description: 'Inclut les événements sonores non vocaux dans la transcription.'
    },
    'stt.elevenlabs.diarize': {
      description: 'Distingue les locuteurs si le service le permet.'
    }
  },
  de: {
    'voice.client_direct': { label: 'Sprachdienste direkt vom Desktop verbinden' },
    'stt.streaming': { label: 'Streaming-Spracherkennung' },
    'voice.gpt_live.instructions': { label: 'Anweisungen für Echtzeit-Sprache' },
    'voice.gpt_live.voice': { label: 'Echtzeit-Stimme' },
    'voice.voice_chat_mode': { label: 'Sprachgesprächsmodul' },
    'security.redact_secrets': {
      help: 'Starten Sie nach einer Änderung den Laufzeitdienst neu.'
    },
    'checkpoints.enabled': {
      description:
        'Erstellt in neuen Agenten vor unterstützten Änderungen Wiederherstellungspunkte; ersetzt keine Versionsverwaltung.'
    },
    'browser.use_real_profile': {
      label: 'Browserprofil dieses Computers verwenden',
      description:
        'Verwendet eine verwaltete Kopie des Standard-Chromium-Profils auf dem Laufzeitrechner, nie das aktive Profil. Bestehende Sitzungen behalten ihre Identität.'
    },
    'browser.allow_private_urls': {
      description:
        'Erlaubt entfernten Browsern private URLs. Lokale Browser haben bereits Zugriff; Cloud-Metadaten bleiben gesperrt.'
    },
    'browser.auto_local_for_private_urls': {
      description:
        'Ein Cloudbrowser kann den vorhandenen lokalen Sidecar nutzen, ohne Anmeldungen des echten Profils zu übernehmen.'
    },
    'memory.memory_char_limit': {
      description: 'Begrenzt den im vorhandenen Gedächtnisspeicher gespeicherten Text.'
    },
    'memory.user_char_limit': {
      description: 'Begrenzt den im vorhandenen Gedächtnisspeicher gespeicherten Text.'
    },
    'compression.threshold': {
      description: 'Kontextanteil, bei dem die Komprimierung beginnt.'
    },
    'compression.target_ratio': {
      description: 'Zielgröße des Kontexts nach der Komprimierung als Kapazitätsanteil.'
    },
    'compression.protect_last_n': {
      description: 'Diese Anzahl neuer Nachrichten vor der Komprimierung älterer Inhalte schützen.'
    },
    'stt.echo_transcripts': {
      label: 'Transkripte in Messengern anzeigen',
      description: 'Zeigt erkannte Sprachnachrichten in Messengern an, nicht im Eingabefeld des Desktops.'
    },
    'voice.auto_tts': {
      description:
        'Steuert automatische Sprache in Messengern und CLI. Das Vorlesen am Desktop wird separat im Eingabemenü eingestellt.'
    },
    'tool_output.max_lines': {
      description: 'Zeilenlimit für Dateiseiten, kein Gesamtlimit aller Toolausgaben.'
    },
    'updates.non_interactive_local_changes': {
      description:
        'Bei unbeaufsichtigten Quellcodeupdates Änderungen zwischenlagern oder verwerfen. Verwerfen kann ungesicherte Änderungen dauerhaft löschen.'
    },
    'local.attachmentSize': {
      label: 'Anhangsgröße',
      description: 'Konfigurieren Sie diese Option mit Werten der aktuellen Laufzeit.'
    },
    'local.maxBackends': {
      label: 'Vorbereitete inaktive Profilverbindungen',
      description:
        'Begrenzt vorgewärmte Verbindungen zu inaktiven Nebenprofilen. Aktive Verbindungen und manuell geöffnete Profile werden nicht blockiert.'
    },
    'local.idleMs': {
      description: 'Trennt inaktive Ansichten, ohne Backendprozesse oder laufende Aufgaben zu stoppen.',
      label: 'Verbindungsressourcen'
    },
    'tts.xai.speed': {
      description: '1 ist normale Geschwindigkeit; kleinere Werte sind langsamer, größere schneller.'
    },
    'tts.xai.auto_speech_tags': {
      description: 'Das Modell darf vor der Synthese Ausdruckstags ergänzen.'
    },
    'tts.xai.optimize_streaming_latency': {
      description: '0 bevorzugt Qualität; 2 bevorzugt geringere Verzögerung.'
    },
    'tts.xai.bit_rate': {
      description: 'Bitrate in bit/s, nur für MP3-Ausgabe.'
    },
    'stt.elevenlabs.tag_audio_events': {
      description: 'Erkannte nichtsprachliche Geräusche in Transkripte aufnehmen.'
    },
    'stt.elevenlabs.diarize': {
      description: 'Sprecher unterscheiden, wenn der Erkennungsdienst dies unterstützt.'
    }
  },
  es: {
    'voice.client_direct': { label: 'Conexión de voz directa desde el escritorio' },
    'stt.streaming': { label: 'Reconocimiento en directo' },
    'voice.gpt_live.instructions': { label: 'Instrucciones de voz en tiempo real' },
    'voice.gpt_live.voice': { label: 'Voz en tiempo real' },
    'voice.voice_chat_mode': { label: 'Motor de conversación de voz' },
    'security.redact_secrets': {
      help: 'Reinicia el servicio después de cambiar esta política.'
    },
    'checkpoints.enabled': {
      description:
        'Crea puntos de restauración antes de cambios admitidos en nuevos agentes; no sustituye al control de versiones.'
    },
    'browser.use_real_profile': {
      label: 'Usar el perfil del navegador de este equipo',
      description:
        'Usa una copia gestionada del perfil Chromium predeterminado del equipo de ejecución, nunca el perfil activo. Las sesiones existentes conservan su identidad.'
    },
    'browser.allow_private_urls': {
      description:
        'Permite URL privadas en navegadores remotos. Los locales ya tienen acceso; los metadatos de la nube siguen bloqueados.'
    },
    'browser.auto_local_for_private_urls': {
      description: 'El navegador en la nube puede usar el sidecar local existente sin heredar sesiones del perfil real.'
    },
    'memory.memory_char_limit': {
      description: 'Limita el texto conservado por el almacén de memoria existente.'
    },
    'memory.user_char_limit': {
      description: 'Limita el texto conservado por el almacén de memoria existente.'
    },
    'compression.threshold': {
      description: 'Porcentaje de uso del contexto que inicia la compresión.'
    },
    'compression.target_ratio': {
      description: 'Tamaño objetivo del contexto tras comprimir, como porcentaje de su capacidad.'
    },
    'compression.protect_last_n': {
      description: 'Conserva esta cantidad de mensajes recientes fuera de la compresión del contexto anterior.'
    },
    'stt.echo_transcripts': {
      label: 'Mostrar transcripciones en mensajería',
      description: 'Muestra transcripciones en mensajería; no controla el campo de entrada del escritorio.'
    },
    'voice.auto_tts': {
      description:
        'Controla el habla automática en mensajería y CLI. La lectura del escritorio se ajusta por separado en el menú de entrada.'
    },
    'tool_output.max_lines': {
      description: 'Límite de líneas por página de lectura, no de todas las salidas de herramientas.'
    },
    'updates.non_interactive_local_changes': {
      description:
        'Elige guardar o descartar cambios locales durante las actualizaciones sin interacción. Descartar puede borrar cambios no confirmados permanentemente.'
    },
    'local.attachmentSize': {
      label: 'Tamaño de adjuntos',
      description: 'Configura esta opción con valores admitidos por el entorno actual.'
    },
    'local.maxBackends': {
      label: 'Conexiones anticipadas de perfiles inactivos',
      description:
        'Limita las conexiones preparadas a perfiles secundarios inactivos, sin bloquear conexiones activas ni perfiles abiertos manualmente.'
    },
    'local.idleMs': {
      description: 'Desconecta vistas inactivas sin detener procesos ni tareas en curso.',
      label: 'Recursos de conexión'
    },
    'tts.xai.speed': {
      description: '1 es la velocidad normal; los valores menores son más lentos y los mayores más rápidos.'
    },
    'tts.xai.auto_speech_tags': {
      description: 'Permite al modelo añadir etiquetas expresivas antes de sintetizar.'
    },
    'tts.xai.optimize_streaming_latency': {
      description: '0 prioriza calidad; 2 prioriza menor latencia.'
    },
    'tts.xai.bit_rate': {
      description: 'Tasa en bit/s; solo se aplica a salida MP3.'
    },
    'stt.elevenlabs.tag_audio_events': {
      description: 'Incluye sonidos no verbales reconocidos en las transcripciones.'
    },
    'stt.elevenlabs.diarize': {
      description: 'Distingue hablantes cuando lo admite el servicio.'
    }
  },
  ru: {
    'voice.client_direct': { label: 'Подключать голосовые сервисы из приложения' },
    'stt.streaming': { label: 'Потоковое распознавание' },
    'voice.gpt_live.instructions': { label: 'Инструкции для голосового диалога' },
    'voice.gpt_live.voice': { label: 'Голос реального времени' },
    'voice.voice_chat_mode': { label: 'Движок голосового диалога' },
    'security.redact_secrets': {
      help: 'После изменения перезапустите службу выполнения.'
    },
    'checkpoints.enabled': {
      description:
        'Создаёт точки восстановления перед поддерживаемыми изменениями в новых агентах; не заменяет контроль версий.'
    },
    'browser.use_real_profile': {
      label: 'Использовать профиль браузера этого компьютера',
      description:
        'Использует управляемую копию профиля Chromium на машине выполнения, не открывая рабочий профиль. Текущие сеансы сохраняют свою идентичность.'
    },
    'browser.allow_private_urls': {
      description:
        'Разрешает удалённым браузерам частные URL. Локальные уже имеют доступ; адреса метаданных облака остаются заблокированными.'
    },
    'browser.auto_local_for_private_urls': {
      description: 'Облачный браузер может использовать существующий локальный sidecar без входов из реального профиля.'
    },
    'memory.memory_char_limit': {
      description: 'Ограничивает текст, сохраняемый текущим хранилищем памяти.'
    },
    'memory.user_char_limit': {
      description: 'Ограничивает текст, сохраняемый текущим хранилищем памяти.'
    },
    'compression.threshold': {
      description: 'Доля занятого контекста, запускающая сжатие.'
    },
    'compression.target_ratio': {
      description: 'Целевой размер контекста после сжатия в процентах от ёмкости.'
    },
    'compression.protect_last_n': {
      description: 'Сохранять это число последних сообщений вне сжатия старого контекста.'
    },
    'stt.echo_transcripts': {
      label: 'Показывать расшифровки в мессенджерах',
      description: 'Показывает распознанный текст в мессенджерах, но не управляет полем ввода приложения.'
    },
    'voice.auto_tts': {
      description:
        'Управляет автоматической речью в мессенджерах и CLI. Чтение в приложении настраивается отдельно в меню ввода.'
    },
    'tool_output.max_lines': {
      description: 'Ограничение строк страницы чтения файла, а не всех результатов инструментов.'
    },
    'updates.non_interactive_local_changes': {
      description:
        'Выберите сохранение или отмену локальных изменений при обновлении без участия пользователя. Отмена может навсегда удалить незакоммиченные изменения.'
    },
    'local.attachmentSize': {
      label: 'Размер вложений',
      description: 'Укажите значение, поддерживаемое текущей средой выполнения.'
    },
    'local.maxBackends': {
      label: 'Предварительные подключения к неактивным профилям',
      description:
        'Ограничивает сохраняемые предварительные подключения к неактивным дополнительным профилям, не блокируя активные подключения и профили, открытые вручную.'
    },
    'local.idleMs': {
      description: 'Отключает простаивающие подключения, не останавливая серверные процессы и выполняемые задачи.',
      label: 'Ресурсы подключений'
    },
    'tts.xai.speed': {
      description: '1 — обычная скорость; меньше — медленнее, больше — быстрее.'
    },
    'tts.xai.auto_speech_tags': {
      description: 'Разрешить модели добавлять выразительные метки перед синтезом.'
    },
    'tts.xai.optimize_streaming_latency': {
      description: '0 предпочитает качество; 2 — меньшую задержку.'
    },
    'tts.xai.bit_rate': {
      description: 'Битрейт в bit/s; применяется только к MP3.'
    },
    'stt.elevenlabs.tag_audio_events': {
      description: 'Включать распознанные неречевые звуки в расшифровку.'
    },
    'stt.elevenlabs.diarize': {
      description: 'Различать говорящих, если сервис распознавания это поддерживает.'
    }
  }
}
