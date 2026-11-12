# Aino 使用帮助

这是随 Aino 安装包提供的离线使用帮助，适用于当前桌面端及其配套运行服务。优先按本文说明使用 Aino；文末列出的 Hermes 资料用于理解底层兼容接口，不代表 Aino 一定提供相同入口、托管服务或界面。

## 从这里开始

| 我想做什么 | 打开文档 |
| --- | --- |
| 第一次登录、选择模型并开始任务 | [快速开始](getting-started.md) |
| 理解账户隔离、设备授权和扣费 | [账户与设备](accounts-and-devices.md) |
| 使用普通会话、Bot、群聊和协作胶囊 | [会话与协作](conversations-and-collaboration.md) |
| 配置默认模型、第三方 API、自定义 API 或生图 | [模型与生图](models-and-images.md) |
| 打开文件、预览、终端、审查和摘要 | [文件与面板](files-and-panels.md) |
| 调整外观、记忆、语音、安全及其他设置 | [设置](settings.md) |
| 安装 MCP、插件或技能，处理授权 | [扩展与安全](extensions-and-safety.md) |
| 设置定时任务或连接消息平台 | [调度与网关](scheduling-and-gateway.md) |
| 修复连接、模型、登录和任务异常 | [故障恢复](troubleshooting.md) |
| 修改旧会话使用的系统提示 | [旧会话提示刷新](prompt-refresh.md) |
| 核对文档对应的实际功能和实现 | [功能来源映射](feature-map.md) |
| 阅读完整帮助正文、19 篇技术专题和全部模板 | [Aino 完整操作手册](handbook/README.md) |

## 先分清这几件事

- **Aino 账户**管理平台身份、设备授权、内置模型和套餐；**Bot 配置**管理机器人的个性、工具和默认模型。
- **普通会话**适合独立任务；**Bot 会话**使用该机器人的配置；**群聊**让多个成员围绕同一任务协作；**子智能体**是任务执行时临时委派的助手。
- **内置模型**通过 Aino 服务使用；**第三方服务商**和**自定义模型**使用你配置的服务地址、密钥及其计费方式。
- **网关**负责连接外部消息平台和运行后台任务，不表示任务自动在 Aino 云端托管。
- **云端会话同步已下线**。会话在对应账户的本地工作区保存，不提供跨设备自动同步或云端恢复。

## 关于版本和离线使用

这组 Markdown 文件可以直接离线阅读，所有站内导航均为相对链接。源码入口是 `docs/aino/README.md`；Python 安装包中的副本位于 `hermes_cli/data/aino-docs/README.md`。底层 `hermes_cli.product_identity.LOCAL_DOCUMENTATION_PATH` 用于解析当前安装中的帮助目录，再打开其中的 `README.md`。

智能助手通过现有技能通道读取本手册，例如 `skill_view(name="hermes-agent", file_path="aino-docs/README.md")`。即使终端配置为 SSH、Docker 等远程或沙箱环境，也无需在远程环境查找主机安装目录；文档按需读取，不会整本加入每次对话。

[完整操作手册](handbook/README.md)收录内置帮助技能的全部正文、技术专题和模板，保留命令、示例与来源署名；需要了解当前 Aino 页面操作时，先读上表对应的产品指南。主题、暂停、账户、第三方授权等差异已在手册中标明。

实际可用模型、套餐、消息平台授权和第三方服务状态以当前账户、服务端及已安装组件为准。文档不包含固定的模型清单，也不能证明某台线上服务器正在运行哪个版本。

命令中的 `hermes`、`HERMES_HOME`、`@hermes/plugin-sdk` 等是保留的技术兼容名称；Aino 不要求把它们改写成不存在的 `aino` 命令。需要操作命令行时，先确认命令针对的是桌面实际使用的账户工作区与配置，不要修改另一个独立 CLI 实例。

可选在线入口：[Aino 官网](https://petoi.cn)、[在线帮助](https://petoi.cn/guide.html)。离线阅读本组文档不依赖这些网站。
