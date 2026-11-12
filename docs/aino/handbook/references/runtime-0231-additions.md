# Aino 技术补充 · v0.23.1 运行协议

[返回完整手册](../README.md)

本章依据上游 v0.23.1 文档与实现编写，保留实际 SDK、CLI 和协议名称，解释 Aino 的产品及账户边界。它是适配说明，非原 19 篇手册中的逐字迁移章节。连接是否支持某项能力，应检查该连接的 capability、当前配置和实际运行结果。

## 浏览器登录与凭据库

`browser.use_real_profile` 由用户明确启用。真实浏览器导入只支持本机运行服务；远程、SSH 和 Cloud 连接不能取得本机登录。原浏览器通过受控快照解密自己的登录库，Cookie 经私有管道进入对应浏览器分区；渲染页面只接收计数。Aino 的账户分区及切号保护继续适用。

重新导入会更新登录状态。关闭功能只清理由该功能导入且仍归其管理的 Cookie，不声称注销后来手动登录的所有网站。隐藏的 `export-signins` 属于内部 IPC，输出包含 Cookie；不能作为普通排障命令让用户复制输出到聊天、日志或工单。

`browser_vault` 的 `fill/save_login/enter_code` 可指定 `target: "preview"` 或 `"browser"`。桌面预览桥可用时，省略目标会使用预览；这不代表独立自动化浏览器也已打开。预览填充绑定当前聊天、窗口、标签页和文档，页面变化、导航或取消后拒绝旧请求。请求不在重连后重放，也不自动改用另一个浏览器。填充不等于提交。

实现依据：`tools/browser_vault_preview.py`、`hermes_cli/browser_preview_signins.py`、`tui_gateway/methods_vault.py`、`apps/desktop/electron/preview-signins.ts`。完整说明见源码文档 `website/docs/user-guide/features/credential-vault.md`。

## 跨网关群聊

群聊所属网关维护日志和调度；成员在自己的网关、配置、模型权限下执行。两侧网关需要运行，旧群不会升级后自动换执行器。网关连接、RoomLink 与已下线的 Aino 云同步是不同能力。

主网关须符合 `groups.capabilities` 的 driver、persistent_process 和 `groups.peer.register` 要求。成员网关须提供 `room_link.enabled`、`groups.peer.invite`、可达的 RoomLink endpoint、持久运行记录和支持的审批策略。不能简单根据连接叫 SSH 或 URL 就判断可用。

`groups.peer.invite/register/revoke` 授权限定于房间、成员和配置，保留 endpoint/catalog 安全绑定。跨网关成员只接收文本；本机成员仍按自己的 capability 使用附件。未加入、暂时离线和授权到期是不同状态。

结果不确定时，沿原 intent/run 恢复；客户端超时不证明任务没有执行。运行及状态记录有保留期限，不能承诺任意多年后的重试都绝不重复。Stop 只有在成员网关确认结束后才是 cancelled；未确认可保持 deferred。Disband 等待停止及房间范围的授权撤销，失败保留原群；另建群不会迁移原历史。

实现依据：`gateway/session_group_peers.py`、`tui_gateway/hosted_room_driver.py`、`tui_gateway/hosted_room_service.py` 及 `hosted_room_peer*`。完整说明见源码文档 `apps/desktop/docs/canonical-groups.md`、`website/docs/user-guide/bot-mode.md`。

## 插件 RPC、事件、Hook 和环境

`ctx.register_rpc("name", handler)` 注册 `plugin.<plugin_id>.<name>`。先探测 `runtime.describe` 的 `plugin-rpc-v1`；有该能力时，`-32601` 表示目标方法未加载；没有能力时不能假设 RPC 可用。RPC 需要 `session:control`，带会话还检查 owner、profile 和只读状态。插件自行验证业务参数，认证通过不等于已做逐方法业务授权。

`ctx.emit_to_session` 只向目标会话查看者推送插件事件，可通过事件流重连回放。返回 `False` 不能解释为后台任务已保存，事件也不是新执行命令。自建线程使用绑定插件 profile 的该接口，避免全局广播会话秘密。原 `ctx.rest/ctx.socket` 桌面 REST namespace 与新 RPC 保留各自通道。

`on_session_open` 观察本地 create/resume，不适用于消息平台，不因普通重读或断线重连重复触发；打开不等待，下一轮有界等待。`post_curator_run` 在报告落盘后通知，`dry_run` 表示拟变更，不能当作已删除或归档。

