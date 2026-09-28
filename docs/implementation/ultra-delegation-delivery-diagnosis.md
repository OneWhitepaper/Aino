# Ultra 完整任务交付：诊断记录（事实 / 假设 / 待验证）

本文件记录接续交接（`d285ae5a0e`）后的独立诊断。**这不是验收通过单**，也不是根因定论。
上一版把若干测量直接写成了定论，已按复核意见改为三类：**已证实事实**、**假设（有支持证据但未证实）**、
**待验证项**。原始运行现场：`/private/tmp/aino-ultra-acceptance-20260925/<run>/report.json`。

## 一、已证实的事实

### F1. 关注运行的技能状态（纠正上一版错误）

`live-large-132101` 的 `review_skill_hashes = {}`、`diagnostic.review_skill = "none"`，
即**该轮没有加载 `read-only-source-review` 技能**。因此不能用该技能的"逐条重读引用"要求解释它。
该轮实际进入模型的内容是：

- 场景 prompt（1490 字符）：含契约句"主任务负责核验证据并交付最终答案"、
  "主任务核验子结果及其完整性后，再统一完成原要求的三组结论和Top 3；格式有效不等于事实已确认"、
  "每组结论控制在400字以内"；
- 系统提示（含 `<tool_persistence>` 的 "Keep calling tools until: (1) the task is complete,
  AND (2) you have verified the result"、`<verification>` 的 completeness 要求）；
- 三个子任务的 evidence JSON 结果（各自含 claim/status/trigger/evidence 行号引用）。

技能承载的原始验收**从未在本轮执行**，其行为也未被测量。

### F2. 模型不知道任何外部预算

该轮 prompt 不含 token/预算字样；`agent_state.run_budget_seconds = None`；
config 只有 `max_turns=36`、`reasoning_effort=ultra`、`api_max_retries=1`、`auto_recovery_cycles=0`。
所以模型不可能"知道还剩多少预算"并按比例收敛。

### F3. 该轮父任务的读取分布（纠正上一版表述）

父任务 21 次 `read_file`、19 次 `search_files`、1 次 `execute_code`，`parent_exact_duplicate_tools = 0`。

按**请求参数**展开（默认 limit 2000 行、单次上限 100k 字符）：

- 请求覆盖 3,510 行，去重 3,448 行，重叠冗余 62 行（1.8%）；
- **存在 5 对同文件重叠窗口**（最大 25 行：`delegate_tool_config.py` `[390,614] ∩ [300,414]`）。

按**工具结果实际首/末行号**测量（每次读取真实生效的区间）与子结果证据交叉：

- 实际读取 3,372 行（去重）；其中落在子结果 evidence 行区间内的仅 **800 行（23.7%）**；
- **没有任何一次读取是"完整复读子引用区间"**；
- 12/21 次读取与子证据有交集（其中 6 次仅与 `confirmed` 证据相交、6 次含 `needs_verification`）；
- 9/21 次读取的文件虽被子结果引用过，但区间与任何 evidence 都不相交；
- **0 次**读取越界到子结果从未引用的文件（全部落在同一批 6 个文件内）；
- 子结果里 9 条 `needs_verification` 与 16 条 `confirmed` **全部**至少被一次读取覆盖，
  即"条目被触碰"粒度上看不出对 NV 的定向倾斜。

因此"21 个互不重叠的窗口"**是错的**；同样，"没有完全相同参数"**不能**证明核验无冗余、
范围未扩大、或每次读取都有必要——它只证明没有逐字重复的调用。**哪些读取属必要核验、
哪些属冗余，本报告无法判定**（完整 CoT 加密，明文 reasoning 仅摘要）。

### F4. 该轮的预算与中断机制

- `limits.approx_cumulative_input = 2,000,000` 是**验收 harness 的本地粗估阈值**
  （来源：harness 的 `pre_api_request` 观察器对 `approx_input_tokens` 求和，`harness.py:769-770`），
  **不是服务端强制限制，也不是产品配置**。
- 该轮全任务累计 2,012,563（100.6%），触及该阈值；父任务 1,184,795（17 请求）、
  子任务 827,768（16 请求）。
