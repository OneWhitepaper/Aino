# Aino 多智能体会话运行闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隔离数据中交付可验证的通用 → A → B → 通用 → A 桌面闭环，同时保留自动子代理、真实工具及取消恢复。

**Architecture:** Hosted Rooms 继续拥有公共记录和执行账本；新增具体 conversation 策略与按 generation 的成员绑定。输入先落入参与者 Profile 的真实历史并生成回执，再推进公共上下文覆盖记录。桌面使用独立可见会话路由，运行事件仍绑定实际 session。

**Tech Stack:** Python、SQLite、Pydantic JSON-RPC、React、nanostores、Vitest、既有 Electron E2E。

**Spec:** [已确认架构](../specs/2026-09-20-aino-multi-agent-conversations-design.md)；必须先读[总计划](2026-09-20-aino-multi-agent-conversations.md)。

## Global Constraints

- 总计划全部约束适用；A 是测试环境纵向交付，不能提前替代真实用户的普通会话入口。
- 每个内部 session 保留 Profile 身份与缓存；主执行者为 depth 0，不把专家 B 当成专家 A 的委派子节点。
- 普通 conversation 与现有 discussion 分别验证、规划、投影和发表；不得只替换 `plan_next_task`。
- 所有新函数、文件、RPC 名称均为下面任务将创建的接口；当前生产不具有这些 API。
- 涉及状态库、prompt 和 session 的改动用真实临时库与真实 imports；外部模型调用边界才可替换。
- 普通模型回答完成不等于后台委派结束。可见用户轮次、一次 driver 执行、后台 delegation 三种状态分别记录。
- 初期不增加新依赖；阶段 B 完成容量 / 备份之前，协议通过 `conversations.capabilities` 返回未默认开放。

## 文件责任图

路径以仓库根 `/Users/zizimutou/Protect/Aino` 为基准。

| 文件 | 责任 |
|---|---|
| 新 `gateway/hosted_room_conversation_types.py` | 窄数据类型：参与者、项目引用、提交记录、上下文 envelope |
| 新 `gateway/hosted_room_conversation_store.py` | 同 shared-state.db 的 conversation 元数据、绑定、输入范围、后台归属；不复制 driver |
| 新 `gateway/hosted_room_conversation_context.py` | 作者标注、未读引用、摘要覆盖与输入摘要 hash |
| 新 `gateway/hosted_room_conversation.py` | 指定回复者的具体策略，生成既有 driver payload 与公开结果 |
| 新 `tui_gateway/session_conversation_binding.py` | 容器管理标记、精确 Profile/session 绑定、直接写入阻止 |
| 新 `hermes_state_conversation_receipts.py` | Profile SQLite 事务中的输入幂等记录，连接真实消息落库 |
| 新 `tui_gateway/conversation_service.py` | 普通会话的提交、策略分派、读取、控制，复用 Hosted runtime |
| 新 `tui_gateway/conversation_notifications.py` | 后台结果与父会话续答的协调入口 |
| 新 `tui_gateway/contracts/conversations.py`、`methods_conversations.py` | 声明与接线，不在 handler 重写执行逻辑 |
| 新 `apps/desktop/src/store/conversations.ts`、`conversation-owner.ts` | 可见会话/草稿选择与精确后端 owner |
| 新 `apps/desktop/src/app/chat/conversation-actions.ts`、`conversation-view.tsx` | 可见会话操作与视图组合 |
| 新 `apps/desktop/src/app/session/hooks/use-message-stream/conversation-events.ts` | 按 conversation / turn 投影已有 session 事件 |
| 新 `apps/desktop/src/app/chat/composer/expert-selector.tsx` | 下拉与结构化 @ 同一选择状态 |

## Task 1: A1 — 用途隔离、参与者绑定与事件存储

**Files:** 新建 `gateway/hosted_room_conversation_types.py`、`gateway/hosted_room_conversation_store.py`；修改 `gateway/hosted_rooms.py`、`tui_gateway/methods_groups.py`、`tui_gateway/contracts/groups_bot_relay.py`；测试 `tests/gateway/test_hosted_room_conversation_store.py`。

