# 功能来源映射

[返回帮助首页](README.md)

本页说明这份帮助如何对应 Aino 当前实现，方便维护者检查事实。代码路径是源码定位信息，安装包不必包含源码树；普通用户无需打开这些文件。

## 产品与技术边界

| 内容 | Aino 当前依据 | 阅读位置 |
| --- | --- | --- |
| 产品名、官网和技术兼容边界 | `apps/desktop/brand.json`、`hermes_cli/product_identity.py` | [帮助首页](README.md) |
| 默认个性和提示缓存 | `hermes_cli/default_soul.py`、`agent/prompt_builder.py`、`agent/system_prompt.py` | [提示刷新](prompt-refresh.md) |
| 旧提示受控刷新 | `hermes_cli/subcommands/sessions.py`、`hermes_cli/sessions_cmd.py` 的 `refresh-prompts` | [提示刷新](prompt-refresh.md) |
| 离线文档入口及包内副本 | `hermes_cli.product_identity.LOCAL_DOCUMENTATION_PATH`、`hermes_cli/data/aino-docs/` | [帮助首页](README.md) |

`hermes` CLI、`HERMES_HOME`、协议兼容名、插件 SDK 及已有交互桥是技术接口，不应只为了显示品牌而改成不存在的命令或破坏兼容。真实第三方服务名称和许可证仍保留。

## 当前功能映射

| 功能 | 主要实现位置 | Aino 帮助 |
| --- | --- | --- |
| 账户本地工作区、UI 与浏览器分区隔离 | `apps/desktop/electron/data-paths.mjs`、`apps/desktop/electron/platform-native-auth.ts` | [账户与设备](accounts-and-devices.md) |
| 平台用户 ID 与 origin 规范化 | `apps/desktop/shared/platform-client.ts` | [账户与设备](accounts-and-devices.md) |
| 设备 Key 与授权显示 | `apps/desktop/shared/platform-device-contract.ts`、`app/settings/platform-billing/devices-view.tsx` | [账户与设备](accounts-and-devices.md) |
| 会话归属、待确认状态与空白会话恢复 | `store/platform-session-access.ts`、`api/platform-session-binding.ts` | [故障恢复](troubleshooting.md) |
| 当前会话模型恢复 | `components/chat/session-model-recovery.tsx`、`store/session-recovery.ts` | [模型与生图](models-and-images.md) |
| Bot 固定会话和配置边界 | `apps/desktop/src/AGENTS.md`、`plugins/hermes-bots/` | [会话与协作](conversations-and-collaboration.md) |
| 网关持有的群聊执行与重试约束 | `apps/desktop/docs/canonical-groups.md`、`plugins/hermes-bots/` | [会话与协作](conversations-and-collaboration.md) |
| 协作胶囊与子任务控制 | `app/agents/collaboration-capsule.tsx`、`collaboration-navigation.ts`、`store/collaboration-capsule.ts` | [会话与协作](conversations-and-collaboration.md) |
| 模型设置及独立图片设置 | `app/settings/model-settings-navigation.tsx`、`image-generation-settings.tsx`、`agent/image_gen_provider.py` | [模型与生图](models-and-images.md) |
| 文件和预览标签页 | `store/preview.ts`、`components/pane-shell/` | [文件与面板](files-and-panels.md) |
| 会话摘要位置 | `app/shell/summary-workspace.tsx` | [文件与面板](files-and-panels.md) |
| 设置分类及字段 | `app/settings/config-subpages.ts`、`app/settings/index.tsx` | [设置](settings.md) |
| 对话 MCP 安装确认与授权 | `tools/connectors/tool.py` 及相应桌面连接卡片 | [扩展与安全](extensions-and-safety.md) |
| 消息网关与定时计划 | `gateway/`、`cron/`、`hermes_cli/subcommands/cron.py` | [调度与网关](scheduling-and-gateway.md) |
| 浏览器登录导入与预览 Vault | `electron/preview-signins.ts`、`tools/browser_vault_preview.py` | [设置](settings.md)、[技术补充](handbook/references/runtime-0231-additions.md) |
| 跨网关群成员与授权 | `gateway/session_group_peers.py`、`tui_gateway/hosted_room_peer_transport.py` | [会话与协作](conversations-and-collaboration.md) |
| Plugin RPC、会话事件及 Hook | `hermes_cli/plugin_rpc.py`、`gateway/session_plugin_rpc.py`、`hermes_cli/plugins_session_env.py` | [扩展与安全](extensions-and-safety.md) |
| 不附着执行的存储会话只读分页 | `gateway/session_stored_reads.py`、`gateway/session_transcript_subagent.py` | [文件与面板](files-and-panels.md) |
| 云同步退役后的兼容契约 | `apps/desktop/shared/platform-sync-contract.ts` | [故障恢复](troubleshooting.md) |

表中未以 `apps/desktop/src/` 开头的前端相对路径均位于该目录下。运行服务源文件则使用仓库根目录路径。计费与设备鉴权还依赖独立部署的 Aino API；本仓库不能单独证明线上部署状态。

## 上游资料如何使用

内置帮助技能保留技术 ID `hermes-agent`。其完整正文、全部参考资料和模板已搬入 [Aino 完整操作手册](handbook/README.md)，通过本地章节查询底层命令、配置项与扩展协议。技能目录保留来源副本以便兼容和追溯。Aino 的产品使用问题先读取本组产品指南，再查看手册中的对应完整章节。

| 上游参考文件 | 适合核对的内容 | Aino 对应说明 |
| --- | --- | --- |
| `cli-reference.md`、`slash-commands.md` | CLI/斜杠命令语法 | 先核对当前安装的 `--help` 与支持入口 |
| `configuration.md`、`providers-and-models.md` | 运行配置与服务商技术参数 | [设置](settings.md)、[模型与生图](models-and-images.md) |
| `native-mcp.md`、`desktop-plugins.md` | MCP 传输与插件 SDK | [扩展与安全](extensions-and-safety.md) |
| `background-systems.md`、`webhooks.md` | 调度、后台任务和外部触发 | [调度与网关](scheduling-and-gateway.md) |
| `security-privacy.md`、`project-context-files.md` | 审批、秘密遮罩与项目规则 | [扩展与安全](extensions-and-safety.md) |
| `themes.md`、`tui-widgets.md`、`petdex.md` | 专项界面扩展的技术协议 | 仅在当前安装实际提供该能力时使用 |
| `troubleshooting.md`、`windows-quirks.md` | 底层环境与平台问题 | [故障恢复](troubleshooting.md) |
| `portal-auth-for-third-party-apps.md` | Nous 服务的授权边界 | 不把第三方订阅说成 Aino 套餐权益 |
| `upstream-runtime-guide.md` | 修改前保留的上游技能原文 | [完整正文及 Aino 差异说明](handbook/runtime-guide.md) |

上游在线文档属于可选实现参考：[Hermes 文档](https://hermes-agent.nousresearch.com/docs/)。它可能描述 Aino 未提供的旧界面、安装器或托管服务；不能直接替代本地产品事实，也不能据此恢复已下线的云同步模块。