- 触发后由 harness 调 `session.interrupt`（`harness.py:1031-1035`），
  运行时在 `agent/turn_iteration_prep.py:335-341` 直接 break，没有迭代预算耗尽时的 grace call
  （对比 `:361-364` + `turn_finalizer.py:122-157`）。

### F5. 父任务实际收到的子结果信息量（实测）

从该轮 `profile/state.db` 读出投递给父任务的那条完成通知行（`messages.display_kind =
'async_delegation_complete'`，`id=54`）：

- 通知正文 **24,620 字符**，单条 `role=user` 消息；
- 含 **3 份完整子结果 JSON**（`"findings"` 出现 3 次）与 **65 处 `line_start` 行号引用**；
- 每份子结果 7–12KB（与仓库内 `docs/implementation/ultra-delegation-evidence/child-*.original.json`
  一致），交接文档已说明它们是原始 SQLite `summary` 的逐字导出。

因此**父任务在单条消息里已具备作答所需的完整证据**，不需要自己去读文件才能形成结论。
（注意区分：`report['children_finished'][].summary` 也是 500 字符，那是 `subagent.complete`
**UI 事件**载荷的显示截断，见 `tools/delegate_tool_child_run.py:1007`；投递走的是
`_push_completion_event` 的 `result["results"]` 完整列表，**不受**该截断影响。）

### F6. 该轮父任务的行为形状

末次父 `finish_reason` 为 `tool_calls`：父任务在被中断时仍处于工具循环内，
**没有产出候选答案**（所以中断没有截断一个已成形的答案）。
`parent_character_count_calls` 有 1 条：该次 `execute_code` 内联了三个分组的草稿文本
（脚本本体 1,561 字符）以统计字数，说明被中断时它已在整理各组结论的篇幅。

### F7. 余量探针的实测（一次运行，仅此一次）

2026-09-28 执行，唯一变量是 `--input-cap` 2,000,000 → 3,000,000；其余与记录场景一致
（`large --matched-comparison --evidence-contract`，gpt-5.6-sol，父 Ultra→max，子 High，
1200s，$5 观察阈值）。报告自标注 `scenario_ceiling_overridden=true`，**不构成预算内验收**。

| 量 | 原跑 132101 | 余量探针 | 变化 |
|---|---:|---:|---:|
| 父任务请求（任务回合 / 辅助） | 15 / 2（共 17） | 15 / 2（共 17） | 同 |
| 父任务累计输入（任务回合） | 1,172,303 | 1,536,151 | **+31.0%** |
| 父任务累计输入（辅助） | 12,492 | 12,294 | −1.6% |
| 子任务累计输入 | 827,768（16 请求） | 914,821（17 请求） | +10.5% |
| 全任务累计输入 | 2,012,563 | 2,463,266 | +22.4% |
| 对 3M 上限占比 | — | **82.1%（未触及上限）** | — |
| 父任务工具调用 | 41（读 21/搜 19/码 1） | 44（读 28/搜 14/码 2） | 读 +7 |
| `answer_state` | `mid_tool_loop` | `mid_tool_loop` | 均未产出候选答案 |
| 自然交付 | 否 | 否 | — |
| 实际花费 | $3.86 | **$5.12**（36 行全部 settled） | — |

**该次运行的准确结论只有一条**：这一次运行在停止前仍未完成。
它**没有**触及 3M 输入上限（82.1%）就被 `observed_budget_stop`（$5 观察阈值）SIGTERM 中断，
所以对"3M 输入是否足够"**没有结论**。父任务与全任务用量已分开比较：父任务任务回合 +31.0%、
辅助请求基本不变、子任务 +10.5%。这组差异**不足以**确立"预算增加导致核验扩张"的因果
（子结果内容、采样、时延、缓存状态均不同，且中断原因不同）。

## 二、假设（有支持证据，未证实）

### H1. 父任务的核验工作量与可用余量正相关

支持：两次运行父任务请求数相同（17），但探针每次请求上下文更大（均值 69,694 → 91,085），
读取更多（21 → 28）。若核验量固定，两次的上下文形状本应相近。