**Interfaces:** `ConversationStore(db_path: Path)`；`create(conversation_id: str, title: str, general: ParticipantRef, project: ProjectRef | None) -> ConversationRecord`；`get(conversation_id: str) -> ConversationRecord`；`bind_participant(conversation_id: str, participant: ParticipantRef) -> ParticipantBinding`；`append_input(conversation_id: str, submission: TurnSubmission) -> Admission`；`events(conversation_id: str, after_seq: int = 0, limit: int = 100) -> EventPage`。返回模型均在 types 文件定义，严格字段见下。

- [x] 读取 `gateway/AGENTS.md` 与 `tui_gateway/AGENTS.md`；新增不可变类型，公开字段不包含密钥、私有 Profile 配置。

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class ParticipantRef:
    participant_id: str
    install_id: str
    profile: str
    display_name: str
    is_general: bool = False

@dataclass(frozen=True)
class ProjectRef:
    install_id: str
    registration_profile: str
    project_id: str
    cwd: str
    execution_environment_id: str

@dataclass(frozen=True)
class TurnSubmission:
    turn_id: str
    input_id: str
    participant_id: str
    text: str
    attachment_ids: tuple[str, ...] = ()
```

`ConversationRecord` 字段：`conversation_id,title,general,project,revision,archived`；`ParticipantBinding` 字段：`conversation_id,participant,session_generation,lineage_id`（未建立时 lineage 为 None）；`Admission` 字段：`conversation_id,turn_id,input_id,event_id,seq,participant_id,idempotent`；`EventPage` 字段：`events,cursor,has_more`。events 为既有事件结构的 tuple。内部 DB 保存作者当时显示名及用户目标，与真实回复作者分别记录。

- [x] 写行为测试：同一输入重试返回同一个事件；同 ID 不同文本或目标拒绝；discussion 列表不混入 conversation。实际 SQLite 测试示例：

```python
import pytest
from gateway.hosted_rooms import RoomConflictError
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, TurnSubmission

def test_repeated_submission_cannot_change_recipient(tmp_path):
    store = ConversationStore(tmp_path / "shared-state.db")
    general = ParticipantRef("general", "host", "default", "Aino", True)
    store.create("c1", "小说", general, None)
    store.bind_participant("c1", ParticipantRef("a", "host", "writer", "作者"))
    first = store.append_input("c1", TurnSubmission("t1", "i1", "a", "设计人物"))
    replay = store.append_input("c1", TurnSubmission("t1", "i1", "a", "设计人物"))
    assert first.event_id == replay.event_id and replay.idempotent
    with pytest.raises(RoomConflictError):
        store.append_input("c1", TurnSubmission("t1", "i1", "general", "设计人物"))
