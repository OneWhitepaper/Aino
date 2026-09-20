# Aino 统一项目与默认会话体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 A 运行闭环通过后，完成项目统一、旧会话迁移、完整备份和 Agent Hub 入口整合，使新体验成为可安全使用的默认普通聊天。

**Architecture:** 保留各 Profile 的私有库，通过同宿主共享项目索引和稳定公共会话容器提供统一导航。旧会话按显式边界接入；原私聊/群聊与普通 conversation 区分用途。存储、备份和写入权限是默认启用前置条件。

**Tech Stack:** 既有 Python/SQLite、Profile projects.db、JSON-RPC contracts、Electron/React/nanostores。

**Spec:** [已确认架构](../specs/2026-09-20-aino-multi-agent-conversations-design.md)、[总计划](2026-09-20-aino-multi-agent-conversations.md)、[A 计划](2026-09-20-aino-multi-agent-conversations-core.md)。

## Global Constraints

- A 的 G1–G3 必须通过。B 与 A 合起来才是完整交付；不把数据、容量和后台恢复留给用户兜底。
- 不搬动 / 合并用户的 Profile state.db；不把私人 Bot Chat 或隐藏工具过程导入公共记录。
- 项目等同文件资源需要相同宿主和执行环境，不能只比较路径文本。
- 普通会话归档仍可读，不沿用群聊解散清理；超配额明确失败，不静默删历史或截短长答案。
- 修改任何迁移行为先在临时全套数据上测试；实施阶段不使用真实用户库做试验。
- 共享数据库、Profile 数据和附件必须作为可校验的恢复集合处理；运行时租约 / 密钥不得作为可跨安装重放的执行授权。
- 不改变已有 Agent Hub canonical Bot Chat、团队、CLI/TUI、网关和 cron 的产品语义；共享模块改动仍需回归。
- 默认启用前验证新旧 UI 与后端能力协商；不承诺任意旧版本后端能安全写入新 schema。

## Task 1: B1 — 共享项目索引与选择解耦

**Files:** 新 `hermes_cli/projects_shared.py`、`tests/hermes_cli/test_projects_shared.py`、`tests/tui_gateway/test_conversation_projects.py`；修改 `tui_gateway/methods_projects.py`、`contracts/projects_pets.py`、`hermes_cli/web_routers/profiles.py` 的项目来源适配；桌面 `store/projects.ts`、`open-projects.ts`、`app/chat/composer/project-selection.ts` 及其现有 tests。先确认具体 router / methods 文件，以 `rg --files` 为准。

**Interfaces:** `SharedProjectStore(db_path: Path)`；`register(*, install_id: str, environment_id: str, canonical_path: str, registration_profile: str, source_project_id: str, name: str) -> SharedProject`；`resolve(shared_project_id: str) -> SharedProject`；`list_sources(shared_project_id: str) -> tuple[ProjectRef, ...]`。`SharedProject` 字段 `id,install_id,environment_id,canonical_path,name,sources`，source 使用 A1 ProjectRef。

- [x] 在真实多 Profile projects.db 中写测试：同环境同目录聚合但保留两个来源；相同路径不同环境是不同项目；修改 / 删除只作用于明确目标来源，不因聚合 ID 写错库。

```python
one = index.register(install_id="host", environment_id="local", canonical_path="/work/book",
    registration_profile="writer", source_project_id="p1", name="小说")
two = index.register(install_id="host", environment_id="local", canonical_path="/work/book",
    registration_profile="reviewer", source_project_id="p2", name="小说")
remote = index.register(install_id="host", environment_id="ssh-other", canonical_path="/work/book",
    registration_profile="ops", source_project_id="p3", name="小说")
assert one.id == two.id and one.id != remote.id
assert len(index.list_sources(one.id)) == 2
```

测试里的 `index = SharedProjectStore(tmp_path / 'shared-state.db')`；路径规范化由实际执行环境提供，Windows 路径行为在 Windows lane 测试，禁止伪造 sys.platform。此测试比较身份关系，不固定 ID 算法。

- [x] 用现有项目创建逻辑产生真实注册记录，再建立共享索引；唯一键由安装 / 环境 /规范路径组成。新项目明确指定可访问宿主；旧项目来源保留不可变映射；建立索引不迁移或复制用户项目文件。
- [x] 前端打开项目状态按共享项目身份与窗口保存；会话目标 Profile 不由项目选择推断。保留无项目普通对话；文件树只显示用户打开的项目，不枚举全部 Profile 目录。
- [x] 添加项目 selector Vitest：选择小说项目后换 A/B，项目保持；换项目不暗改专家；变更已执行会话 cwd 走显式 generation 更新，不能重写旧 prompt。
- [x] 执行 `scripts/run_tests.sh tests/hermes_cli/test_projects_shared.py tests/tui_gateway/test_conversation_projects.py tests/tui_gateway/test_projects_rpc.py tests/tui_gateway/test_project_tree.py`；在桌面运行 `npx vitest run src/store/projects.test.ts src/store/open-projects.test.ts src/app/chat/composer/project-selection.test.ts`。