**未证实，且有多种竞争解释**：子结果内容不同（子任务用量 +10.5%，结果可能更长）、
模型采样随机性、请求时延、缓存状态、以及不同子结果引用的行号分布。
单次运行的组间差异不足以确立因果。

### H2. 主要成本驱动是"请求轮数 × 每次请求的上下文"，而非单次工具调用价格

支持：原跑交付阶段父任务 15 次请求共约 1.10M 累计输入、均值约 78k/次；
成功重放父阶段独立预算下 12 请求 1.08M。若把 21 次读取压成更少请求，累计和会显著下降。

未证实：未做过"同任务、仅减少请求轮数"的对照实验。

### H3. 契约要求的核验范围在该轮没有上界

支持：prompt 要求核验子结果及其完整性、结论需带触发条件与文件行号；子结果含 25 条 findings
（16 confirmed / 9 needs_verification）；模型对每条都做了定向读取。

未证实：模型是否本可在更少核验下给出同等质量答案；也未测量"哪次读取确实提升了结论质量"。

## 三、待验证项

1. **模型能否在更明确的可交付判据下收敛**——需要一次对照实验（属"改变任务输入"，需先明确说明）。
2. **减少请求轮数是否降低累计输入并仍保持准确性**——可用现有批量工具调用能力构造离线/真实对照。
3. **`length` 场景（79s 自然交付）不是 `large` 的因果对照**：两者任务不同
   （length 明写"无需重新审查、读文件"），不能据此推断同一契约下的收敛性。
4. **原始技能承载的验收从未执行**：本轮全部为 `--review-skill=none` 诊断，
   技能版行为、技能对核验量的影响均未测量。
5. 上一版把"产品看不到服务端计数，所以现有架构无法降低核验成本"当作推论——**该推论不成立**
   （见下节 P1）。

## 四、已排除与需重新审视的方向

**P1. 纠正：产品完全可能降低核验成本。**
2M 是 harness 本地阈值（F4），产品看不到它并不意味着产品无法影响它。产品可以通过
减少**每次请求的上下文**（结果聚合、工具结果裁剪/压缩、批量工具调用）来降低这个累计和。
上一版"任何按窗口占用设计的回收机制在原理上都无法对齐该约束"的推论已作废。

**P2. 已测量的候选机制及其真实边界（保留但需重新评估）**

- 内置回合内裁剪 `ContextCompressor.prune_tool_results_only`（`context_compressor.py:3157`，
  由 `agent/turn_preflight.py:369` 每次迭代调用）：门控 `proactive_prune_tokens` **默认 0（关闭）**，
  且其提交会打断前缀缓存（函数自身要求 `proactive_prune_min_reclaim_tokens` 与 regrowth runway）。
  **未测量**的是：在"核验型长回合"下，按纯消息数保护 tail 的裁剪对结论质量的实际影响。
  这是一个可离线/低成本验证的候选，不应当仅凭"会打断缓存"就排除。
- `verify_on_stop`：默认关，且需要 `changed_paths`（只读审查为 0），该场景不可达。
- stall/degenerate/ack 续跑守卫：上界 ≤2，触发条件（≤24/≤400 字符回复、全消息无 tool 行）不满足。
- `run_budget_seconds`：默认 None 且为墙钟维度，本场景未设置。
- 通知投递：wake 34ms、`delivery_attempts=1`、子结果完整无截断（该轮 `batch_delivery` 字段为
  `null`，上述数值来自交接时的派生记录，未在本机原始报告中复核）。

## 五、方案：复用现有机制（进行中）

### 5.1 已证实的信息呈现缺口（非模型行为）

| # | 问题 | 证据 | 状态 |
|---|---|---|---|
| R1 | 批量完成通知丢失**子任务模型名**：batch 事件的 `model` 为空，`_preamble` 打印 `Model: ?`，而每个 result 里有 `model` | 真实通知文本 `Role: leaf   Model: ?`；`process_registry_notifications.py:155` | **已修**（`_batch_model_line` + `model_label`） |
| R2 | 每任务 header 只给 `api_calls`/`duration`，未给出**累计用量、exit_reason、schema_valid** | payload 里 `tokens={input:770816,output:12409}`、`exit_reason`、`schema_valid` 均存在；header 只有前两项 | **已修**（`_task_execution_note`，中性标注 `cumulative tokens`） |
| R3 | `tool_trace` 未渲染；`exit_reason` 此前仅被折成 `truncated` 布尔 | `delegate_tool_child_run.py:558-655` | 待评估（见 5.4） |