```

- [x] 执行 `scripts/run_tests.sh tests/gateway/test_hosted_room_conversation_store.py`，确认新行为尚未实现而失败，再实现用途与元数据迁移。默认旧 room 为 discussion；所有旧 groups API 必须显式排除 / 拒绝 conversation。创建 room 与 conversation 元数据在同一事务，避免进程崩溃后误当群聊运行。
- [x] 新表只保存必要绑定 / 元数据；公共消息仍使用 `hosted_room_events`、执行仍用既有 driver。扩展允许的事件 actor/kind 与新用途校验，不放宽旧群聊 payload。普通归档不得调用 disband。
- [x] 跑上述测试及 `tests/gateway/test_hosted_rooms.py`、`tests/gateway/test_hosted_rooms_read_path.py`、`tests/tui_gateway/test_groups_methods.py`；聚焦审阅事务、用途过滤与重复 ID 冲突后结束此任务。

## Task 2: A2 — 带作者的上下文桥接与摘要覆盖

**Files:** 新 `gateway/hosted_room_conversation_context.py`、`tests/gateway/test_hosted_room_conversation_context.py`；扩展 A1 类型及存储；复用 `agent/auxiliary_client.py` 已有模型解析接口，不新增模型设置入口。

**Interfaces:** `build_turn_envelope(*, binding: ParticipantBinding, project: ProjectRef | None, request: TurnSubmission, history: tuple[PublicMessage, ...], coverage: ContextCoverage, input_cutoff: int, budget_bytes: int) -> TurnEnvelope`。执行者来自 `binding.participant`，generation 来自 `binding.session_generation`。`PublicMessage` 字段 `event_id,seq,author_id,author_label,text,reply_to_event_id`；`ContextCoverage` 字段 `received_event_ids,own_event_ids,summary_text,summary_through_seq,summary_source_ids`（ID 集合 frozenset，摘要空时 seq 为 0）；`TurnEnvelope` 字段 `text,input_digest,source_event_ids,through_seq,summary_through_seq`。覆盖按 generation 存储。

- [x] 写两类行为测试：A→B→A 只补缺少的公开消息且作者正确；超长输入只在摘要已持久化并可追溯时进入上下文，不静默截成最后 24 条。最小断言示例：

```python
assert returned_to_a.source_event_ids == ("b-answer",)
assert "审稿专家 B" in returned_to_a.text
assert a_own_answer not in returned_to_a.text
assert returned_to_a.through_seq <= frozen_input_cutoff
```

上述变量在测试中用 A1 类型创建 U/A/B 公开消息，A 的 `own_event_ids` 包含 A 答复，`received_event_ids` 包含 A 实际接收的输入；`frozen_input_cutoff` 固定为本轮输入前的最高 seq。当前用户请求独立拼入 envelope，不能再次作为历史重复注入。

- [x] 运行新文件证明失败；实现排序、作者边界、引用转义及 hash。规范化 hash 必须涵盖执行身份、generation、项目快照、输入截止和附件引用；文本中的同名标记不能修改真正路由。
- [x] 为超预算分支建立 `ConversationStore.save_summary(conversation_id, expected_revision, text, through_seq, source_ids)`，CAS 失败重新读取；摘要用已有辅助模型路由生成，无法摘要则明确返回上下文预算错误，保留输入草稿，不派发截断消息。摘要带作者和原文 event IDs；全量原文继续可分页取回。别把旧 discussion checkpoint 的 24 条投影当唯一历史。
- [x] `TurnEnvelope` 是下一条真实用户输入的数据，不写入 system；保留已有内部 session 的系统 / 工具前缀。新 generation 从明确摘要基线构建，不能继承旧已读游标。
- [x] 测试通过后加 `tests/gateway/test_hosted_room_discussion.py` 回归；审阅“缺少上下文时显式失败”和“摘要不冒充逐字原文”。

## Task 3: A3 — 内部 session、真实 cwd 与精确运行归属

**Files:** 新 `tui_gateway/session_conversation_binding.py`；对 `server.py` / `methods_session.py` 相关构建 / 恢复职责先提取为 `tui_gateway/session_runtime_config.py` / `session_creation.py`，原文件只保留已有注册入口；修改 `hosted_room_server_rpc.py`、`methods_prompt.py`、`session_auto_continue.py`、`session_workdir.py`；测试 `tests/tui_gateway/test_conversation_session_binding.py`。

**Interfaces:** `resolve_conversation_session(server, *, binding: ParticipantBinding, project: ProjectRef | None, source: str) -> RuntimeBinding`；`RuntimeBinding` 字段 `conversation_id,participant_id,session_generation,lineage_id,runtime_id,profile,source,model_snapshot`；`require_conversation_submission(session: dict, proof: object | None) -> None`。可信 proof 在进程内构造并由绑定 / lease 校验，不能由客户端 JSON 声称。

- [x] 先进行无行为变化的专题提取，修复 in-tree imports 及 docs 引用；回归 `test_hosted_room_server_rpc.py`、`test_custom_provider_session_persistence.py`、`test_hosted_room_prompt_fence.py`。先验证提取，再加新功能，不把 2000 行 facade 继续扩大。
- [x] 新增真实 Profile + cwd 测试：不同 Profile 的内部 session 在同一个测试项目中建成，数据库归属各自 Profile，来源 desktop；不可访问 cwd / 不同 terminal 环境明确拒绝。

```python
assert a_binding.profile == "writer"
assert b_binding.profile == "reviewer"
assert a_binding.runtime_id != b_binding.runtime_id
assert a_record["profile_home"] != b_record["profile_home"]
assert a_record["cwd"] == b_record["cwd"] == str(project_dir)
assert a_record["source"] == b_record["source"] == "desktop"
```

在测试文件内隔离 HOME 与 HERMES_HOME，创建 default / writer / reviewer 配置，通过真实注册的 `session.create` 和上述 resolve 函数建立记录。只替换模型 provider 调用，不替换 `_profile_home`、cwd 解析、SessionDB。无项目对话保存 None，不落到另一个专家的私人 cwd。

- [x] 内部会话以专用管理元数据标识，不用 `Bot Chat` 或 `Group:` 标题；配置恢复按普通 session 快照，不沿用 `room_plumbing/follow_profile_config`。新 generation 显式选择当前配置；恢复旧 generation 显示原解析模型。
- [x] 将 desktop surface 与 Hosted 管理标识解耦；同步修改 `_hosted_submit_error`、普通 auto-continue 排除、直接写入 fence。保留可信 proof、现有模型授权与 transport 检查；不把任意 desktop session 视作内部调用。
- [x] 不兼容隔离 worker 的部署能力返回 unavailable，不绕过其隔离设置；A10 覆盖至少当前实际支持的本地执行链。G5 仅允许通过能力验证的拓扑启用。
- [x] 验证 GUI session 在无 `HERMES_DESKTOP` 环境下仍解析桌面工具，普通 session / canonical Bot Chat 不受影响。把新文件与上述原文件回归跑绿后结束任务。

## Task 4: A4 — 真正持久化的输入回执与崩溃对账

**Files:** 新 `hermes_state_conversation_receipts.py`、`tests/hermes_state/test_conversation_input_receipts.py`、`tests/tui_gateway/test_conversation_input_recovery.py`；修改 `hermes_state_messages.py`、`hermes_state.py` 仅注册 sibling、`agent/session_persistence.py`、A3 binding 模块及 `tui_gateway/prompt_turn.py` 的输入接纳调用点。

**Interfaces:** 在 SessionDB 专题 mixin 提供 `accept_conversation_input(session_id: str, *, input_id: str, input_digest: str, message: dict, conversation_id: str, participant_id: str, session_generation: int) -> InputReceipt` 与 `get_conversation_input_receipt(input_id: str) -> InputReceipt | None`；`InputReceipt` 字段 `input_id,input_digest,session_id,message_row_id,idempotent`。共享库 `ack_input(conversation_id, participant_id, session_generation, receipt, source_event_ids, through_seq)` 只在收到真实 receipt 后调用。

- [x] 在真实 SQLite 上写重复 / 冲突测试和跨库中断测试，先运行证明失败。receipt 与目标 user 行必须同事务提交，不能以 turn marker 或 RPC accepted 代替。

```python
first = db.accept_conversation_input(sid, input_id="i1", input_digest=digest,
    message={"role": "user", "content": envelope}, conversation_id="c1",
    participant_id="a", session_generation=1)