## Task 2: B2 — 旧 session 渐进接入与阻止旁路写入

**Files:** 新 `tui_gateway/conversation_migration.py`、`tests/tui_gateway/test_conversation_migration.py`；扩展 A1 store / A3 binding、`contracts/conversations.py`；桌面新 `app/chat/conversation-migration.ts` 与 `.test.ts`。

**Interfaces:** `adopt_session(server, *, source_profile: str, lineage_id: str, conversation_id: str, input_id: str) -> MigrationReceipt`；receipt 字段 `migration_id,conversation_id,source_profile,source_lineage_id,source_cutoff_row_id,status`。状态 `preparing/importing/complete/failed`；RPC `conversations.adopt` 返回 receipt，重试相同 input_id 恢复同一迁移。

`conversations.adopt` 参数固定为 `source_profile,lineage_id,conversation_id,input_id`，handler 先从当前认证连接验证 source owner，禁止客户端提交任意磁盘 DB 路径；结果 `{migration: MigrationReceipt}`。迁移状态查询复用 `conversations.get` 返回 `migration` 可选字段，未迁移为 None。

- [x] 在真实 state.db 建旧对话（user/assistant/hidden tool 三类消息），写两项行为测试：多次迁移只有一个容器且隐藏内容不公开；迁移后旧客户端直接 prompt 被拒绝并返回容器位置。

```python
first = adopt_session(server, source_profile="writer", lineage_id=old_sid,
    conversation_id="c1", input_id="migration-1")
again = adopt_session(server, source_profile="writer", lineage_id=old_sid,
    conversation_id="c1", input_id="migration-1")
assert first.conversation_id == again.conversation_id
assert public_message_ids == imported_source_message_ids
assert secret_tool_output not in public_text
assert old_submit_error["data"]["conversation_id"] == "c1"
```

上述 source/public ID 集合由真实行映射读取，不能仅按文本去重；`old_submit_error` 直接调用正式 prompt handler 获得，测试同时验证查看旧历史仍可用。

- [x] 迁移接纳时检查 canonical Bot Chat、群聊用途、活跃用户轮及后台 delegations；受管理或仍执行的源不抢占。可等待任务结算后重试，不终止用户后台工作。
- [x] 锁定源写入和稳定行截止点；写 preparing 标记及迁移 ID，再按来源行 ID 投影可见内容与附件。崩溃重试从已导入映射继续。复用原内部 session 时完成 A3 fence；不兼容的来源保持独立旧记录并新建内部 session，不保留两条写入途径共用同一 history。
- [x] 原 owner 与 lineage 保留；新可见容器原专家 participant 接收游标按实际源记录建立，不能把未导入内容标成已读。未导入的私人历史不得通过后台摘要重新泄漏。
- [x] 前端旧链接解析到迁移回执给出的新 route；不破坏 CLI 的查看 / 导出；迁移失败可继续读取旧历史并恢复，不删除源 DB。功能回退仅切 UI /路由，已受管理源不得重新裸写。
- [x] 跑新测试、`test_hosted_room_prompt_fence.py`、`test_delegation_session_lifecycle.py` 及新的 Vitest；分别模拟标记后、导入一半、完成但客户端未收确认三处中断。

## Task 3: B3 — 容量、长内容、归档与完整恢复

**Files:** 新 `gateway/hosted_room_conversation_content.py`、`hermes_cli/conversation_backup.py`；修改 `gateway/hosted_rooms.py`、A1 store、A5 publication、`hermes_cli/backup.py`、`hermes_cli/config_defaults.py` 及相关 schema/docs；新 `tests/gateway/test_conversation_retention.py`、`tests/hermes_cli/test_conversation_backup.py`。

**Interfaces:** `ConversationContentStore(db_path: Path).put(data: bytes, mime_type: str) -> ContentRef`、`.read(content_id: str) -> bytes`；`ContentRef` 字段 `id,sha256,size_bytes,mime_type`。`archive(conversation_id: str, expected_revision: int) -> ConversationRecord`；`create_conversation_snapshot(root: Path, destination: Path) -> SnapshotManifest`、`verify_conversation_snapshot(path: Path) -> SnapshotManifest`。manifest 必须含 schema/protocol、每个 DB 与附件 hash、Profile/lineage/receipt 依赖及公开事件截止。