**这两项只是信息呈现改进，不能被称作父任务重复读取的已确认根因。** 累计 token 来自
`session_prompt_tokens`（含重复发送的上下文），**不能**说明读了多少不同代码，也不能作为
"结论更可信、可以少核验"的依据——通知里已按 `cumulative tokens` 中性标注。
同理，`schema_valid` 表示格式有效，**不等于**事实正确；`exit_reason` 是执行状态。

`live_transcript` **此前已在渲染**（`process_registry_notifications.py:177`、`:290`），
`cost_usd` 为本次新增且仅在 `cost_status` 非 `unknown` 且金额非 0 时显示——本运行是
`unknown/0.0`，故真实通知中不出现 `$`（符合"不把未知花费写成 0"的既有约定）。

### 5.2 尚未证实的原因（模型行为）

- **并行度不是主因（已复核并撤回先前判断）。** 交付后各轮调用数为
  `[10, 9, 6, 4, 1, 1, 1, 1, 3, 1, 1]`，其中 6 轮只有 1 个调用（不是先前误述的 11 轮）。
  逐轮核对查询词后：这 6 轮的搜索目标（`class ContextCompressor`、
  `_inherit_parent_capabilities`、`_session_profile_runtime_scope`、
  `def _is_synthetic_compression_user_turn` 等）**均未出现在交付通知或更早结果中**，
  即都是**由前一步结果发现的新目标**，当时无法并行发起；`id=92/102` 虽命中文件名分词，
  但其目标符号同属新发现且与前一轮结果配对。
  因此这些单调用轮是**结果驱动的串行链**，不是可合并的并行机会。运行时侧也确认
  **没有**每响应调用数上限（唯一的 8 是并发度，超出者排队）。
- 核验是否"充分即止"无可观测判据。**已测量**：两次运行 100% 的 NV 与 100% 的 confirmed
  条目都被至少一次读取覆盖；`parent_exact_duplicate_tools = 0`；0 次读取越界到子结果未引用的文件。
  **未证实**：哪些读取是必要核验、哪些是冗余（完整 CoT 加密，报告只能给"未被显式引用"的上界）。
- 单次运行的组间差异不能确立因果：两次运行在子结果内容（25 vs 11 条 findings）、
  采样、时延与缓存状态上均不同，且中断原因不同（输入阈值 vs 花费阈值）。
  本轮余量探针只能说明"这一次在停止前仍未完成"。

### 5.3 准备修改的现有模块与调用点

| 模块 | 调用点 | 修改 | 预期作用 | 准确性 / 缓存 |
|---|---|---|---|---|
| `tools/process_registry_notifications.py` | `_preamble:155`、`_format_batch_delegation`、每任务 header | 补子任务模型名、累计用量、`exit_reason`、`schema_valid`（中性标注） | 让父任务看到**执行与格式事实**（哪个子任务未正常结束、格式是否无效），而不是只能靠 claim 数量猜；**不**声称这些字段代表证据质量 | 回合内新 user 行，父前缀不变；只增可见事实，不改结论 |
| 同上（待评估） | `_format_batch_delegation` 的 `tool_trace` | 先核实 `tool_trace` 记录的是**请求了哪些范围**还是**实际返回/是否失败截断**，再决定是否渲染摘要 | 若只能证明"请求过这些行"，则**不能**等同于"已正确核验"，不足以支持降低核验标准 | 同在通知行内 |

**不做**：新增累计预算系统、改外部上限、恢复已撤回的催促提示、强制总结、
把完整 `tool_trace` 塞进通知（会增加上下文而非减少）。

### 5.4 离线回归与候选改动验证

**离线回归（已做）**：`tests/tools/test_batch_notification_effort_visibility.py`（6 项）
——模型名回落、累计用量中性标注、异常子任务的 `exit=`/`schema=INVALID`、干净子任务不加噪音、
多模型披露、单任务路径不受影响。红→绿已验（还原生产代码后 4 项红）。