replayed = db.accept_conversation_input(sid, input_id="i1", input_digest=digest,
    message={"role": "user", "content": envelope}, conversation_id="c1",
    participant_id="a", session_generation=1)
assert first.message_row_id == replayed.message_row_id
assert replayed.idempotent
assert len([m for m in db.get_messages(sid) if m["role"] == "user"]) == 1
```

测试 setup 用 `SessionDB(tmp_path / 'state.db')`、真实 `create_session` 创建 sid；digest 用 hashlib 对测试 envelope 求值。事务故障通过注入提交边界处失败实现，不改 SQLite 私有全局状态。

- [x] 把已写入 message 的稳定行 ID 接入正常 flush，避免轮末再次 append 同一 user；保留 `api_content` / display content 分离及压缩前缀处理。不得按纯文本相等去重。
- [x] 模拟 Profile commit 后共享库 ACK 前崩溃：重启先查目标 receipt，补 ack，不重新加入用户消息；receipt 存在但模型是否已运行不确定时走 driver recovery，不把“输入只写一次”误当“外部行为只执行一次”。
- [x] 取消后 history 尾部未闭合时，复用既有恢复 / alternation 路径，然后才接纳新输入；compaction 改变 live tip 仍能用 lineage + input ID 找到 receipt。
- [x] 跑新文件与 `tests/hermes_state/test_append_messages_batch.py`、`tests/agent/test_api_content_sidecar.py`、`tests/agent/test_api_content_row_addressed_backfill.py`。此任务通过才允许真实模型接入。

## Task 5: A5 — 指定执行者策略、RPC 与终态发表

**Files:** 新 `gateway/hosted_room_conversation.py`、`tui_gateway/conversation_service.py`、`methods_conversations.py`、`contracts/conversations.py`、`tests/gateway/test_hosted_room_conversation.py`、`tests/tui_gateway/test_conversations_methods.py`；修改 `hosted_room_service.py`、`hosted_room_driver.py`（两目录的专题模块）、`contracts/__init__.py`、方法注册表；生成 TS / OpenRPC 文件。

**Interfaces:** `ConversationService(server, *, db_path: Path)`；方法与协议表一致；内部 `plan_conversation_turn(record: ConversationRecord, binding: ParticipantBinding, submission: TurnSubmission, admission: Admission, envelope: TurnEnvelope) -> ConversationTurnPlan`。`ConversationTurnPlan` 是 types 文件内 dataclass，字段 `identity: driver.TaskIdentity`、`payload: dict`、`binding: ParticipantBinding`、`envelope: TurnEnvelope`；payload 的 `source_event_seq` 来自 admission。提交用既有 `admit_task` 的窄 payload，不塞未声明字段。

| RPC | 输入 | 结果 |
|---|---|---|
| `conversations.capabilities` | 空 | `protocol_version,enabled,reason,supported_execution_environments` |
| `conversations.create` | `conversation_id,title,general_participant_id,project_ref` | `conversation` |
| `conversations.list` | `cursor,limit,project_ref,include_archived` | `conversations,cursor,has_more` |
| `conversations.get` | `conversation_id` | `conversation,participants,active_turn,pending_delegations` |
| `conversations.send` | `conversation_id,turn_id,input_id,participant_id,text,attachment_ids,expected_revision` | `admission` |
| `conversations.events` | `conversation_id,after_seq,limit` | `events,cursor,has_more` |
| `conversations.stop` | `conversation_id,turn_id,execution_generation,include_delegations` | `status`（requested / confirmed / not_found） |
| `conversations.retry` | `conversation_id,turn_id,input_id,expected_generation` | `admission`，不确定状态只返回 reconciliation_required |

所有可选字段明确默认；客户端不能提交完整任意 Profile 路径或可信 proof。审批 / 澄清用原 server-request ID，A7 建立绑定。公开 participant catalog 从现有 profiles/Agent Hub roster 按实际可用环境生成，绝不信任显示名做路由。

- [x] 加实际 handler 契约测试：未知字段拒绝、重复 input 幂等、正在运行时下一次用户 send 返回 busy 并保留草稿、目标失效不自动改 general。重复 input 先检查原 payload 一致性再返回原 admission，不因旧 expected_revision 误拒绝合法网络重试；只有新输入才做 revision/busy 判定。

```python
request = {"conversation_id": "c1", "turn_id": "t1", "input_id": "i1",
           "participant_id": "a", "text": "继续", "attachment_ids": [],
           "expected_revision": revision}