扩展 `contracts/conversations.py`：`conversations.archive {conversation_id,expected_revision}` 返回 `{conversation}`；`conversations.content {conversation_id,content_id,offset_bytes,limit_bytes}` 返回 `{data_base64,next_offset,has_more,sha256}`，先验证内容属于该会话且当前连接有权读它，再分页读取二进制内容。完整导出在有权访问的后端生成包并经既有下载路径取回，不把本机任意绝对路径交给远端客户端。分页仅针对产物 /记录，不用于必须完整加载的系统指令或技能。

- [x] 测试大于当前 64 KiB 的回答完整往返、多页历史归档后仍可读、配额不足时输入尚未被接受。测试按行为构造长文本，不固定实现计数。

```python
text = "完整长答案" * 20000
ref = content.put(text.encode("utf-8"), "text/plain; charset=utf-8")
assert content.read(ref.id).decode("utf-8") == text
store.archive("c1", expected_revision=revision)
assert all_before_archive == read_all_pages("c1", include_archived=True)
```

`read_all_pages` 在测试内以 cursor 循环调用 A1 events，直到 has_more=False；检查 cursor 严格前进。不得拿一页等同完整历史。

- [x] 保留群聊旧限额；conversation 单独计量。建议初始配置放 `conversations.storage`：活动数 2000、每会话事件数 100000、共享内容总预算 1 GiB、每会话 256 MiB、单内容 16 MiB；全部是可调非密钥 YAML 设置。逻辑预算计入独立内容及附件引用占用，另检查真实磁盘空间。接近上限提示归档 /导出，拒绝新接纳而不删历史。负数 /无穷 /过大异常配置明确拒绝。默认值是本计划的可调整工程起点，最终须记录压力验证结果。
- [x] 用同共享库内容表保存长文本 /附件 durable 引用与 hash，复用已有附件 staging；不可把永久正文放进可能清理的临时 cache 后只留一条路径。事件保留小引用，不绕过总配额。附件正文不得重复无限复制到每个 Profile。
- [x] 归档仅改用途状态，不走 disband / retired cleanup；真实删除需明确用户操作且与执行停止协调，保留必要墓碑阻止旧 ID 重用。此任务不新增自动清理用户普通聊天的计划。
- [x] Quick / pre-update / full backup 都包含 root `shared-state.db`、所引用的 Profile 库、必需的摘要/输入回执/附件；按真正 root 定位，不能在一个 Profile home 内创建孤立的共享备份。复用 SQLite backup API，不复制 live WAL 配对。恢复先校验到 staging，再按已有恢复规程替换，失败保留原数据。
- [x] 一致性策略：阻止新容器接纳及相关写入，等当前 DB 事务结束，按固定库顺序建立快照；由临时维护栅栏协调所有新容器写入方，超时显式失败而不打包半套。恢复清单校验每条 session/receipt/content 依赖存在；备份期间的原有非容器任务不得误停。不能把几次互不协调的 SQLite backup 称为跨库原子快照。
- [x] 进程重启后不恢复旧活跃 lease 或重放旧执行授权。恢复的 indeterminate 任务先对账；Profile memory/密钥仍按既有备份选项处理，不因公共记录存在而公开。
- [x] 跑 `scripts/run_tests.sh tests/gateway/test_conversation_retention.py tests/hermes_cli/test_conversation_backup.py tests/hermes_cli/test_backup.py tests/hermes_cli/test_backup_all_profiles.py tests/hermes_cli/test_backup_stability.py`。从 fresh temp HOME 实际恢复 G/A/B 对话并继续发送，不能只验证 zip 中有文件名。

## Task 4: B4 — 统一历史与 Agent Hub 唯一管理入口

**Files:** 修改 `apps/desktop/src/app/chat/sidebar/index.tsx`、`profile-switcher.tsx`、`app/profiles/index.tsx`、`app/profiles/workspace-controls.tsx`、`plugins/hermes-bots/plugin.tsx`、`app/routes.ts`、`app/contrib/surfaces.tsx` / `wiring.tsx` 和各自已有测试；新 `app/chat/sidebar/conversation-list.tsx`、`conversation-list.test.tsx`；i18n 全语言同步；更新 `apps/desktop/DESIGN.md`、`docs/aino-platform-user-guide.md`。

**Interfaces:** 统一列表 row 使用区分联合，`kind='conversation'` 绑定 conversationId，`kind='legacy_session'` 保留精确 owner/session 引用；不要往原 `session_id` 字段塞 room ID。Agent Hub 专家配置复用原 Profile 组件，但主导航不再出现两个管理同一对象的入口。

```typescript
export interface ConversationListRow {
  kind: 'conversation'
  conversationId: string
  title: string
  projectId: string | null
}
export interface LegacySessionListRow {
  kind: 'legacy_session'
  sessionId: string
  connectionId: string
  profile: string
  title: string
}
export type OrdinaryChatRow = ConversationListRow | LegacySessionListRow
```

