# Ultra 完整任务交付：根因诊断与下一步（2026-09-28 之后接续）

本文件记录接续交接（`d285ae5a0e`）后的独立诊断，**不是验收通过单**。结论基于原始运行现场
`/private/tmp/aino-ultra-acceptance-20260925/<run>/report.json`（该原始报告此前未随包导出）。

## 结论：不是运行时缺陷，是"无界核验 vs 有限预算"的结构冲突

三项事实排除了"模型胡乱重复劳动"的解释：

1. **父任务没有一次重复调用。** `live-large-132101` 的 `parent_exact_duplicate_tools = 0`。
   21 次 `read_file` 是 **21 个互不重叠的定向窗口**（`(path,offset,limit)` distinct 键 21/21），
   19 次 `search_files` 全是一次性的引用符号定位。这是精确核验，不是浪费。
2. **它是在忠实执行任务契约。** 原始 `read-only-source-review` 技能第 6 步：
   *"Re-read every cited line... Parent-side citation verification is mandatory."*；
   场景 prompt（`harness.py:232`、`:235-241`）要求"主任务核验子结果及其完整性"、
   "格式有效不等于事实已确认"。子结果有 **25 条 findings** 需要逐条核对行号。
   系统提示同向：`<tool_persistence>` 要求"Keep calling tools until: (1) the task is complete,
   AND (2) you have verified the result"，`<verification>` 要求"every named acceptance criterion
   is verified"。
3. **它离交付只差一步。** `parent_character_count_calls` 显示被打断时父任务**已经写好三组完整草稿**
   （含"确定/待核"分级与精确文件行号），正在用 `execute_code` 数字数以满足"每组400字"。

**判别证据（同一模型、同一契约）**：`length` 场景 prompt 明写"无需重新审查、联网或读文件；请直接完成"，
结果 **79 秒自然交付**。`large` 场景要求带证据行号的结论 → 14 次完整运行**无一自然交付**。
所以差异来自契约要求的核验工作量，而不是模型能力或提示词措辞。

## 预算算术（为什么 15 次核验请求装不下）

`live-large-132101` 实测：

| 项 | 值 |
|---|---|
| 总请求 | 33（父 17，三子 16） |
| 批量结果送达 | 833.838s（wake 延迟 34ms，通知完整无截断） |
| 送达前已耗近似输入 | 840,260 |
| 父任务累计近似输入 | 1,184,795（子任务 827,768） |
| 父任务上下文 | 首 4,524 → 峰 92,244，均值 69,694，增长 20.4× |
| 父任务回合 | 3 次 `message.start`：派发 1 次、交付 2 次；最后一次被中断，无响应记录 |
| 父任务 finish_reason | 派发回合 `['tool_calls','stop']`；交付回合全部 `tool_calls`（14 条记录） |
| 是否曾尝试作答 | **否**（`answer_attempted=false`，`interrupted_mid_tool_loop=true`） |
| 终止 | `2,012,563 ≥ 2,000,000` → 客户端观察器 interrupt |

两处易误读：`limits.approx_cumulative_input` 是**父子合计**上限，不是父任务独占；
`responses` 按回合分组、`api_call_count` 每回合重新计数，**不是**按时间排序，
所以不能按位置切片推断"交付前/后"——上面的拆分取自 `events.jsonl` 的回合边界。

父任务需要约 15 次核验请求，而预算只够约 14 次；每次请求都要重发整段累积上下文
（缓存命中率 87%，但累计输入上限按原始 token 计数，不因缓存折算）。子任务占用 833/1200s 墙钟，
父任务剩余 366s，而已证实的父任务独立交付需要 ≈433s。

## 已排除的机制（有证据，勿重复排查）

- 通知延迟/重复投递：34ms、`delivery_attempts=1`、`all_child_summaries_preserved=true`。
- 运行时续跑守卫：`verify_on_stop` 默认关且需要 `changed_paths`（只读审查为 0）；
  stall/degenerate/ack 守卫上界 ≤2 且触发条件（≤24/≤400 字符回复、全消息无 tool 行）均不满足。
- 回合预算收尾提示：`run_budget_seconds` 默认 None，harness 配置未设置；harness 自身预算与产品预算无关。
- `read_file` 去重键窄（`(path,offset,limit)`）确实可被换窗口绕过，但实测**没有**重复键，未被利用。
- compaction → `reset_file_dedup` 自持环：机制存在，但 92.2k 峰值远低于该上下文窗口的压缩阈值，未触发。

## 唯一可修的控制流（属评测脚本，非产品）

`harness.py:769-770` 观察超限后 `:1031-1035` 立即 `session.interrupt`，运行时在
`agent/turn_iteration_prep.py:335-341` 直接 break，**没有**迭代预算耗尽时那种 grace call
（`:361-364` + `turn_finalizer.py:122-157` 会额外发一次 toolless 总结请求）。
但交接文档 `handoff.md:13,63` 明确记录"催促收尾提示"曾试过并已撤回；改这条需要新的判别证据，
不能仅凭推理恢复。

## 下一步（需要授权，不能纯离线完成）

离线 scripted harness 只能证明调用链，**不能**证明模型行为，因此收敛方案必须有一次真实模型验证。
按判别力与成本排序，建议先做 2 再评估 1：

1. **契约层（改 harness 侧，零产品风险）**：在 evidence_contract 里显式要求"同一轮内批量发起核验读取、
   并在预算内交付；核验范围与预算成比例"。用 `large` 场景跑一次对照，判别假设是"模型能收敛"。
   代价：这会改变原题，因此与 `--review-skill=original` 的原始验收**不可混用**，只能作为诊断对照。
2. **收敛判据已固化为工具（离线，可重复）。** `evals/ultra_delegation/convergence.py`
   从保存的 `report.json`（可选同目录 `events.jsonl`）打印本次诊断依赖的每一项指标：
   父子预算拆分、父任务上下文增长、交付前父回合数、末次 `finish_reason`、是否曾尝试作答、
   重复工具数、字数核验调用数。它**不**运行模型、不写文件，只读。
   用法：`python3 evals/ultra_delegation/convergence.py <run>/report.json`（`--json` 供脚本对比）。
   回归在 `tests/evals/test_ultra_delegation_convergence.py`（8 项，含对真实保存报告的断言）。
3. **预算分配（需产品决策）**：把累计输入纳入产品侧收尾判据，或让父任务在子任务运行期间做可交付的准备工作。
   触及提示稳定性与缓存合同，风险最高，除非 1/2 给出证据否则不做。

在获得方向与预算授权之前，不做真实模型调用。