accepted = call("conversations.send", request)
replayed = call("conversations.send", request)
assert accepted["admission"]["event_id"] == replayed["admission"]["event_id"]
```

`call` 是该测试文件本地适配器 `lambda name, params: server._methods[name]("test", params)["result"]`，setup 使用已注册的真实 server 与临时 conversation 数据；错误测试直接检查原 error envelope，不吞掉异常。

- [x] 用按用途的固定策略表接入验证、prepare、checkpoint、发表四处。旧 discussion 仍走原实现；conversation 用 A2/A4，水位不放进旧 `(thread,member)` 结构而缺失 generation。
- [x] task 身份用稳定输入 ID 派生，driver `thread_id` 只表示该 room 的执行线程，不写入消息平台 session thread_id。派发仍用 `target_profile,prompt,source_event_seq,target_member_id`；其余 metadata 放绑定表由身份查回。
- [x] terminal receipt →公开回复按 task + execution generation 去重；超 64 KiB 的正文使用完整存储引用，不把群聊截断文本误存为完整答复。细粒度存储 / 配额由 B3 扩展，但 A 中必须明确标示大文本未支持并拒绝冒充完整结果。
- [x] 执行 `python scripts/gen_gateway_contracts.py`（使用项目 venv），然后 `scripts/run_tests.sh tests/tui_gateway/contracts/test_generated.py tests/tui_gateway/test_conversations_methods.py tests/gateway/test_hosted_room_conversation.py tests/tui_gateway/test_hosted_room_service.py`。确认契约源唯一且旧 groups 回归通过。

## Task 6: A6 — 自动子代理与后台通知续答

**Files:** 新 `tui_gateway/conversation_notifications.py`、`tests/tui_gateway/test_conversation_notifications.py`；修改 `session_notifications.py`、`session_lifecycle.py`、`session_reaper.py`、A1 store；在现有 `tools/delegate_tool_dispatch.py` 的实际后台分派处记录归属，不修改模型委派策略。

**Interfaces:** `capture_conversation_delegation(session: dict, delegation_id: str) -> None`；`route_conversation_notification(sid: str, session: dict, event: dict, text: str) -> bool`（False 仅表示非容器 session，应继续原路径）；共享库 `admit_continuation(conversation_id, origin_turn_id, participant_id, session_generation, notification_id, text) -> Admission`。续答生成新的执行 task，保留原逻辑 turn 与 delegation 关系。

- [x] 写 A 发起后台任务、前台改选 B、A 结果完成的行为测试：通知只接纳一次；续答回 A；正在运行的 B 不被打断；下轮选择不被改回 A。

```python
assert continuation.participant_id == origin.participant_id
assert continuation.origin_turn_id == origin.turn_id
assert continuation.notification_id == completion["event_id"]
assert visible_draft.participant_id == "b"
assert len(admitted_for_completion) == 1
```

测试用 `test_delegation_session_lifecycle.py` 的 registry 清理方式；completion 来自实际 async delegation 的确定性子任务。`continuation` / `origin` 为 A1/A5 实际持久记录；前端 draft 的断言放对应 Vitest 场景，不在 Python 读取 TS 状态或源码。

- [x] 在 `_notif_dispatch_event` 的普通 claim/submit 之前分流：持久化通知接纳再确认消费；失败释放 claim。不要让原 `_notif_submit` 与 driver 同时运行一次通知。
- [x] 后台来源保存到持久绑定，不依赖 `_hosted_room_task` 在父轮 finally 之后仍存在。终端后台完成、Kanban、loop 等进入同一 session 的既有入口同样分流；真正独立 cron/session 保持原路径。
- [x] 控制顺序：前台只一个执行；通知 ready 后按公共事件顺序创建 A 的续答，与新用户输入用相同接纳锁排序。公开显示归属 A 的后台结果，不自动替换 B 的选择。
- [x] 运行 `scripts/run_tests.sh tests/tui_gateway/test_conversation_notifications.py tests/tui_gateway/test_delegation_session_lifecycle.py tests/tui_gateway/test_kanban_notify_poller.py tests/tools/test_async_delegation.py tests/gateway/test_async_delegation_session_binding.py`；验证非容器 session 不受影响。

## Task 7: A7 — 流式、审批、子代理树、精准停止与恢复

**Files:** 修改 `tui_gateway/hosted_room_member_activity.py`、`methods_subagents.py`、`server_requests.py` 的专题接线、A5 contracts/events；新 `tests/tui_gateway/test_conversation_activity.py`、`test_conversation_stop_recovery.py`；扩展 store 的 pending actions 绑定。

**Interfaces:** 活动坐标固定为 `conversation_id,turn_id,participant_id,session_generation,task_id,execution_generation,runtime_id`；持久事件以 seq 重放，实时 delta 用独立 stream sequence。pending request 仍用原 `request_id`，不能从客户端 ID 构造额外权限。

- [x] 先写 late event + stop 测试：停止 A 已确认、B 开始后 A 的迟到 delta 不进入 B；对 A 停止不能误停同 Profile 另一会话的 delegation。

```python
assert late_event["turn_id"] == stopped_turn_id
assert b_turn["status"] == "running"
assert b_turn["text"] == text_before_late_event
assert unrelated_delegation.is_running()
```

测试使用两个真实 session +受事件控制的模型边界，使用 threading.Event 同步而非毫秒睡眠；停止返回 requested 时 UI 仍显示 stopping，confirmed 才结束该执行。

- [x] 扩展活动投影支持子代理 start/progress/complete 与对应可视控制，clarify/sudo/secret/vault 等原 server requests 经精确内部 session 路由；保留原超时及授权队列，不统一自动批准。
- [x] 根据 delegation IDs 精确取消后台单位；不能仅依赖父 `_active_children`，也不能以宽泛 `interrupt_for_session` 的 OR 条件终止无关任务。停止 fence 覆盖随后到达的续答，迟到结果可保留但不唤起模型。
- [x] 重连读取公共分页 +原 pending request +实际子代理 snapshot；父轮结束不丢子代理树。进程退出后标记仍在后台的任务 interrupted/indeterminate，不冒称可恢复运行。
- [x] 跑新测试及 `test_hosted_room_member_activity_hook.py`、`test_subagent_snapshot.py`、`test_hosted_room_driver_runtime.py`、`test_hosted_room_settled_retry.py`；检查流式最终只发表一次。

## Task 8: A8 — 前端可见会话状态与精确 owner

**Files:** 新 `apps/desktop/src/store/conversations.ts`、`conversation-owner.ts` 及同名 `.test.ts`；新 `app/chat/conversation-actions.ts`、`app/session/hooks/use-message-stream/conversation-events.ts` 及 `.test.ts`；修改 `app/routes.ts` / route tests，仅增加独立 conversation 路由。

**Interfaces:**

```typescript
export interface ConversationDraft {
  conversationId: string
  selectedParticipantId: string
  text: string
  attachmentIds: string[]
  revision: number
}

