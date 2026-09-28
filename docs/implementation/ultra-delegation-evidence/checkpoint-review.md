# WIP 检查点代码审查：两项已复现的恢复风险

记录日期：2026-09-28。检查分支：`codex/proactive-delegation`。检查时 HEAD：
`559bbf043287752ed97afd0d6d4d68c9e74227a3`；生产改动仍在工作树中，尚未写入该提交。
本报告中的行号对应当时的工作树，不是原始基线文件。

**本轮只保存 WIP 并交接，不修产品、不合并，也不宣称 Ultra 已完成。** 以下两项是在交接审查中
新复现的待修风险，不是本轮新修复；没有证据证明它们是此前大型任务无 final 的唯一根因，
也没有证据把它们归因到某一条既有验收运行。已确认子结果完整到达而父任务仍未交付的运行，
不能仅用这两项风险解释。

## 范围与验证环境

- 审查范围：交接开始时已有的 54 个生产、测试及文档文件；未把随后添加的 harness / 证据材料
  算作该审查范围。
- 环境：Darwin arm64，Python 3.11.15，使用主 checkout 的既有虚拟环境，在该分支 worktree 中导入代码。
- 验证方式：读取真实调用路径，运行下面两类纯内存生产 helper 探针；未调用模型、网络或数据库写入，
  未修改生产文件、测试、索引或 HEAD。探针不是完整 gateway/TUI E2E，也不是整套回归测试的替代。
- `git diff --check` 通过。原 54 项未发现需要阻止明确标注为 WIP 的提交的凭据或私钥；一个
  `sk-ant-...` 搜索命中是基线已有的测试占位值，不在新增 diff 中。
- 附带的小改动：`apps/desktop/src/app/settings/config-field.tsx:52` 的 Unicode 描述去重及对应测试，
  `agent/prompt_builder.py:468` 的通用 prose 长度提示。中文文档并发默认值 3→10 与现有配置代码一致。

下面命令在仓库根目录执行，先激活项目既有 Python 虚拟环境。命令为 `HERMES_HOME` 指定一个
不需要创建的临时路径，避免读取本机默认 profile 路径时出现 fallback 提示；两个探针均不打开 ledger。
原验证中 `HERMES_HOME` 未设置，因此打印了 profile fallback 提示，但上述纯内存路径没有写入该 home。

## 1. 恢复事件入队先于 offer 登记，存在丢失归还的竞态

相关源码：

- `tools/async_delegation.py:331`：`_replay_pending`。
- `tools/async_delegation.py:350`：先调用 `target_queue.put(evt)`。
- `tools/async_delegation.py:351`：之后才持锁向 `_offered` 添加记录。
- `tui_gateway/session_notifications.py:500`：消费者无法证明事件归属时，丢弃当前队列副本；
  `:511` 调用 `return_completion_offer(evt)`，允许之后重捞。
- `tools/async_delegation.py:387`：后续 sweep 跳过仍在 `_offered` 中的记录。

可达时序是：某个 poller/sweep 生产恢复事件，另一个共享队列消费者在 `put()` 后被调度；
它丢弃暂时无主的事件并归还 offer；生产者随后登记 offer。结果是队列已经没有副本，
但 `_offered` 仍宣称存在，后续同进程 sweep 持续跳过。进程重启会清除该内存标记。
原有数据库 delivery claim 仍负责跨进程排他，这个问题发生在认领前的内存 offer 管理。

可复制探针：

```bash
PYTHONDONTWRITEBYTECODE=1 HERMES_HOME="${TMPDIR:-/tmp}/aino-checkpoint-review-no-write" python -B - <<'PY'
import json
import queue
import threading
import time
from tools import async_delegation as ad

received = threading.Event()

class ObservedQueue(queue.Queue):
    def put(self, item, block=True, timeout=None):
        super().put(item, block, timeout)
        # Force the legal scheduling point between publication and offer marking.
        received.wait(2)

q = ObservedQueue()

def consumer():
    evt = q.get(timeout=2)
    ad.return_completion_offer(evt)
    received.set()

thread = threading.Thread(target=consumer)
thread.start()
now = time.time()
count = ad._replay_pending(
    None,
    [('review-probe', json.dumps({
        'type': 'async_delegation', 'delegation_id': 'review-probe',
    }), now, now)],
    q,
    now,
)
thread.join(2)
print(json.dumps({
    'replayed': count,
    'queue_empty': q.empty(),
    'consumer_returned_offer': received.is_set(),
    'still_marked_offered': any(key[1] == 'review-probe' for key in ad._offered),
}))
PY
```

实测输出：

```json
{"replayed": 1, "queue_empty": true, "consumer_returned_offer": true, "still_marked_offered": true}
```

