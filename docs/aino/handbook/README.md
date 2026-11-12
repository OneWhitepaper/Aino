# Aino 完整操作手册

[返回 Aino 使用帮助](../README.md)

这里完整收录内置帮助技能的正文、19 篇技术专题和 3 个模板。操作说明、参数表、命令、代码示例与排障流程均已纳入本地文档，不需要跳转上游网站才能阅读这些内容。

原文来自 Hermes 兼容运行时，保留作者 **Hermes Agent + Teknium** 与 **MIT** 许可证标识。每章开头说明 Aino 当前适用范围，正文中的底层命令、SDK、协议和真实第三方服务名称保持准确。当前 Aino 页面行为以[产品指南](../README.md)及安装版本的实际能力为准。

## 完整正文

[功能总览、快速开始、路径、会话恢复、独立进程协作与运行约束](runtime-guide.md)

该章保留原技能完整正文，并补充 Aino 对安装方式、主题、暂停、账户、面板及旧提示刷新的适配说明。

## 完整技术章节

| 主题 | 打开完整章节 |
| --- | --- |
| 命令行与子命令 | [命令行与子命令](references/cli-reference.md) |
| 会话斜杠命令 | [会话斜杠命令](references/slash-commands.md) |
| 配置、工具集与语音 | [配置、工具集与语音](references/configuration.md) |
| 服务商、模型与别名 | [服务商、模型与别名](references/providers-and-models.md) |
| 子智能体、定时任务、Curator 与看板 | [子智能体、定时任务、Curator 与看板](references/background-systems.md) |
| 委派并发与排障 | [委派并发与排障](references/delegate-task-concurrency-diagnosis.md) |
| MCP 安装、授权与工具发现 | [MCP 安装、授权与工具发现](references/native-mcp.md) |
| 桌面插件 SDK、面板、命令与挂件 | [桌面插件 SDK、面板、命令与挂件](references/desktop-plugins.md) |
| CLI/TUI 主题与皮肤 | [CLI/TUI 主题与皮肤](references/themes.md) |
| 终端挂件 | [终端挂件](references/tui-widgets.md) |
| 宠物与素材目录 | [宠物与素材目录](references/petdex.md) |
| 项目、多文件夹与工作区 | [项目、多文件夹与工作区](references/projects-and-folders.md) |
| 项目规则与上下文文件 | [项目规则与上下文文件](references/project-context-files.md) |
| 审批、隐私与秘密遮罩 | [审批、隐私与秘密遮罩](references/security-privacy.md) |
| Nous Portal 与第三方应用授权 | [Nous Portal 与第三方应用授权](references/portal-auth-for-third-party-apps.md) |
| Webhook 接收、订阅与投递 | [Webhook 接收、订阅与投递](references/webhooks.md) |
| 运行服务故障排查 | [运行服务故障排查](references/troubleshooting.md) |
| Windows 兼容问题 | [Windows 兼容问题](references/windows-quirks.md) |
| 开发与扩展规范 | [开发与扩展规范](references/contributor-guide.md) |

## 配套模板

| 模板 | 使用范围 |
| --- | --- |
| [桌面插件 plugin.js](templates/plugin.js) | 保留真实 SDK 与可执行示例；具体布局按当前 Aino 插件入口确定。 |
| [终端主题 skin.yaml](templates/skin.yaml) | CLI/TUI 示例，默认显示名适配为 Aino Agent；不改变 Aino 桌面的固定调色板。 |
| [终端时钟 clock.mjs](templates/clock.mjs) | TUI 挂件示例，与聊天内 HTML 挂件不同。 |

[原始主题模板](provenance/original-skin.yaml)供核对来源；Aino 版仅调整首行适用范围说明和默认显示名，全部主题参数保留。插件与时钟模板保持原始字节。

## 内置帮助如何读取这套文档

- [当前帮助技能完整操作规范](help-skill.md)
- [当前帮助技能的本地阅读路由](references/aino-help.md)

运行服务通过 `hermes_cli.product_identity.LOCAL_DOCUMENTATION_PATH` 定位文档根目录。智能助手使用 `skill_view(name="hermes-agent", file_path="aino-docs/handbook/README.md")` 读取本手册，章节和模板同样保留 `aino-docs/` 前缀。这条现有技能通道在主机读取已安装文档，不受远程终端文件系统差异影响。无源码安装包同样携带本手册及其模板，不依赖技能目录中的来源副本。

## 完整性与来源

[资源迁移清单](migration-manifest.json)逐项记录当前技能目录的来源文件、来源哈希、目标位置及适配说明。来源正文、19 篇专题、3 个模板和当前 Aino 的帮助入口/路由都列入清单。

本手册保留的外部链接是作者引用或真实第三方服务地址；外部整站内容不属于本次内置技能资料。示例中的上游安装器、第三方订阅、代理构想与危险命令不会因为进入 Aino 文档就成为已安装功能或用户授权。Aino 云端会话同步仍已下线。