export interface ConversationOwner {
  conversationId: string
  connectionId: string
  installId: string
}

export interface FrozenConversationSend {
  conversationId: string
  participantId: string
  text: string
  attachmentIds: readonly string[]
  expectedRevision: number
  inputId: string
  turnId: string
}

export function freezeConversationSend(draft: ConversationDraft,
  ids: { inputId: string; turnId: string }): FrozenConversationSend {
  return Object.freeze({
    conversationId: draft.conversationId, participantId: draft.selectedParticipantId,
    text: draft.text, attachmentIds: Object.freeze([...draft.attachmentIds]),
    expectedRevision: draft.revision, ...ids
  })
}
```

生产运行 schema 使用生成契约，以上是 renderer 草稿与冻结快照形状；新 store 只缓存服务端记录，不在 localStorage 保存唯一公共历史。

- [x] Vitest 先写快照行为：冻结 A 后草稿改 B，原提交仍指向 A，附件数组不受草稿变更影响；两个可见会话的选择独立。

```typescript
const sent = freezeConversationSend(draft, { inputId: 'i1', turnId: 't1' })
draft.selectedParticipantId = 'b'
draft.attachmentIds.push('later-file')
expect(sent.participantId).toBe('a')
expect(sent.attachmentIds).not.toContain('later-file')
```

- [x] 新 `/conversations/:id` 路由单独解析，旧 `routeSessionId` 不把此 ID 当 runtime；store session 原变量含义不变。发送 / stop 用捕获 owner，不调用 `selectProfile/newSessionInAgent` 改全局。
- [x] 投影 public event 按 event_id/seq 幂等合并；实时流按 activity 坐标写入对应 turn，再与持久最终事件对账。切换页面仅改变前景订阅，不夺取 background owner。
- [x] `conversations.stop` requested 阶段禁止乐观清空 busy；服务 unavailable / target removed / revision conflict 保留草稿并明确错误，不改用 general。
- [x] 在 `apps/desktop` 下运行 `npx vitest run src/store/conversations.test.ts src/store/conversation-owner.test.ts src/app/session/hooks/use-message-stream/conversation-events.test.ts src/store/session-request-router.test.ts`；检查链接 / session route 回归。

## Task 9: A9 — 聊天界面、专家选择、附件与作者回顾

**Files:** 新 `app/chat/conversation-view.tsx`、`composer/expert-selector.tsx` 及 `.test.tsx`；修改 `app/chat/index.tsx`、`composer/index.tsx`、`composer/contrib.ts`、对应 message rendering 的专题组件；i18n `types.ts` 与全部当前语言模块；复用已有 Profile roster 与配置页。

**Interfaces:** `ExpertSelectorProps { conversationId: string; participants: ParticipantOption[]; disabled?: boolean }`；`ParticipantOption { id: string; displayName: string; isGeneral: boolean; unavailableReason?: string }`。渲染消息从公开 events 生成，工具 / 审批 / 子代理详情通过 A7 坐标绑定；不把一个内部 session 的 messages 充作全部历史。

- [x] React Testing Library 测试同一 conversation 下“选择 A →取消→general→再选 A”，点击选择不创建新可见会话、不清空 history；仅下一次发送变目标。`@` menu 与下拉写同一个 atom，原 Bot mention middleware 对此草稿不再二次注入。

```typescript
await user.click(screen.getByRole('button', { name: '选择回复者' }))
await user.click(screen.getByRole('option', { name: '小说专家 A' }))
expect(screen.getByText('此前的公开回答')).toBeVisible()
await user.click(screen.getByRole('button', { name: '取消专家选择' }))
expect(screen.getByRole('button', { name: '选择回复者' })).toHaveTextContent('通用 Aino')
```

测试 fixture 通过 A8 store 写入 conversation 和 participants，使用真实组件；按钮字符串通过当前测试 locale 提供，不在生产硬编码中文。补键盘选择、focus、禁用原因。

- [x] UI 明确本轮作者、所用模型、工具状态和后台任务来源。已有 session 显示实际模型快照；专家改名保留旧署名，同名用来源区分。通用助手选择固定 general ID，不用当前活跃 Profile 回退。
- [x] 附件上传走当前会话所属 host 的既有 staging，再按本轮实际内部 session 绑定；失败不发表假附件。只共享用户可见附件引用，不能从另一个 Profile 任取磁盘路径。
- [x] `ChatBar` 提取必要的输入/发送回调接口后复用，不复制整个 composer；不把控制器堆入 `chat/index.tsx`。普通 session 的现有快捷键 / slash 路径保持原样；新会话的 slash 根据实际所选内部 session 的命令能力执行，身份变更命令在明确轮次边界更新 generation。
- [x] 跑新组件测试与 `src/app/chat/composer/project-selection.test.ts`、`src/app/chat/composer/status-stack/subagent-controls.test.tsx`、`src/app/chat/composer/status-stack/subagent-hydration.test.tsx`；类型检查 `npm run typecheck`。A 阶段通过能力与测试入口进入，默认“新建”仍保留原行为。

## Task 10: A10 — 真实链路闭环与阶段验收

**Files:** 新 `tests/tui_gateway/test_conversation_e2e.py`、`apps/desktop/e2e/multi-agent-conversation.spec.ts`；复用 `apps/desktop/e2e/fixtures.ts`；新增结果记录 `docs/implementation/aino-multi-agent-conversations-core-acceptance.md`。

**Interfaces:** 测试调用 A5 正式 RPC，真实 Python backend +临时多 Profile；模型服务用本机确定性 provider（仅替换外部 API边界）。桌面真实启动并连接此 backend，不能只调用 `setupMockBackend` 就宣称链路通过。

- [x] 构造 default、writer、reviewer 三个真实临时 Profile，SOUL 和模型名各不同、同一个临时项目有规则和可读文件；模拟模型按收到的工具 schema 与上下文输出可验证结果。
- [x] 完整流程：G/A/B/G/A，每轮提交 unique ID，验证仅一个可见 conversation；三份内部 lineage；项目 cwd 不变；A 第二次实际输入有 B 的新内容且无重复 A 回答；通用助手能按 event ID/作者对应历史。
- [x] 模型 A 发起真实 `delegate_task` 的确定性子任务；在等待期间把下轮目标改为 B，验证 A 子结果归属、后续协调任务、事件去重、停止及费用归属。子代理 registry 不是预填 fake 列表。
- [x] 对接纳后断线、Profile commit 后共享 ACK 前崩溃、停止未确认、输入预算不足、模型配置改动、已选专家删除逐一验证。与目标 generation 不符的事件不污染当前视图；旧 history 保留可读。
- [x] 执行下列关卡；失败定位后仅对受影响范围重跑。真实 UI 操作检查选择 / 取消、项目树、工具审批、子代理树、重连和历史作者。

```bash
scripts/run_tests.sh tests/gateway/test_hosted_room_conversation_store.py tests/gateway/test_hosted_room_conversation_context.py tests/gateway/test_hosted_room_conversation.py tests/tui_gateway/test_conversation_e2e.py
scripts/run_tests.sh tests/tui_gateway/test_conversation_session_binding.py tests/tui_gateway/test_conversation_input_recovery.py tests/tui_gateway/test_conversation_notifications.py tests/tui_gateway/test_conversation_activity.py tests/tui_gateway/test_conversation_stop_recovery.py
scripts/run_tests.sh tests/gateway/test_hosted_rooms.py tests/gateway/test_hosted_room_driver.py tests/gateway/test_hosted_room_discussion.py tests/tui_gateway/test_hosted_room_service.py tests/tui_gateway/contracts/test_generated.py
npm run typecheck --workspace apps/desktop
npm run build --workspace apps/desktop
```

Electron E2E 在 `apps/desktop` 使用 `npx playwright test e2e/multi-agent-conversation.spec.ts`；使用当前系统支持的真实 Electron，不伪造 OS。若脚本环境需显示服务，按现有 e2e fixture 启动并记录实跑结果。

- [x] 在 acceptance 文件记录代码提交 / diff 基线、命令、通过/失败、真实 UI 观察及未覆盖拓扑。G1–G3 全过才进入 B；本阶段结束不能标记整个产品任务完成。