证据边界：探针使用真实 `_replay_pending` / `return_completion_offer` 和两个线程，
通过队列子类固定一个合法的线程交错，证明该时序可产生矛盾状态。它没有运行完整 TUI 归属判断，
没有测量真实负载下发生频率，也没有证明任何既有验收运行正好经历了这个时序。

## 2. 采用未答复用户行后，Max 重试可能保留 Ultra ON 指令

相关源码：

- `agent/session_persistence.py:136`：`adopt_unanswered_turn` 把未答复用户行从历史移出，
  保留其侧车并交给 `_pending_cli_user_message`。
- `agent/turn_context.py:614`：`_stage_turn_user_message` 复用该行。
- `agent/turn_context.py:1082`：模式判断只检查当前用户行之前的历史，因此看不到被采用行内的 ON。
- `agent/turn_context.py:1097`：Max 路径把当前行的 `aino.ultra_collaboration_active` 元数据写成 false。
- `agent/turn_context.py:885`：metadata-only backfill 保留原侧车，因此旧 ON 仍会被请求使用。
- `agent/ultra_collaboration.py:67`：模式恢复要求元数据与侧车 marker 对应；false 元数据配 ON 侧车
  不再被视为激活记录，后续 Max 新消息也不会生成 OFF。

具体前提：失败的首次尝试已留下带 ON 侧车的未答复用户行；随后 effort 配置改成 Max，
dispatcher 采用原行重试，而该行之前没有另一个仍有效的 ON。采用路径存在于
`hermes_cli/quiet_single_query.py:248` 的 `adopt_unanswered_turn` 和 API-server peer-DM 重试。
这与正常新增用户消息的 Ultra→Max 切换不同；正常切换测试没有覆盖此采用路径。

可复制探针：

```bash
PYTHONDONTWRITEBYTECODE=1 HERMES_HOME="${TMPDIR:-/tmp}/aino-checkpoint-review-no-write" python -B - <<'PY'
import json
from types import SimpleNamespace
from agent.session_persistence import adopt_unanswered_turn
from agent.turn_context import _stage_turn_user_message, _stamp_api_content_sidecar
from agent.ultra_collaboration import (
    ULTRA_MODE_METADATA_KEY, ULTRA_ON_NOTE, ultra_mode_active, ultra_mode_note,
)

agent = SimpleNamespace(
    reasoning_config={'enabled': True, 'effort': 'max'},
    valid_tool_names={'delegate_task'},
    _delegate_depth=0,
)
history = [{
    'role': 'user',
    'content': 'resume task',
    'api_content': 'resume task\n\n' + ULTRA_ON_NOTE,
    'display_metadata': {ULTRA_MODE_METADATA_KEY: True},
}]
adopted = adopt_unanswered_turn(history, 'resume task', agent)
row, _ = _stage_turn_user_message(
    agent, 'resume task', None, None, None, None, None,
)
note = ultra_mode_note(agent, history)
# Mirror build_turn_context's inline metadata branch at lines 1097-1104.
if (
    not agent._delegate_depth
    and ('delegate_task' in agent.valid_tool_names or note)
    and (note or not ultra_mode_active(agent))
):
    row['display_metadata'] = {
        **row.get('display_metadata', {}),
        ULTRA_MODE_METADATA_KEY: ultra_mode_active(agent),
    }
_stamp_api_content_sidecar(
    agent, [row], 0, '', note, preflight_compressed=False,
)
print(json.dumps({
    'adopted': adopted,
    'replacement_note': note,
    'recorded_mode': row['display_metadata'][ULTRA_MODE_METADATA_KEY],
    'wire_still_has_ultra_on': ULTRA_ON_NOTE in row['api_content'],
    'off_note_next_turn': ultra_mode_note(agent, [row]),
}))
PY
```

实测输出：

```json
{"adopted": true, "replacement_note": "", "recorded_mode": false, "wire_still_has_ultra_on": true, "off_note_next_turn": ""}
```

证据边界：探针调用真实采用、用户行 staging、模式判定、侧车 stamping helper，
仅将 `build_turn_context` 内联的元数据条件按现有逻辑复制到探针中；不运行完整 turn prologue 或模型请求。
输出字段 `wire_still_has_ultra_on` 检查将由 API 构建使用的侧车，不能当作一次真实 HTTP 请求记录。
它证明该输入状态下的确定性模式矛盾；尚未完成实际 peer-DM/CLI dispatcher 的端到端复现。

## 交接处理

这两项风险应作为后续针对性修复及回归验证入口，保留现有缓存、用户原文、profile 隔离、
事件归属和 delivery claim 合同。它们不阻止明确标注的 WIP 保存，但不能忽略后直接宣称可合并发布。
复杂任务最终交付与事实准确性的完整验收仍是独立的未完成目标。