`conversation_id` 跨压缩稳定，委派子智能体继承父 conversation ID，但拥有自己的 session ID。它不是账户身份或控制授权。`get_session_env` 的 `HERMES_SESSION_ACTOR_ID/NAME` 描述当前轮操作者，`USER_ID` 是路由；多人输入合流时 actor 可为空，不能借用上一人身份。`client.name/version` 为创建方自报标签，不构成授权。

`register_session_env` 在每次启动本地命令时计算，只接受插件已声明变量；`None` 删除值，不覆盖 core/凭据保留名，也不自动传到 Docker、SSH 等远程 backend。动态值按 profile 隔离，并排除在共享 shell snapshot 外。创建时冻结的 `client_env` 是另一机制。

`register_system_prompt_section` 仅在新会话计算，位置为 `after_memory`，单节最多 4000、总计 8000、最多 32 节；压缩及恢复读取已持久化字节。动态内容使用现有每轮 Hook，不能借 open Hook 或环境变化重建旧提示缓存。

实现依据：`hermes_cli/plugin_rpc.py`、`gateway/session_plugin_rpc.py`、`hermes_cli/plugin_events.py`、`hermes_cli/plugins_session_env.py`、`gateway/session_open.py`。公开 API 以 `hermes_cli/data/plugin_api.json` 及其生成文档为准。

## 只读会话与子智能体记录

`session-transcript-v1` 提供 `session.transcript`，读取展示记录而不 attach、不建 agent、不启动执行或推理收费，仍检查 `session:read`、profile、owner 和 Aino 账户边界。`session-list-picker-v1` 提供轻量列表字段；不能为看一段历史而无条件 resume，旧服务没有 capability 时也不伪造支持。

`rows` 包含普通消息和 `row_kind: compaction` 的用户可读摘要，后者可能为 `role: system`，不能当内部行直接丢掉。图片默认显示占位，`inline_images` 显式请求内联；`truncated` 表示该行因页大小被截断。页数限制 1–500 行，可补齐边界上最多 64 条工具结果，JSON 上限 2 MiB。

cursor 不透明并绑定父会话、子智能体和顺序。`order: oldest` 的空页表示暂时追平，保留非空 cursor 继续轮询；`order: latest` 从新往旧翻页，每页内部仍旧到新，读到最早页后 cursor 为 null。`reset: true` 必须替换缓存，不能追加，以免压缩、回退、重写或删除后重复拼接。

子智能体读取使用精确 parent session ID + subagent ID，通过运行 roster 或真实 delegation/compression lineage 验证；外部/未知子任务返回不可用。`child_session_id` 是最新物理段，不是用户提供任意 ID 就能恢复它的入口。只读历史可用不代表可 steer/interrupt。隐藏面板停止轮询，切换账户/来源后清理游标并忽略旧响应；原面板、胶囊及只读恢复的账户栅栏继续保留。

实现依据：`gateway/session_stored_reads.py`、`gateway/session_transcript_subagent.py`、`gateway/session_transcript_rows.py`、`tui_gateway/contracts/canonical_stored_reads.py`。

## 保存的连接与本地安全

支持共享连接表的版本让桌面与 Webapp 共用连接记录，并明确导入旧记录。默认关闭加密时，连接文件按操作系统用户权限保护，内含凭据为明文，桌面和 Webapp 可共用。Aino 保留用户明确开启的桌面密钥加密：同一连接表记录 `secretStorage: safeStorage` 并保存系统钥匙串信封，不因导入或 Python 写入而自动降级。

Python/Webapp 可列出连接、改标签或删除连接，原样保留加密信封；不能解密时，使用凭据、更新密钥或开始登录会明确返回 `desktop_unlock_required`，不会静默漏掉请求头或写入明文。OAuth 信封仍绑定签发网址，更改地址不会借用旧令牌。用户回到桌面解锁，或明确关闭加密并完成迁移后，才能恢复相应共享使用。连接文件不应发到聊天或公共仓库。删除连接只移除保存入口，不删除远端记录或自动停掉远端任务。

这不是聊天云备份。Aino 会话云同步仍永久下线；本机文件导出、远程网关和账户隔离保留各自行为。

来源版本：Hermes Agent v0.23.1，保留上游真实作者与 MIT 许可证署名；本章 Aino 适配说明与完整来源记录见[迁移清单](../migration-manifest.json)。