- [x] 写交互测试：全局普通历史可见、项目筛选不随专家变化、旧会话打开保持 owner；Bot Chat 仍隐藏于普通列表且机器人入口始终打开 canonical Chat。
- [x] 把当前 Profile 管理配置组件接入 Agent Hub 的专家详情，普通“工作区”导航退出日常流程；不删除 CLI 的 Profile 管理能力。原 `/profiles` 链接重定向到 Agent Hub 配置位置，测试返回导航和快捷键。
- [x] 统一“新建会话”入口：不继承当前浏览的任意 Profile，固定 default general 运行身份；项目选择使用 B1；默认列表聚合新 conversation 和未迁移普通 session，不能把群聊、隐藏 plumbing 或临时子代理当新会话露出。
- [x] 添加低认知负担的界面说明：“项目整理资料与任务；智能体决定本轮由谁处理。”用户路径不出现 shared-state、generation、Profile DB 等实现词汇；高级诊断可保留技术信息。
- [x] 跑相关 sidebar/Profile/routes 测试以及 `src/plugins/hermes-bots/canonical-chat-registry.test.ts`、`bot-row-opens-canonical-chat.test.ts`、`hide-bot-chats.test.ts`、`src/app/chat/sidebar/chat-sidebar.integration.test.tsx`。更新旧“工作区”测试所断言的产品行为，不用删除失败测试代替兼容。

## Task 5: B5 — 能力协商、默认启用与最终交付

**Files:** 扩展 `contracts/conversations.py`、`hermes_cli/config_defaults.py`、桌面 capability routing；新增 `docs/implementation/aino-multi-agent-conversations-acceptance.md`、`website/docs/user-guide/desktop-conversations.md`；更新相关 AGENTS 文档的普通会话导航说明，但不改变 canonical Bot Chat 的约束。

**Interfaces:** `conversations.capabilities` 是真实服务端能力结果，不能仅依据前端版本。启用配置 `conversations.enabled` 默认在 G1–G4 通过前为 false；测试环境显式开启。协议不支持、执行环境不兼容时清晰保留原模式，不伪装已运行新功能。

- [x] 做新 UI +无新 API 后端兼容测试，用户仍可用旧会话；新 UI +新后端完整功能；旧 UI 与新后端不混入 conversation rows、不允许直接写受管理 session。
- [x] 同安装运行的 Hosted 所有者需升级到支持用途区分的版本后才启用新存储。旧二进制任意降级不作为兼容承诺；回退 UI 时保留可读新 schema 的后端，禁用创建新容器但保留新历史读取 /导出。禁止在后台已有新任务时切回不识别新用途的 driver。
- [x] 用真实桌面及临时 HOME 验证全矩阵：五段切换、引用各专家观点、取消专家、子代理后台续答、实际工具、审批、停止、模型改配置后标签、无项目、两个项目、迁移旧历史、归档和完整恢复。
- [x] 执行改变范围对应的 Python 和 JS 检查。A/B 所有新测试、原 groups/Bot Chat/Profile/project/delegation/backup 回归、生成契约、类型与 build 必须通过；再依据 `scripts/ci/classify_changes.py` 当前真实规则运行将受影响的 CI lanes。重大共享运行时修改需完整 `scripts/run_tests.sh` 最终回归；不把重试通过的文件忽略，记录并处理。完整回归 49,509 通过、1 项测试竞态失败、590 跳过；修正该测试后相邻 35 项和独立复测 13 项通过，无重试。本机未具备的 Docker/Nix 及其他 OS lanes 明确留在验收覆盖边界。

```bash
scripts/run_tests.sh
npm run test --workspace apps/desktop
npm run typecheck --workspace apps/desktop
npm run build --workspace apps/desktop
git diff --check
```

- [x] E2E 按 A10 的真实后端配置运行，至少当前 macOS 主机实测；OS 差异按原 CI marker 在实际 Windows/Linux runner 验证，不伪装平台。未实测拓扑明确列出，不扩张功能支持声明。
- [x] 全部 G1–G4 通过后才将新建普通会话切为新流程。最终 acceptance 记录提交、测试命令与结果、UI证据、迁移 /恢复结果及准确未覆盖项；不复用旧 174 通过数当本功能验收。默认已开启，省略配置的真实桌面 17 场景通过，显式关闭及兼容拒绝亦有覆盖。
- [x] 聚焦最后 diff，确认没有无关仓库迁移、自动化任务、真实密钥或用户数据变更。形成可审阅交付，再按用户授权处理提交 /推送 /发布；本计划没有自动生产部署步骤。

## 最终完成判据

用户无需普通聊天 Profile 切换即可在项目中使用不同专家或通用助手；公开上下文与作者连续、私有配置独立、自动子代理能力保持、数据可恢复、原 Agent Hub 与其他入口通过回归。任何一项欠缺，整体任务都不能标为完成。