**候选改动验证（最多一次，需先取得明确确认）**：

- **名称**：这是**同配置下的候选改动验证**，不是严格对照实验。从头重跑会重新生成子结果，
  模型采样、子证据与请求时延都会变化，因此不能宣称"唯一变量是通知内容"，也不能凭一次
  成功或失败证明因果。
- **假设**：补入执行/格式事实后，父任务在**相同上限**下更早交付。
- **对照条件**：同 fixture 哈希、同 prompt、同模型与档位、同 2M 上限与 $5 观察阈值。
- **停止条件**：触及 2M 累计输入，或观察花费达到 $5 即停；不重跑、不扩预算。
- **成功判据（必须同时满足，减少读取本身不算成功）**：
  1. **完整任务自然交付**（`natural_delivery == true`）：需同时满足 `stop_reason == normal_final`、
     最终事件 `status == complete` 且正文非空、且 `completion_guard.eligible == true`。
     仅"观察到文本回答"（`answer_state`）**不算**通过——中断说明、等待状态、未完成请求都会被
     `not_delivered_because` 列出原因；
  2. 原完整任务预算与耗时记录齐全，父/子/辅助请求与全部费用可核对；
  3. 重要结论准确，原有的过度断言（把"证据不足"写成"确定缺陷"）**没有**因减少核验而恶化；
  4. 子结果的条件、limitations 与未完成状态在最终答案中得到保留；
  5. 前缀与原始证据保持完整（`fixture_changed` 为空、系统哈希一致）。
- **费用**：**$5 观察停止阈值**，最终结算可能超过该值（`observed_usage` 是延迟观察，非硬上限）；
  以 `settlement.json` 为准。
- **判定工具**：`convergence.py` 的 `natural_delivery`（含 `not_delivered_because`）、
  `answer_state`、`delivery`（按 turn 分类：任务回合 / 辅助 / 未分类，附每回合明细）、
  `budget_split`、`fixture_changed_count`。

若该次验证显示"执行/格式可见性"不足以改变行为，下一个候选是 `tool_trace` 摘要（R3，须先核实其
语义边界），仍需各自独立验证，不合并变量。

## 六、复现入口

- `evals/ultra_delegation/convergence.py`：从保存的 `report.json`（可选同目录 `events.jsonl`）打印
  请求身份分离（任务回合 / 辅助侧调用 / 未应答）、父子预算拆分、父任务上下文增长、
  子任务自身时长与交付墙钟（两个时钟）、末次 `finish_reason`、`answer_state`、
  重复工具数与字数核验调用数。回合分类**不按大小**：有响应的回合为任务回合、请求全部未应答
  且出现在 harness `missing_response_ids` 中的为辅助回合、其余标 `unknown`；
  `answer_state` 只描述"是否观察到文本回答"，`natural_delivery` 才描述完整任务是否自然交付。
  只读，不运行模型、不写文件。
- `--input-cap`（`harness.py` / `platform-runner.ts`）：诊断余量探针；报告自标注
  `scenario_ceiling_overridden` 与 `diagnostic_note`，不可能被读成预算内通过。
- 回归：`tests/evals/test_ultra_delegation_convergence.py`。

### 测试环境事实（纠正先前误判）

`ripgrep` **在本机存在但不在 PATH 上**：`~/.claude-mem/node_modules/@anthropic-ai/
claude-agent-sdk/vendor/ripgrep/arm64-darwin/rg`（ripgrep 14.1.1，arm64）。`scripts/run_tests.sh`
用 `PATH="$PATH"` **保留** PATH（`:171`），因此既非"机器未安装"，也非 runner 清理 PATH。
把这一个目录加入 PATH 后，先前 10 个搜索测试**全部通过**（3 文件 35 项），
未修改任何测试来绕过。

**已花费用**：余量探针 $5.12（36 行 settled）。该支出不构成任何结论成立的依据。
后续付费实验需先列假设、对照、预计费用、停止条件与结算滞后风险，并取得明确确认。
