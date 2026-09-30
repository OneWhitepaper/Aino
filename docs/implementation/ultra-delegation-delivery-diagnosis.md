# Ultra 完整任务交付：诊断记录（事实 / 假设 / 待验证）

本文件记录接续交接（`d285ae5a0e`）后的独立诊断。**这不是验收通过单**，也不是根因定论。
最新一次原始技能完整任务验收见第九节：2026-09-28 仍未自然交付，实际由 $5 观察费用阈值中断；
已保存的原始报告误标为 `token_request_cap`，不能据此声称触及 2M。全部 48 次 wire 已对账，
结算快照合计 $5.206063。本轮未自动重跑。
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

该次运行不是技能承载的原始验收；之后的原始技能运行单独记录在第九节，不能混作同条件对照。

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

这证明子报告完整投递，**不证明子报告包含充分原始证据或所有结论正确**。行号引用不是
对应源码正文，不能由通知完整推导父任务无需读取源码；是否足够形成合格答案仍须核验。
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
| 父会话 hook 请求（每请求用途未知） | 17 | 17 | 同 |
| 父会话累计粗估输入 | 1,184,795 | 1,548,445 | **+30.7%** |
| 子任务累计输入 | 827,768（16 请求） | 914,821（17 请求） | +10.5% |
| 全任务累计输入 | 2,012,563 | 2,463,266 | +22.4% |
| 对 3M 上限占比 | — | **82.1%（未触及上限）** | — |
| 父任务工具调用 | 41（读 21/搜 19/码 1） | 44（读 28/搜 14/码 2） | 读 +7 |
| `answer_state` | `mid_tool_loop` | `mid_tool_loop` | 均未产出候选答案 |
| 自然交付 | 否 | 否 | — |
| 实际花费 | $3.86 | **$5.12**（36 行全部 settled） | — |

**该次运行的准确结论只有一条**：这一次运行在停止前仍未完成。
它**没有**触及 3M 输入上限（82.1%）就被 `observed_budget_stop`（$5 观察阈值）SIGTERM 中断，
所以对"3M 输入是否足够"**没有结论**。父会话与全任务用量已分开比较：父会话 +30.7%、
子任务 +10.5%。此前按响应数量划分任务/辅助回合的表述撤回；请求用途未知。
这组差异**不足以**确立"预算增加导致核验扩张"的因果
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
4. 前述 `--review-skill=none` 诊断不能代替原始技能验收。原始技能完整运行见第九节；
   单次不同配置运行仍不能分离技能对核验量的因果影响。
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
| R3 | `tool_trace` 未渲染 | 只含参数摘要、结果字节数与状态，不含原始返回正文 | 已核实并排除；不追加字段 |

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

### 5.3 已有通知改动及边界

| 模块 | 调用点 | 修改 | 预期作用 | 准确性 / 缓存 |
|---|---|---|---|---|
| `tools/process_registry_notifications.py` | `_preamble:155`、`_format_batch_delegation`、每任务 header | 补子任务模型名、累计用量、`exit_reason`、`schema_valid`（中性标注） | 让父任务看到**执行与格式事实**（哪个子任务未正常结束、格式是否无效），而不是只能靠 claim 数量猜；**不**声称这些字段代表证据质量 | 回合内新 user 行，父前缀不变；只增可见事实，不改结论 |

**不做**：新增累计预算系统、改外部上限、恢复已撤回的催促提示、强制总结、
把完整 `tool_trace` 塞进通知（会增加上下文而非减少）。

### 5.4 离线回归与候选改动验证

**离线回归（已做）**：`tests/tools/test_batch_notification_effort_visibility.py`（6 项）
——模型名回落、累计用量中性标注、异常子任务的 `exit=`/`schema=INVALID`、干净子任务不加噪音、
多模型披露、单任务路径不受影响。红→绿已验（还原生产代码后 4 项红）。

**候选改动验证协议（已执行，结果见第七节；不是继续运行的授权）**：

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
  `answer_state`、`delivery`（每请求用途保持 unknown，独立列出响应状态与 wire 用途总量）、
  `budget_split`、`fixture_changed_count`。

该次验证未通过。R3 已因其证据语义不足而排除，不以追加通知字段代替问题定位。

## 六、复现入口

- `evals/ultra_delegation/convergence.py`：从保存的 `report.json`（可选同目录 `events.jsonl`）打印
  父子预算拆分、响应状态、父任务上下文增长、子任务自身时长与交付墙钟（两个时钟）、
  末次 `finish_reason`、`answer_state`、重复工具数与字数核验调用数。
  每请求用途一律 `unknown`：wire 用途和 hook 请求没有共享关联键，只作为独立总量展示，
  **不能从有无响应或 missing usage 推断任务/辅助身份**；
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

## 七、候选验证复核（2026-09-28，完整任务未交付）

验证声明的代码版本为 `5bf16f53b283281f9bd0ae81e91e9363129f98a2`；
`large --matched-comparison --evidence-contract --review-skill=none`，
1200 秒、2M 累计粗估输入、64 请求、60K 输出和 $5 观察停止阈值均未放宽。
该版本保存的四份 harness 源文件与 manifest/commit 一致；未保存实际执行的
`.build/platform-runner.cjs` 哈希，不能用事后计算的哈希证明当时执行字节。

原始现场目录：
`/private/var/folders/d8/tb_9ybdj5xzg_l5451f5209c0000gn/T/aino-candidate-validation.nfCD0i/live-candidate`。
本节依据其 `report.json`、`events.jsonl`、`settlement.json` 与只读 `profile/state.db` 复核。

### 7.1 完整交付判据

**未通过。** `stop_reason=timeout`；harness 于 1200.758 秒请求中断，
报告总耗时 1202.76 秒；completion guard 未准入。
174.445 秒有一次“子任务已启动”的 `message.complete(status=complete)`；
1200.841 秒有空正文的 interrupted 事件。两者都不是子结果到齐后的任务最终答案。

没有最终交付不等于没有草稿，也不等于没有任何 complete 事件。
本场景未加载原始 review skill，故即使未来候选成功，也不自动通过带原始 skill 的验收。

### 7.2 作者、草稿和准确性

父会话为 `20260928_170338_aa1358`。此前误认成父草稿的 SQLite 消息
44/49/50 分别属于三个**子会话**，正文长度 7,086/8,420/9,073 字符。
它们包含 24 条 findings（12 confirmed / 12 needs_verification），共 73 处行号引用；
confirmed 项有 39 处引用。全部范围合法，只证明引用地址存在，不能证明全部结论准确。
这三份正文均逐字包含于父会话通知行 51。**撤回父输出 schema 污染线索。**

父会话完整记录为 46 行：2 user、12 assistant、32 tool。
其中 assistant 包含一条 66 字符的中断说明；排除它为 11 条，非空正文合计 61 字符。
此前的“8 条 assistant / 唯一一次 execute_code”只覆盖到第一次草稿，统计不完整。

实际四次 `execute_code` 都在参数中包含中文草稿：

| assistant 行 / tool 行 | 内容 | 计数结果 |
|---|---|---|
| 84 / 85 | 三组初稿 | 651 / 551 / 505 |
| 86 / 87 | 三组缩写稿 | 579 / 492 / 456 |
| 88 / 89 | 仅第一组 | 446 |
| 90 / 91 | 仅第一组 | 356 |

这些草稿未包含最终 Top 3。最后一次只有第一组，不能从最后一个工具参数恢复完整答案；
第一次虽然有三组，也全部超过 400 字。文本同时列有确定问题和疑点，但整体语义准确性
尚未逐条验收，不能以单条语义抽查或有效行号判定准确性通过。

### 7.3 按父子身份对账

| 量 | 原跑 132101 | 候选 |
|---|---:|---:|
| 停止原因 | token_request_cap | timeout |
| 墙钟秒 | 1120.3 | 1202.76 |
| 父请求 / 完整响应 | 17 / 16 | 13 / 11 |
| 父完整 API 秒（均值） | 316.626（19.789） | 913.655（83.060） |
| 子请求 / 完整响应 | 16 / 16 | 16 / 16 |
| 子完整 API 秒 | 约 1905 | 600.156 |
| 父累计粗估输入 | 1,184,795 | 743,842 |
| 子累计粗估输入 | 827,768 | 885,934 |
| 全任务累计粗估输入 | 2,012,563 | 1,629,776 |
| 子自身最大秒 / 到齐墙钟秒 | 790.2 / 833.838 | 287.1 / 376.470 |
| 父 read_file / search_files / execute_code | 21 / 19 / 1 | 18 / 9 / 4 |
| 父消息数 / 正文字符 | 61 / 278,023 | 46 / 259,488 |
| 已记录完整 usage prompt / cache_read / output | 2,142,779 / 1,873,408 / 48,207 | 1,740,007 / 1,438,080 / 44,917 |

候选 1513.811 秒是**父子全部 27 个完整响应**的累计值，绝不是父耗时。
并发 API 时间和也不是运行墙钟。两次未完整响应的等待不在完整响应求和中。

子结果到齐后，原跑 14 个完整父响应合计 277.239 秒，候选 9 个合计 795.072 秒。
相邻 tool.start 的间距不是工具执行时间，不能以同批并行开始推断工具为零秒。
候选按 tool_id 配对后，四次 execute_code 端到端合计 **12.847 秒**。

可观察的候选阶段是：
- 376.483–756.774 秒：父继续读搜核验；
- 756.811–1188.046 秒：初稿和后续控字，共 431.235 秒；
- 对应四次模型响应分别约 281.004 / 57.772 / 54.456 / 23.795 秒，合计 417.027 秒；
- 最后一次请求于 1188.062 秒开始，约 12.7 秒后被 harness 中断。

初次长响应同时包含起草，不能将 417 秒全部称作“数数字”。API 时间也含服务等待、
网络和消费处理，不能直接全部归为模型内部生成。模型内部认知活动无法按秒细分，
但这不妨碍按请求及工具的可观察行为分段。

### 7.4 通知、输入前缀与费用

六个源码文件及归一化原题 hash 与原跑一致。保存 fixture 未改变；四个会话的
system hash 各稳定；父 13 次 chat wire 的完整 input 项哈希在相邻请求间保留前缀（12/12）。

对**同一份保存 event_json**使用新旧 formatter 渲染：

| payload | 旧格式字符 | 新格式字符 | 新字段净增 |
|---|---:|---:|---:|
| 候选 | 26,740 | 26,829 | 89 |
| 原跑 | 24,620 | 24,710 | 90 |

新格式结果与保存通知逐字一致。跨运行的 2,209 字符增长中，子结果正文变化占 2,015，
字段占 89，其余事件文本占 105。不得把跨运行总增长归因给字段；它们是否影响模型行为
仍未被因果检验。不同子结果、采样和服务时延也不能当作已控制变量。

候选 34 次 wire = chat 13 + delegation 16 + other_auxiliary 4 + title 1。
保存结算 32 行均 settled，Decimal 合计 **$3.603040**：chat 11/$1.363360、
delegation 16/$2.212825、other_auxiliary 4/$0.021035、title 1/$0.005820。

另两次 chat wire 没有匹配结算行：
- `63d720bc-e5e1-4ff2-9d61-a9a0b1871680`：约 89.39 秒发起，47.68 秒后流结束；
  对应时段记录 Responses server_error，随后相同 body 重试成功。
- `e8f9780f-b1c4-4c1f-af5b-9d375adbc2d9`：约 1188.07 秒发起，在最终中断时关闭。

这是结算快照的覆盖缺口，不是额外收费的证据。仍需终态证据确认两次失败/中断请求的
零收费或最终收费；$5 只是观察停止阈值，不是金额硬上限。

## 八、接手修复范围（2026-09-28，进行中）

目标保持为：完整任务在真实模型下自然交付，且准确性、耗时、全部费用与缓存契约同时验收。
用户已授权继续在当前分支修复；不合并 main、不发布、不重启日常桌面。

### 8.1 已排除的改动方向

不实现此前方案 A 的“从工具参数兜底最终答案”。它只能展示不完整草稿，不能修复自然交付。
现有 `_resolve_budget_fallback` 专用于迭代预算耗尽，且保持错误/中断的退出来源；
`pending_verification_response` 保存的是被停止核验门暂扣的真实模型正文，不是任意代码参数。
现有代码有意保留这一边界，不能将缺少通用工具参数提取当作已证实的运行时漏洞。

也不继续叠加通知字段、收尾规则、累计预算框架，或放宽题目/最终答案判据。

### 8.2 当前执行顺序

1. 复用现有 convergence 分析器，修正父子、工具耗时与完整序列统计；用独立期望的
   离线反例先红后绿，避免手工截断现场再次驱动错误设计。
2. 对照保存请求与上游/Codex 路径检查实际模型指令、身份/前缀、续跑、响应消费与重试；
   区分客户端处理、服务等待和模型产生的动作，不以少读几次推断更快交付。
3. 只对能复现的产品缺陷实施最小修复；无代码缺陷证据时不把猜测包装成修复。
4. 完成相关离线/集成回归后，再为真实验收明确唯一变量、完整任务判据和费用范围。

### 8.3 裁剪仅作隔离量化，不启用

候选**父会话**有 32 条工具结果、230,999 个正文字符；四会话合计才是 59 条、781,568 字符。
此前“父 55 条/778,606 字符”的分母错误，已撤回。

现有 `prune_tool_results_only` 不裁 user-role 的子结果通知，主要改写合格的 tool 正文及
assistant 工具参数，并有门槛、最小回收、尾部保护及 rearm 规则。调用可能修改内部状态；
绑定真实 store 时会 archive_and_compact。任何试算都必须使用消息副本、隔离 compressor/存储，
不得直接更改保存现场，也不得把粗估 reclaim 当成真实账单或时延收益。
其提交会改变已有缓存前缀，本次候选未观察到原前缀损坏；保持功能关闭。

## 九、原始技能完整任务实测（2026-09-28，未通过）

### 9.1 授权、版本与实际停止原因

用户明确授权一次真实验收，1200 秒、2M 累计粗估输入、64 请求、60K 输出、
$5 观察费用阈值；不自动重跑或扩预算。运行目录为
<!-- no-tmp: ok — historical evidence location, not a runtime scratch-path instruction. -->
`/tmp/aino-ultra-takeover-20260928/live-original`。

版本为 `codex/proactive-delegation` 的 `4ad464e1045e2d572b132d89de1055ff609516aa`
加本轮未提交的测量/诊断补丁；运行前已保存 `source-freeze.json` 与 `source-freeze.patch`。
补丁 SHA256 为 `4968ba45ea5b035d95fe71a26e1f6525ba83b1f52b3bf9c45c978adcbc4e6e12`，
实际 runner SHA256 为 `a74c44b53513c719d055638be7055a45c57b22c91048c97f3c50b523354f8453`。
运行结束后六个冻结文件哈希全部复核一致。之后修复的测量代码不冒充本次运行版本。

使用 `large --review-skill=original`，原始技能从既有原始验收现场逐字复制，
`original_acceptance_eligible=true`。未启用 matched comparison、evidence contract、
parent-only replay，未改题、改档位或降低答案质量要求。父 Ultra 映射 max，子显式 high。
这与第七节的无技能诊断不同，**不能作同配置因果对照**。

**实际停止是费用观察阈值。** controller 在观察金额达到 **$5.065616** 时发出
`observed_budget_stop` 并向 harness 发送 SIGTERM；harness 在 870.264 秒中断父请求，
872.27 秒完成保存。未到 1200 秒，39 个 hook 请求累计粗估输入 1,980,328，
output 41,494，均未到各自观察阈值。

保存报告却写 `stop_reason=token_request_cap`、`caps=[]`。原因是旧 harness 的
SIGTERM handler 和内部输入/输出门限共用 `cap_event`，所有事件统一标成 token cap。
保留原始报告与 controller 日志，不倒改历史；本轮补充真实离线 SIGTERM 回归并将外部
信号单列为 `external_signal`。单靠信号不能判断费用来源，仍须 controller 记录证明。

### 9.2 完整交付、证据传递与质量

**自然交付未通过，最终答案准确性无法验收。** 三个子结果于 694.189 秒到齐，
父续跑 65ms 后发起请求；三次完整续跑响应仍为 tool calls，末次请求被中断。
`final_event` 缺失、completion guard 未准入；97.171 秒的“已分派”短文本不是最终交付。

父会话通知共 12,757 字符，逐字包含三份完整子正文（2,801 / 3,844 / 3,797 字符）。
第一组触及子任务 16 次迭代上限后的报告明显标注 `exit=max_iterations`、`TRUNCATED`
及不完整警告，没有丢结果或隐瞒未完成状态。UI preview 的 500/160 字符不可当作实际通知。

父任务共 25 次 read_file、5 次 search_files，没有 execute_code/数自身字数调用。
25 次读取均返回编号源码，2,962 个返回行位置中 2,699 行对父任务是新的，263 行重复
（约 8.9%）；没有重复的精确 path/offset/limit 键。技能明确要求复核子报告引文及分支，
而子报告只有结论和行号，没有原始源码全文，不能把全部读取视为缓存失效。
个别子报告的确定性仍需结合不透明外部 helper 契约降级，不能跳过准确性审查。

### 9.3 时间、用量和完整费用

| 量 | 本次原始技能运行 |
|---|---:|
| 墙钟 / 最后子结果到齐 | 872.27 / 694.189 秒 |
| 父 hook 请求 / 完整响应 | 8 / 7 |
| 子 hook 请求 / 完整响应 | 31 / 31 |
| 父累计粗估输入 | 235,811 |
| 子累计粗估输入 | 1,744,517 |
| hook 完整 usage prompt / cache_read / output | 2,156,436 / 1,700,352 / 41,494 |
| 父完整 API 累计秒 / 均值 | 261.120 / 37.303 |
| 子完整 API 累计秒 | 1,510.514 |
| 父工具端到端累计秒 | 9.485 |

上述是 **hook 口径**，不包含所有辅助请求和子迭代上限后的额外摘要请求。
完整 wire 共 48 次：chat 8、delegation 32、other_auxiliary 7、title 1。
额外的 delegation 是第一个子任务迭代耗尽后的既有摘要路径，不是重试；该路径不走普通
turn hook。缺少 hook 用量不能解释为免费、无请求，或用途身份已知。

2026-09-28 18:32:27（UTC+8）仅刷新结算，不运行模型。**48 个 wire call id 全部与
48 条 settled 账单一一匹配，无遗漏或额外 call id**；Decimal 合计 **$5.206063**：

| 账单用途 | 行数 | USD |
|---|---:|---:|
| chat | 8 | 0.691150 |
| delegation | 32 | 4.484378 |
| other_auxiliary | 7 | 0.026190 |
| title | 1 | 0.004345 |

最后被中断请求随后结算 $0.140447，所以最初 47 行/$5.065616 不是完整费用。
已观察请求现已全部覆盖；$5 始终只是延迟观察停止阈值，不是硬金额上限。

### 9.4 新测量排除的方向与未解决事项

复用现有 HTTP observer 将底层 next/anext 等待与调用者消费停顿分开，保留 chunk、
异常与关闭语义。七个完整 chat stream 合计：headers 49.980 秒、iterator advance
210.442 秒、consumer pause **0.510 秒**；32 个 delegation stream 的 consumer pause
合计 2.235 秒。这些是并发请求的时间和，不是墙钟，也不是纯模型内部计算时间。

父续跑三次完整响应累计 175.210 秒，其中 consumer pause 仅 0.088 秒。
中断前未出现 Responses 拒绝、失败或流重试；末次 ReadError 在 harness 中断后发生。
本次不支持“客户端流消费慢”“结果丢失”“通知迟迟不唤醒父任务”的解释。

父/子迭代预算独立，子任务不消耗父 36 次计数；这是上游
`68ab37e891` 修复共享预算饥饿后的设计。父异步续跑也有自己的回合预算。
验收的总费用/粗估输入停止器另外覆盖全任务，没有父阶段预算预留。
本次委派占账单约 86.1%，但这不足以证明应该缩减审查范围或凭通知字段少核验。

因此本轮已修的统计、信号归因及流观测缺陷是**诊断可靠性修复**，不能称作自然交付修复。
保留原始源码、任务、未完成状态及缓存语义；原始完整任务的自然交付与准确性仍未通过，
不以中断草稿、强制总结、裁剪试算或绿色离线脚本替代。

## 十、Responses 迭代收尾的前缀缺陷（离线修复；后续实测见第十一节）

沿第九节的完整账单发现一个具体代码缺陷，范围是既有的迭代上限摘要请求，
**不是父任务自然收敛的完整根因结论**。

### 10.1 实际请求证据与本地复现

第一组子任务的最后普通请求 `fafaf251-440d-48d4-a68b-d958947f53e4` 有 93 个
Responses input items；收尾请求 `7ba8b0a4-b90e-4cf5-b28b-e867bd72b8d1` 只剩 58 个。
逐项 canonical hash 的共同前缀只有第一个 user item；第二项从 reasoning 变为
function_call。收尾账单为 122,021 input、0 cache_read、1,652 output、$0.659665。
这证明请求前缀重写与一次实际零命中；不把全部费用或缓存缺失归因于单一字段，
也不承诺修复后必然省下这笔费用。旧 observer 没有保存顶层 tools/instructions 的字节。

现有 `agent/chat_completion_helpers.py::_iteration_summary_api_messages` 把面向严格
Chat Completions 的字段清理无条件用于 Responses，删除 `codex_reasoning_items` 和
`codex_message_items`，随后默认丢弃 reasoning-only 行。它也未复用正常 send path
的参数 canonicalization 与字符串处理；`_codex_summary_attempt` 另将 tools 及其
controls 全部删除。这与普通请求的历史和工具集合不一致。

独立回归通过真实 `assemble_api_request`、真实 kwargs builder 和 Responses codec，
仅拦截最终网络调用，对比普通请求与追加摘要要求后的请求。旧实现先因历史空白字节
不同而失败，并遗漏两个 replay items；有工具时 tools/control 一致性回归也失败。
这不是读取源码文本的变化检测，也不依赖再次付费采样。

### 10.2 修复范围

只扩展原函数和原测试文件，复用普通请求的 clone、参数 canonicalization、surrogate
清理与 kwargs builder：

- Responses 保留原有 opaque reasoning/message carriers、message id/phase，
  不删除其 reasoning-only 行；历史和 prefill 使用请求本地副本，不改持久历史。
- 收尾保留普通 tools/control/cache-key 设置；没有工具时仍由原 builder 省略 controls。
- Chat Completions 继续清理协议外字段，Anthropic 的 signed reasoning 路径保持原契约。
- 不增加收尾提示或新预算分支；原先的摘要路径仍不执行模型返回的工具，最多重试一次；
  子任务触及上限仍标记为 truncated，不能被算作完整任务自然交付。

Chat 路径已有 `419a050427` 的保留工具缓存修复；Responses 的旧 `16695bfa07`
处理的是“没有 tools 却留下 controls”的 400。当前修改复用现有成组构造，保留这项
兼容性约束，同时修复 Responses 历史前缀。

### 10.3 结论边界

第九节的真实运行在此修复之前完成，不能拿它证明修复收益。修复首先用离线协议
不变量验收；修复后的服务端实际缓存命中、总费用与自然交付分别记录在第十一节。
尤其 2M 门限统计的是累计粗估输入，缓存命中改善**不会自动增加这一输入余量**；
不能声称修好一次收尾缓存就必然通过完整任务验收。没有额外授权不继续付费调用。

### 10.4 修复后的离线验证与当前状态

- `scripts/run_tests.sh` 最终运行 13 个相关文件：**691 passed、0 failed、1 skipped**，
  46.1 秒；跳过项为 macOS 上的 Linux 专用信号测试，不代表 Linux 已验收。
  覆盖普通 agent、Responses adapter/transport、无工具路径、Chat/Anthropic reasoning、
  sidecar、图像拒绝、迭代退出及 harness/convergence。不是全仓库回归。
- 新前缀与 tools/control 回归先红后绿；保留真实组装和 codec，只拦截网络。
  外部 SIGTERM 归因也通过真实离线 harness 子进程先红后绿。
- 原始技能离线整链路 `offline-summary-prefix`：9.89 秒 `normal_final`，
  三个子任务、completion guard 准入、fixture 未改变、observer 自检全部通过。
  这是脚本化 provider，用于协议/集成验证，不是真实模型能力验收。
- 修改过的 Python 文件 Ruff 与 `git diff --check` 均通过。独立代码审查无阻塞项。

仍在 `codex/proactive-delegation`，基于 `4ad464e104`，本轮修改 7 个既有文件；
未新建产品模块、未提交、未推送、未合并或发布。第一轮原始证据及冻结信息已保存到
`/Users/zizimutou/.codex/visualizations/2026/09/28/01a0e70b-87de-7591-bf96-7c7c113a058b/ultra-takeover/`。
修复后的 HEAD + patch + runner 已另外冻结，用户单独授权的一次真实验收见下一节。

## 十一、修复后原始完整任务验收（2026-09-28，未自然交付）

用户在第十节离线修复完成后明确确认追加**一次**真实验收。运行
`large --live --review-skill=original`，仍使用原始六文件快照、原始审查技能、
1200 秒 / 2M 累计粗估输入 / 64 hook 请求 / 60K 输出 / $5 观察停止阈值。
没有启用 matched comparison、evidence contract、输入余量探针或自动重跑。

代码仍为 `codex/proactive-delegation`、HEAD `4ad464e1045e2d572b132d89de1055ff609516aa`
加未提交补丁；运行前冻结 patch SHA-256：
`ca0d119fff5c2b0087d1d9a64cbe4cd6a7526bfe89ffe40461beb832a5820248`。
七个源文件及实际 runner 均在启动前、运行结束后逐项核对无漂移；本节文档追加发生在
验收结束之后。原冻结件未覆盖、未以事后文档哈希冒充运行版本。

<!-- no-tmp: ok — historical evidence location, not a runtime scratch-path instruction. -->
原始现场：`/tmp/aino-ultra-takeover-20260928/live-repaired-prefix`。
持久副本在前述 `ultra-takeover/live-repaired-prefix/`，含 report、events、settlement、
convergence、controller log 与逐文件哈希 receipt；授权及源冻结文件保存在父目录。

### 11.1 停止原因与交付判据

**完整任务自然交付未通过。** `stop_reason=token_request_cap`，
`caps=[aggregate_request_or_input_threshold]`，报告墙钟 439.76 秒。
最后一次普通请求前累计粗估输入为 1,958,904，该次另加 73,987，达到 **2,032,891**，
触发 harness 本地累计输入停止器；不是服务端上下文限制。
49 个 hook 请求低于 64，完整响应 output 合计 35,553 低于 60K，
也未达到 1200 秒或 $5 观察阈值。64 个 wire 请求含辅助及额外摘要，
不能与只计普通 hook 的 64 请求限制混用。

三个子结果在 162.668 / 200.484 / 262.856 秒返回，父续跑在 262.881 秒启动。
初始 75.467 秒的 30 字等待通知虽然是 `complete` 且 sidecar 标注 final phase，
但早于子结果到齐，不是所需审查交付。续跑六个完整响应均为 tool calls；
最后一个普通请求未在 hook 中获得完整响应。437.756 秒触发中断，
438.039 秒完成事件为 `interrupted`、空正文；持久化末行仅为中断说明。
没有 `final_event`，completion guard 未准入。

因此三组各 400 字、Top 3、重要结论正确性和 limitations 保留均**尚未完成验收**；
不把子结果、工具参数或等待通知当作最终答案，也不把缺少最终稿描述为字数违规。

### 11.2 修复路径确实执行，缓存前缀保留

第一组子任务 `20260928_210718_504495` 达到 16/16 迭代上限，
既有收尾摘要路径被实际调用。比较相邻两个真实 wire：

- 最后普通请求：`b2faae1f-a225-4ea6-a4be-ab2fe2c9d632`；
- 收尾摘要请求：`6efbe789-7ab6-4dd2-a398-5c69f5d16b76`。

摘要保留普通请求 **57/57 个 canonical input item 前缀**，随后只追加新 reasoning、
function_call、对应 function_call_output 与既有摘要要求。第九节未修复运行则只保留
1/93 项。这是对 native input/carrier 前缀修复的实际验证；observer 未单独记录顶层
tools/control 哈希，不能从该现场证明这些顶层字节相同，其契约由离线真实组装测试覆盖。

对应摘要账单已 settled：cache_read **142,068**、cache_creation 934、
普通 input 75、output 1,492，费用 **$0.12200650**。前一普通调用的 cache_read 为
141,172，费用 $0.10006600。与实际前缀证据一起，说明本次摘要发生了缓存复用。
旧摘要的零缓存 / $0.659665 是另一条运行轨迹，不能据此宣称精确的因果节省比例。

第一组的 durable metadata 仍是 `exit_reason=max_iterations`、`truncated=true`；
修复没有把被截断子任务改标成自然完成，也没有自动执行摘要返回的工具。

### 11.3 父子用量、时间与全部费用

| 范围 | 普通请求 / 完整响应 | 累计粗估输入 |
|---|---:|---:|
| 父初始回合 | 4 / 4 | 28,828 |
| 父续跑 | 7 / 6 | 389,654 |
| 第一组子任务 | 16 / 16 | 1,026,931 |
| 第二组子任务 | 12 / 12 | 375,639 |
| 第三组子任务 | 10 / 10 | 211,839 |
| 全任务 hook | **49 / 48** | **2,032,891** |

子任务合计 1,614,409，父任务合计 418,482；这些是按持久 session 身份统计，
不依据有无响应猜测用途。全部请求都纳入总计。
父完整 API 10 次累计 239.347 秒 / 均值 23.935 秒，
子完整 API 38 次累计 382.969 秒 / 均值 10.078 秒；并发时间和不是墙钟。
父 37 个工具均有成对开始/完成，端到端累计 8.346 秒。

只读刷新结算后，**64 个 wire http_call_id 与 64 个 settled desktop_call_id 完全匹配**，
无缺失、无额外 ID。Decimal 合计 **$4.55802350**：

| wire / 账单用途 | 行数 | USD |
|---|---:|---:|
| chat | 11 | 0.80414900 |
| delegation | 39 | 3.69660450 |
| other_auxiliary | 13 | 0.05255500 |
| title | 1 | 0.00471500 |

39 次 delegation 比 38 个普通子 hook 多出的请求是上述迭代上限摘要。
最后被中断的父 wire 亦已匹配账单；不能将未获得完整 hook response 当成零费用。
$5 始终是延迟观察停止阈值，非硬金额上限。本次未触发费用停止器，未自动重跑。

### 11.4 运行差异、证据范围与剩余问题

相同原始配置下，两次父模型自主选择不同：
旧 `live-original` 对三个子任务显式设置 `reasoning_effort=high`、`context_turns=all`；
本次均省略 effort/model 并设置 `context_turns=1`。默认继承父 ultra 后，
transport 映射为 max；这符合现有 task > delegation config > parent 的优先级与
本分支优先继承的设计，未发现档位解析漏洞。差异发生在首次子请求，早于摘要路径。
因此两次总耗时/费用不能当作严格对照，也不能把变快、变便宜全部归功于此修复。

六个源码 fixture hash 不变，四个 session 各只有一个 system hash。
父续跑继续核验，执行 **26 次 read_file + 8 次 search_files**，
没有精确重复工具调用或字数计数调用。两次尝试读取快照外的
`tools/delegate_tool_dispatch.py` 与 `tools/delegate_tool_child_run.py` 都返回
File not found、未获得源码；需如实保留越界尝试，不把 fixture 未变等同于范围完全合规。

本次直接阻断交付的是总输入停止器：子任务已消费约 161 万粗估输入，父继续核验时
触及 2M。这并不证明无限预算、更多预算或任意新提示就能使任务完成。
缓存前缀修复已获得实际执行证据；完整任务的自然交付、准确性与稳定性**仍未达成**。
后续若调整委派/核验成本，须先沿现有机制离线验证，独立冻结并申报实验边界；
本次授权不涵盖额外付费重跑。不扩预算、不将中断草稿升级为最终答案。

本轮运行后仅追加该诊断记录，未新增产品机制、未继续修改运行时。
仍有 7 个既有文件未提交，未推送、未合并 main、未发布。

## 十二、继续修复：现有读取准入限额候选（2026-09-28）

用户要求继续完成直至问题解决。按实际请求重建生产粗估器，并逐项核对 native input
hash 后，49 个普通请求均与原记录一致；未发现大规模重复 carrier 或读取限额绕过。
第一组子任务 1,026,931 累计粗估输入中，read_file 占 757,554、search_files 占
146,691，合计 88.1%。其最后四次普通请求只用于改稿计数，分别带入
99,158 / 100,376 / 101,095 / 101,748 输入，合计 402,377。
三组子任务分别有 4 / 6 / 3 次计数调用；已有的避免反复数字数指导已实际进入子提示，
不能把它诊断成提示未传递。当前不继续叠加同类文字规则。

仅扩展完全覆盖区间的 dedup，按原轨迹最多少约 40,183 粗估输入（约 1.98%），
第一组无收益；不把这种小优化包装成主问题修复。

### 12.1 当前候选及复用边界

复用现有 `file_read_max_chars` 配置，隔离候选为 **40,000 字符**；产品默认 100,000
和已安装用户配置保持原样。已有 file tool 在新结果进入历史前按完整行截断并提供
`next_offset`，既不改已有历史，也不删除底层源码。这个值是待验证的配置选择，
不是已证明最优值或上游缺陷修复。

只在现有 harness / runner 增加 `--file-read-max-chars` 转发，正整数、仅 fresh Aino
场景；源拥有配置的 replay 及原生 Codex 不接受该覆盖。报告 `config` 明确记录它。
原始 prompt、skill、六个 fixture、父子推理配置和总停止条件均未改变，
模型自主选择的分工/effort/调用轨迹仍可能不同，不能称严格因果 A/B。

### 12.2 离线证据与代价

- 真实 profile A40K→B100K→A40K、真实 loader / 文件工具，完整分页无缺行、
  重复行或 Unicode 损坏；部分读取不能全量覆盖写，完整分页及压缩后的 baseline
  可覆盖写，写后重新读取得到新内容。没有操作真实用户 home。
- 原始六文件分别以两种限额完整分页，12 项重建一致且源码 hash 不变。
  全量阅读调用从 9 次增加到 15 次，不能声称小页永远更便宜。
- 重放 40 次已记录直接读取，只有 4 个子任务结果改变，父 26 次读取全部不变。
  首次返回 content 607,002→500,277 字符；JSON 634,322→524,522 字节。
  补齐同一批原来返回的所有行则需 5 次额外分页、共 45 次调用，JSON 635,701 字节。
  若不补页，少 1,482 个 compressor 行和 129 个 delegation 行，尚未证明无关。
  因而候选依赖模型按问题选择后续范围；不能以被截断的同请求重放宣称净节省。
- 原始技能 scripted RPC：`offline-read-cap`，9.38 秒 normal_final、3 子任务、
  guard 准入、fixture 未变；只证明集成，不证明真实收敛或答案质量。
- 新配置对照行为测试证明 prompt/skill/fixture/总体限制不被覆盖。根代理新跑
  3 文件 **119 passed、0 failed、3 host-specific skipped**；Ruff、diff check、
  Electron runner 构建/help 均通过。该阶段没有更改生产运行时。

### 12.3 执行与验收计划

1. 保存此候选 patch / 源码 / 实际 runner hash，与 40K profile 参数一起冻结。
2. 在用户继续执行的授权范围内，下一次只验证这一配置：从原始任务开始，
   1200 秒、2M 粗估输入、64 普通请求、60K 输出、$5 观察停止阈值；
   不在运行中调节，不以同配置盲目重跑，结算可能因延迟超过观察阈值。
3. 结果依旧要求父自然最终答案、三组各 400 字、Top 3、重要语义正确、
   疑点边界及完整费用。检查截断后实际分页与准确性，不能靠漏读取得表面胜利。
4. 如果通过，才决定怎样把已验证配置应用到实际产品配置；现阶段不擅自
   修改用户日常 profile、不把 isolated harness 参数当作已部署修复。
5. 如果失败，保留原始证据再决定下一项独立、可复核改动；不放宽原题或预算。

### 12.4 40K 真实结果：未交付，不采用为产品默认

`live-read-cap-40000` 的冻结 patch SHA-256 为
`a85bca58bf7e487ff21aa61e3662c22dedb2ec82a1aea27135ea01ef8d1f6c56`；
运行后逐一核对 10 个源码文件及实际 runner，全部与冻结 hash 一致。
控制器观察金额 $5.096941 后发 SIGTERM；harness 在 1200.404 秒记录
`external_signal`，最终 elapsed 1202.41 秒。计时起点不同，不能据 elapsed
越过 1200 就改判 timeout；`caps=[]`，不是输入上限停止。

- 43 个普通 hook 请求 / 40 个响应，累计粗估输入 **1,916,518**。
- 父工具仅 2 次 skill_view 和 1 次 delegate_task；父没有进入实质核验。
  134.059 秒的等待说明不是最终审查答案。
- 第一组于 1178.335 秒返回，但 durable metadata 为 `max_iterations`、
  `truncated=true`、16 次普通调用；其余两组中断。无合格最终事件，guard 为 false。
- 52 个 wire ID 与 **52 个 settled 账单**一一匹配，Decimal 合计
  **$5.33543200**。末笔已计费但本地零字节 / ReadError，不能据计费推断成功交付。
- 六个 fixture hash 不变；40K 限额真实生效，却没有得到原任务自然完成。

与前轮相比，第一组读取从 7 增到 14 次，实际源码字符从 286,488 增到
347,224；同会话同文件同行同内容重复读取从 50 增到 1,157 行。不同模型
轨迹不能证明该限额导致重复，但也没有依据继续将 40K 作为修复推进。

两轮子任务实际都为 Max。子普通 API 时间和从 382.97 增至 2,866.02 秒，
多数时间在 stream iterator 等待而非本地消费。第二、三组出现 521/527 秒
长调用；其中后者 provider prompt 仅 39,235 tokens。记录不能进一步区分
远端排队、模型计算调度和网络，也不能把全部等待称为纯生成时间。

本轮第一组迭代上限摘要仍保留 **81/81** canonical 历史 input 项，并命中
139,776 cache-read tokens；前缀修复确实执行，但没有解决整个任务交付。
运行、停止与费用完整证据存于本次本地 `ultra-takeover/live-read-cap-40000/`。

## 十三、候选取舍：复用现有档位配置，暂不叠加压缩

现有 `delegation.compression_threshold_tokens=96000` 已完成真实
profile A→B→A、子构造、模型重解析、cache-inclusive usage 和生产压缩入口的
离线验证。真实轨迹投影表明只会触发第一组：前轮第 7 次、40K 轮第 8 次。
另两组均达不到阈值；40K 轮 81.3% 子 API 时间发生在 96K 以下。
更关键的是，压缩先将早期源码结果变成短标记，再生成摘要，两轮都会丢失
`compaction_display.py` 的完整证据。故只证明机制可用，不能证明语义保持或
自然交付改善；**下一候选不启用该设置**，避免把丢证据当作节省。

下一候选只显式配置既有 `delegation.reasoning_effort: high`；父 Ultra、
原始技能/题目、100K 原读取默认、2M / 64 请求 / 60K 输出 / 1200 秒限制均保留。
任务显式选择仍高于此配置，不强制 clamp 所有子任务。历史原始运行由模型
显式选 High，之后两轮省略档位而继承 Max；这是配置与自主决策差异，
**不是档位继承实现漏洞**，也不能从不同运行证明 High 必然更快。

为了不启用会移除原始技能、改写题目的 matched-comparison，harness/runner
增加可选 `--child-reasoning-effort=high|max`，仅写隔离 profile 的已有配置。
另保留独立 `--child-compression-threshold-tokens` 供离线验证和后续明确实验；
无新产品设置、无日常 profile 修改、无模型提示追加。真实验证尚未执行。

## 十四、问题归属：已确认的上游代码与尚未证明的整体归因

对照本地上游快照 `524041b9d0437cd4424a524af4b9e26145e69ab0`
（提交日期 2026-09-21；不代表已核实 2026-09-28 最新远端）与分支 HEAD：
`_iteration_summary_api_messages` 无条件删除 Responses replay carriers，
`_codex_summary_attempt` 删除 tools/control 的行为已在上游存在。
分支 checkpoint `d285ae5a0e` 对该模块仅增加显式子档位在 fallback 中保留的
逻辑，没有引入上述摘要行为。因此这项已证实的前缀缺陷是继承问题。

完整任务迟迟不交付尚不能整体归责上游或二改：修复前缀后仍有输入/时间
停止，现场同时涉及 Aino Ultra 协作、原任务核验要求、模型自主分工与
实际服务耗时。没有纯上游+同路由+同任务的完整对照，不能声称上游必然
失败，也不能承诺回退二改即可成功。

## 十五、档位收益未定与验收输入口径策略调整（2026-09-28，接手复核）

本节只用三轮**已记录**数据重算，没有新增付费运行，也没有新的自然交付通过。
按 `api_request_id` 连接请求、响应与 `api_duration`；部分 hook 展示被截断，
不能把其中缺少 `wire_reasoning.effort` 当成真实发送档位未知。原始 wire 元数据
可恢复下列已完成响应的实际档位。

### 15.1 High 子档位候选：收益未定，暂缓；不声称已被反驳

**撤回本节初稿的因果结论。** 初稿只取 hook 中可见档位，跨轮分池后得出
「High 反而慢约 4 倍」；该统计遗漏大量响应，且没有轮内档位对照。

| 轮次 | 已完成子响应 | hook 档位可见 / 缺失 | 实际 wire 档位 | 子 API 秒数合计 | 均值秒 |
|---|---:|---:|---|---:|---:|
| live-original | 31 | 15 / 16 | High | 1,510.514 | 48.726 |
| live-repaired-prefix | 38 | 24 / 14 | Max | 382.969 | 10.078 |
| live-read-cap-40000 | 36 | 16 / 20 | Max | 2,866.024 | 79.612 |

此表按已完成响应计，40K 轮另外两条子请求没有完成响应。初稿漏掉
**50/105（47.6%）** 个已完成响应，包括 521.078 秒和 527.421 秒两个长尾。
补全后的 High 池为 n=31、均值 48.726 秒、中位数 18.099 秒、最大 292.061 秒；
Max 池为 n=74、均值 43.905 秒、中位数 19.732 秒、最大 527.421 秒。
API 秒数为跨子任务求和，不是运行墙钟时间。

**High 全部来自原轮，Max 全部来自另两轮，没有任何轮内 High/Max 对照。**
跨轮统计混入模型自主分工、读取量、任务内容与服务耗时差异，不能分离档位影响。
原轮有子任务返回，但整体任务没有自然交付；不能写成「High 子任务没有完成任务」。
同为 Max 的两轮 API 时间合计相差约 7.5 倍，只说明运行间差异很大，不能据此
证明档位不可能主导耗时，也不能证明 High 更慢或 Max 导致增长。

**High 候选的收益尚不确定（unproven benefit），不是已被反驳。** 现有数据
不足以判定收益；一次验收约 $5，暂缓执行。`--child-reasoning-effort=high`
保留为可用参数，本节不授权下一次付费运行。

### 15.2 验收策略调整：输入闸门改按「排除缓存读取的输入」计

**撤回初稿的「已证实错误」表述。** 旧口径累加每请求 `approx_input_tokens`
（来自产品侧 `agent/turn_api_request.py:81`，是该次请求**完整上下文**的估算），
于是每个请求把重新呈递的前缀再计一遍。这**不是算错**——它是一条自洽的、
更严格的策略：约束经 API 推送的总上下文体积。本次改动选择另一条更宽松的
策略，属验收策略调整，不能把新口径下的 2M 与旧 2M 验收基准直接比较。

旧口径的实际形态，live-repaired-prefix 第一组第 16 次请求：

```
  #  approx_in     delta     prompt  cache_rd  cache_write  uncached    out
 16    101,748      +653    142,143   141,172          884        87    784
```

该请求向旧闸门贡献 101,748；排除缓存读取后的已完成输入为 **87 + 884 = 971**，
不是 87。三轮汇总如下；token 列覆盖普通已完成 hook，结算列覆盖全部已结算 wire，
两者覆盖范围不同，不能作为同一组请求的成本分解。

| 轮次 | 旧口径（as scored） | prompt | cache_read | cache_write | uncached | 全部 wire 结算 |
|---|---:|---:|---:|---:|---:|---:|
| live-original | 1,980,328 | 2,156,436 | 1,700,352 | 0 | 456,084 | $5.206 |
| live-repaired-prefix | **2,032,891** | 3,280,311 | 2,981,688 | 208,644 | 89,979 | **$4.558** |
| live-read-cap-40000 | 1,916,518 | 2,156,210 | 1,675,776 | 0 | 480,434 | $5.335 |

修复轮普通 hook 的缓存读取占比为 90.9%，但该统计**不含修复后的摘要调用**，
不能据此证明前缀修复提高了整体速度。前缀修复的直接摘要请求与缓存证据见 §11。
修复轮墙钟 439.76 秒、原轮 872.27 秒，也是不同运行的观察结果，不能从缓存
命中率直接推出单位时间请求数或整体耗时的因果关系。

修复轮子任务按旧口径合计 1,614,409，占 79.4%；这是该轮实际读取和迭代轨迹
的结果，不是「三个子任务只要存在」就必然消耗的固定输入。

### 15.3 新指标定义与实现

新指标名为 **`input_excluding_cache_reads`**。共享的纯计数与观测 helper
放在既有 `evals/ultra_delegation/convergence.py`，harness 与测试正常导入，
不再通过 AST 抽取代码测试。按唯一 `api_request_id` 计
**`uncached_input_tokens + cache_write_tokens`，再加经过验证的未结算预留**。

缓存写入必须计入所选策略，但它只是供应商的 usage 桶，**不衡量逻辑内容是否
首次出现或是否唯一**。初稿漏计修复轮 208,644 个 cache_write；该轮已完成
非读取输入为 298,623，加预留后的正确最终值为：

```
uncached 89,979 + cache_write 208,644 + reserved 73,987 = 372,610
```

该指标不是「全部新增输入」，也不是「实际费用」：被排除的缓存读取仍是供应商
处理的输入，且写入、读取、未缓存输入的单价不同。usage 桶不支持逻辑新颖性结论。

**逐 request id 的判定：完整、有效且守恒的 usage 才能替换预留。** 守恒条件是
`prompt = uncached + cache_write + cache_read`，桶值及预留均须通过数值校验。

| 情形 | 处理 |
|---|---|
| 完整有效且守恒的 usage，重复记录一致 | 按唯一 id 计实测值 |
| usage 缺失、非法、不完整或重复冲突，有有效粗估值 | 保留经过验证的粗估预留，不任选一条 usage |
| 有 id 的有效守恒响应未匹配请求 | 计入并在报告中单独列出 |
| 无法定量，或事件缺少可用 id | `accounting_complete=false`，以 `input_accounting_incomplete` 停止 |

未知工作量不能静默按零计。运行时请求/响应追加与计数观测共用既有锁，使一次
观测只对应一个原子事件状态。`pre_request` 与 `post_request` 双点复核仍复用
既有阈值模式。报告的 `input_accounting` 同时记录新旧数字，
`limits.cumulative_input_basis` 与 `cumulative_input_policy` 标明口径及不可比较性；
保留 `limits.approx_cumulative_input` 键名以兼容现有报告消费者。

### 15.4 旧运行复算：最终值、记录顺序峰值与首次触发位置

该指标**非单调**：预留粗估值可能被更小的实测值替换，结束总数不能代替峰值。
重放必须逐条按事件文件追加顺序处理，某步只能使用此前已经出现的响应；
**不能预载未来响应**。跨越一旦发生即记录 `ever_crossed`，不会因随后回落而清除。

| 轮次 | 旧口径（as scored） | 新口径最终 | 记录顺序峰值（事件行 / 秒） | 首次触发 2M | 完整 usage / 请求 |
|---|---:|---:|---:|---|---|
| live-original | 1,980,328 (<2M) | 534,786 | **601,532（605 / 510.673）** | 从未 | 38/39 |
| live-repaired-prefix | **2,032,891 (≥2M)** | **372,610** | **372,610（926 / 437.713）** | 从未 | 48/49 |
| live-read-cap-40000 | 1,916,518 (<2M) | 590,208 | **614,497（650 / 826.949）** | 从未 | 40/43 |

不可变复核证据为
<!-- no-tmp: ok — historical evidence location, not a runtime scratch-path instruction. -->
`/tmp/aino-ultra-takeover-20260928/accounting-review/recorded-event-input-peaks.json`，
内含源事件哈希与峰值邻近事件。三轮没有时间戳逆序；按时间稳定排序并以原始行号
打破同值的敏感性检查，得到相同峰值。最终预留请求数为 1 / 1 / 3，冲突与未匹配
均为 0。修复后的共享 helper 也按追加顺序重放得到相同结果，三轮计数均完整；
已保存的本机私有证据（不随仓库分发）位于：

```
/Users/zizimutou/.codex/visualizations/2026/09/28/01a0e70b-87de-7591-bf96-7c7c113a058b/ultra-takeover/accounting-review/shared-accounting-replay.json
```

同目录的 `replay_shared_accounting.py` 正常导入共享 helper；三个位置参数依次
为仓库目录、三轮归档的父目录、输出路径，复跑需提供对应本机路径。harness 的
启动时源文件快照已纳入 `convergence.py`。

这些是**记录顺序的反事实重放值**。旧运行没有实时观察新指标，日志追加顺序也
不能证明当时跨线程数组变更与观测的实际调度，所以不能称为旧运行的精确实时峰值。
当前共享锁修复建立今后的原子观测语义，不反向补造历史调度证据。

**历史结果不变**：三轮原始 `stop_reason`、`caps` 与未交付判定原样保留。
原轮 raw report 仍为 `stop_reason=token_request_cap`、`caps=[]`；§9 已核验的
控制器证据表明花费观察器发出 SIGTERM。两项分别记载，不能改写 raw report
或把其标签误当成已经证实的输入闸门触发。此次复算不重新评分，也不产生自然通过。

### 15.5 分析器按报告自身口径解释

`convergence.py` 的 `_ceiling_basis(report)` 按报告中的 `input_accounting`
解释口径、峰值与首次触发；**缺该字段的旧报告保持旧语义**
（`approx_represented_input`，标注 `recorded_in_report: false`、
`policy: pre_change_default`），并声明与新口径运行不可比较。计数不完整时，
报告必须显示该状态，不能用无法定量的值形成可信验收通过结论。
原生 Codex 驱动单独标注为独立预算策略（自带 limits，不受 Aino observer 的
per-request hook 管辖），其数字不与 Aino 驱动运行并列比较。

### 15.6 本次修复与验证

本次通过正常模块导入测试共享计数逻辑，移除了读取源代码、抽取 AST 后执行的测试方式。
完整桶缺失的反例先红：input_excluding_cache_reads 实际为 1,000，预期保留
25,000 粗估预留。修复后覆盖不完整/非法/冲突 usage、重复请求粗估取最大有效值、
有效零值、未知 id、缺失 id、计数不完整，以及预留结算下降后停止状态不被清除。

实际加载完整 harness 的 hook 测试还验证：请求上限到达时仍有最后一笔观测，
两笔请求的 (requests_recorded, value) 为 (1, 25000)、(2, 30000)；
缺少有效粗估且尚无 usage 的请求触发独立 input_accounting_incomplete 停止。
生产 hook 的事件追加、计数、观测记录与停止标志均在同一既有 RLock 内。

**最终免费回归：6 个文件，401 passed、0 failed、1 skipped**（macOS 上跳过
linux_only）：评估文件 53 passed / 1 skipped，其余 5 文件 348 passed。
全部通过 scripts/run_tests.sh 运行。Ruff、语法编译、git diff --check 通过；
既有 esbuild 运行器重建后与上次冻结产物逐字节一致，Electron --help 正常。

如实保留中间失败：首次完整评估文件为 52 passed / 1 failed / 1 skipped，
失败来自新增探针从被运行时重定向的 sys.stdout 寻找回执。只将测试回执改为
sys.__stdout__ 后，针对性测试与整文件复验通过；没有修改生产逻辑绕过该失败。
首次失败与最终日志均保存，最初计数红灯的独立原始日志未保存，记录标明来自工具输出。

原始私有技能的免费脚本模型通过真实桌面 RPC 跑出 3 个完成子任务、
normal_final、completion_guard.eligible=true、fixture_changed=[]。
18 次 hook 观测均与当时已记录事件前缀逐项一致，计数完整且未越限。
这只证明集成路径，**不能替代真实模型自然交付和答案准确性验收**。
启动时的源文件快照与最终候选匹配；原始技能两文件哈希未变。

证据保存在本机 ultra-takeover/accounting-review/ 及
ultra-takeover/offline-accounting-complete-frozen/，新冻结清单为
accounting-complete-candidate-freeze.json。旧冻结清单保留，不覆盖或重新评分历史运行。
本轮相对上一候选只变更 5 个评估/测试/文档文件，已有前缀修复保持原样。
未发起付费模型调用、提交、推送、合并或桌面重启。

### 15.7 边界

这是**验收策略调整**，不是交付已通过，也不是「原停止条件不变」——新口径实质
**放宽**了输入上限，此前三轮在旧口径下的判定原样保留。

口径调整**不保证任务能完成**：修复轮停止时已用 49/64 请求、439.76/1200 秒、
35,553/60,000 输出，但 **$4.558/$5 已接近**——即使输入闸门不再触发，费用观察器
仍可能随后触发。下一次真实验收需单独授权。

## 16. 免费后续定位：交付流程与审批等待

本节复盘 live-accounting-complete，未新增模型或网络调用，未调整原题、技能、
审批政策、模型档位或限额。调查没有发现新的可复现运行时机制错误，不等于整体问题解决。

### 16.1 子任务耗尽的具体过程

| 子任务 | 普通 API 轮数 | 改稿/计数轮 | 退出 |
|---|---:|---:|---|
| ① | 14 | 0 | 正常文本结束 |
| ② | 15 | 9（8次执行、1次被拒绝） | 正常文本结束 |
| ③ | 16 | 9（初稿1次、修改8次） | 迭代耗尽，另有摘要，truncated=true |

③的其他轮数为2轮技能加载、5轮源码检查。第8–16轮的稿长依次为
752→601→463→460→413→411→392→406→400。第14轮已经低于400；随后为范围声明
再改两轮。耗尽后的406字摘要仅比最后草稿增加三处Markdown双空格，不能算自然交付。
400来自原题→父委派context→子临时system；三份有效system的离线重建哈希逐一匹配
历史子请求，每份只有一处400。17次成功计数均正确，未见旧稿、kernel重置或串状态。

16是harness的delegation.max_iterations，生产delegate_tool默认250。execute_code
只退还IterationBudget，不退还独立API轮数上限，符合既有设计。迭代预警是未开启的
opt-in，不能把本轮没有预警判为通知故障。

### 16.2 辅助调用已精确归因

临时HERMES_HOME、禁网和MockTransport下，复用生产审批→辅助客户端→Responses SDK
重建的18个唯一完整body哈希覆盖全部22个other_auxiliary wire：都是上述计数脚本的
智能审批。②为9次逻辑审批/13个wire，③为9/9，零未匹配。

②的execute_code日志耗时之和305.91秒，审批尝试跨度之和302.737秒；③分别为36.24秒
和36.123秒。两个孩子并行，不能将其相加当墙钟。审批账单合计$0.08732000，因此主要
问题是等待时间，不能说它解释了整次$5.001347的费用。

4个重复body组先发生30秒ReadTimeout后重试成功。最后一次则是超时→连接错误重试→
升级审批→harness选择拒绝，不是用户真人点了拒绝，也不是模型明确判为危险。
入口max_tokens=16在既有路由策略中已被排除；历史wire没有输出上限或reasoning字段。
因此不能归因为16个隐藏推理token耗尽，也不能说显式继承了High/Max。供应商默认effort
及首包延迟原因未知。检查的审批/辅助路由相对既有合并检查点无差异，尚未证实二改bug。

### 16.3 父任务核验没有工具返回损坏

47次read和13次search分为8批：20/7/5/6/4/4/8/6。请求窗口、实际行号、行文本、
父history及wire输出哈希一致；无字符预算丢尾。45个read的truncated仅表示文件还有后页。
6个search有明确分页截断且均为offset=0，未继续取后页。

无精确参数重复。5,255行次覆盖3,718唯一行，重复行次1,537（同批610、跨批927）。
重叠不等于无必要：同批model_switch.py:415–474完整包含445–474，确可在规划时合并；
后续delegate_tool.py:180–304则补齐此前未返回的181–234，不能整段删除。
另有目标选择错误：父读delegate_tool.py:110–144，但引用的_get_max_async_children
实际位于delegate_tool_config.py:121–132。工具正确执行了模型参数。

现有read缓存按(path,offset,limit)精确匹配；不同窗口不命中是既有契约，不应擅自省掉
请求窗口中的行。父收到完整4,313字符通知，且明确含exit=max_iterations/TRUNCATED。
不能用UI截短摘要推断通知丢失。逐次核验必要性及因果贡献未完整评分，未知项保留unknown。

### 16.4 后续可复用路径与边界

本轮仅更新这份既有诊断文档，不再盲补生产代码、加预算或叠加收尾规则。
下一阶段应改进委派交付分工，而不是修改正确的计数、文件读取或安全审批实现：

1. 复用goal/context/output_schema，让研究子任务交付发现、触发条件、精确证据和limitations，
   父任务负责三组中文、400字与Top 3。已有evidence-contract变体可诊断这种分工，但它改变
   提示契约，不能冒充原始验收通过；不改原技能或对历史结果重新评分。
2. 父核验先校准文件和符号，再复用已有history中的证据，合并同批包含/相交窗口；对缺少
   的调用链正文继续核验，不把所有重叠都视为冗余，也不新增读文件工具。
3. 保留审批安全边界。已有auxiliary.approval.reasoning_effort/模型路由可以构成单独候选，
   但省略effort不证明深度过高，较低effort的速度和安全性均待验证，不能直接关闭审批。
4. 先确定单一候选及免费非回归条件，再申请真实验证；没有新的付费授权，不启动模型实验。

逐轮、逐调用及禁网复现证据位于本run的child-iteration-diagnosis、
parent-verification-diagnosis、auxiliary-path-diagnosis的JSON/MD，持久副本与§15目录相同。

### 16.5 委派分工候选（离线验证）

现有`delegate_task`的`goal`和`context`字段说明已补充分工：研究子任务请求发现与证据；
当子任务只负责收集证据时，最终报告的篇幅、版式和排序由父任务负责。这只改变工具定义的
字段说明；不改原题、技能、子任务执行器、输出校验、读取工具、审批或运行限额。
它不能强制模型遵循分工，也不能由脚本模型证明真实模型会减少改稿。

`scripts/run_tests.sh`定向委派测试122项通过；离线脚本模型经实际RPC完成3个子任务和
父最终消息，`stop_reason=normal_final`、`fixture_changed=[]`。这验证字段说明更新后
注册与委派交付链路可运行，不是原始任务的付费验收。父任务同批重叠读取的合并仍未实施；
未经证实其必要性与安全边界前，不修改文件工具或丢弃已请求的返回内容。

### 16.6 原始任务真实验收：子任务阶段触发输出上限

2026-09-29获授权的一次真实运行保存在
<!-- no-tmp: ok — historical evidence location, not a runtime scratch-path instruction. -->
`/tmp/aino-ultra-takeover-20260929/live-delegation-schema/`；`report.json`、
`events.jsonl`和`settlement.json`的持久副本位于
`/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-takeover/live-delegation-schema/`。
使用原题及原始
`read-only-source-review`技能，1200秒、2M `input_excluding_cache_reads`、64请求、
60K累计输出、$5观察费用阈值；未启用`matched-comparison`或`evidence-contract`。
运行867.94秒，`stop_reason=token_request_cap`，其具体`caps`仅为
`aggregate_output_threshold`。28条已响应请求共输出61,665 tokens，其中
55,430为reasoning；父任务2,221，三个子任务分别24,485、20,942、14,017。
首次越过60K发生在第三组第6条已完成响应后（累计55,531→61,665）。
第①、③组各有一条在途请求被中断，不能推断本来会如何结束。

输入计数最终值与运行中峰值均为638,753，未触及2M；31条普通请求、28条响应，
3条无有效usage的请求按粗估值预留。父任务只调用2次`skill_view`和1次
`delegate_task`，未收到完整批次；第②组正常完成，第①、③组中断。
无父最终答案，`completion_guard.eligible=false`，故完整自然交付和最终答案准确性
均未通过验收。fixture未变化，四个会话各自的system hash稳定。

本次工具字段说明的预期分工**没有出现**：父调用的三个子任务`context`仍逐项写入
“三组结论各不超过400字；最终需要从三组中汇总最值得优先验证的三个风险”，并为
子任务设置包含`conclusion`的JSON `output_schema`。原始技能第3步明确要求父向
子任务传递请求的语言和篇幅限制，与本轮新增的通用工具字段说明直接冲突。代码路径
显示字段说明属于已注册的`DELEGATE_TASK_SCHEMA`，动态覆盖只替换顶层及`tasks`
说明；但本次保存的wire记录只有body哈希和结构摘要，**没有保留完整工具定义文本**，
因此不能声称逐字核实了本次请求上的字段说明。真实委派参数足以证明目标分工未实现，
不足以证明单独哪个提示因素造成模型选择。§16.5的两段字段说明已撤回；历史运行
及离线结果不重新评分。

第②组的JSON有两条候选确定问题。预算预扣位置可在快照`delegate_tool.py:511-530`
复核；批量构造中途失败可在`:368-420`见到返回空列表的路径，但“前序子项
SessionDB一定泄漏”还依赖快照外的关闭/注册机制，不能仅凭本轮子输出升为已证实
产品缺陷。这只是子任务中间结果，父任务未核验，不能代替整体答案准确性验收。

运行结束时的`settlement.json`于2026-09-29 02:25:58Z抓到29条全部
`settled`的账单，合计$4.669198（chat $0.179382、delegation $4.484286、
title $0.005530）。这是**当时已入账项目**的金额；三条普通请求无响应记录，
后续若补记，最终金额可能变化。$5是延迟观察停止阈值，不是硬上限。
本次付费授权已用完，未自动重跑或增加限额。下一步若仍以原始技能和原题验收，
应先离线研究输出消耗为何集中在子任务推理，以及原始技能/任务的篇幅契约，
再形成单一候选；不能把提高60K上限或覆盖原技能视作已经验证的修复。

撤回字段说明后的定向回归通过`scripts/run_tests.sh`运行：4文件、95项通过、
0失败（`test_delegate`、`test_delegate_group_schema`、`test_delegate_reasoning_effort`、
`test_delegate_interrupted_partial_output`）。其余接手前的未提交修复保留；
本轮未提交、推送、合并或重启桌面。

## 17. v0.21.5 合并后的恢复修复与 400 字边界（2026-09-29）

本轮在 `codex/proactive-delegation`、HEAD `32371ee0bdaa4a56079e6bf5ce5481c79e84cc81`
继续。先前因“只合上游”而暂缓的子任务档位补丁已恢复，并补全双协议回归。
§17.1–17.3记录付费验证前的离线检查；随后获授权执行的真实原题结果见§17.4。

### 17.1 已证实并修复：配置档位在模型回退后丢失

`_build_child_agent` 初始采用有效的 `delegation.reasoning_effort`，但此前只有
任务显式 override 会保存到 `_delegate_reasoning_config_override`。模型发生
fallback 后，既有 `_reresolve_fallback_reasoning_config` 因缺少该属性而重新
采用模型/全局默认值，令配置 High 或关闭推理的孩子变为 Ultra（wire Max）。

修复只复用该 override 属性：任务显式值优先，其次有效 delegation 配置；
缺失/无效配置保持继承路径。父 Ultra、普通 agent 的 fallback 重解析均不改变，
没有增加 fallback 分支、工具或缓存前缀改写。

真实 loopback HTTP 测试先返回主模型 404，再由备用模型成功返回，覆盖
Chat Completions / Responses × 配置 High / False / 配置 High 与任务 Max 冲突。
同时验证两次实际请求的模型、协议、effort、子最终配置与父配置。原 Responses
测试服务先返回成功、绕过 404 的缺口也已纠正。

- 仅恢复测试时：7 passed / 4 failed，四项失败均为 High/none 回退后变 Max。
- 恢复生产修复后：11 passed / 0 failed。
- 相关委派、schema、协议与 fallback 回归：9 文件 / 171 passed / 0 failed；
  单 worker、禁自动重试，使用 `scripts/run_tests.sh`。Ruff、diff 检查通过。

该缺陷有独立红→绿证据，但 §16.6 没有配置 High，也未观测到模型 fallback，
所以不能称它解释或解决了那轮自然交付失败。配置 High 的收益仍是待实测假设。

### 17.2 400 字属于本地验收题，不是产品限制

<!-- no-tmp: ok — historical evidence location, not a runtime scratch-path instruction. -->
截图中的旧 `/tmp/aino-ultra-acceptance-20260925/harness.py` 与当前
`evals/ultra_delegation/harness.py` 均把“每组结论控制在400字以内。”写入
人工构造的 `large` 任务，通过普通 `prompt.submit` 发送。上游 `v2026.9.24`
没有该本地验收目录，也没有这条报告要求。此前本文所称“原题”指这道本地
验收题，不能理解成用户日常需求或 Hermes 的通用规则。

它的作用是要求紧凑报告，不是 token 预算或 400 字截断。400 这个具体数值没有
已证实的产品必要性，最初选定数字的原因无足够记录。§16.1 已观察到由此产生
的改稿/计数，不能把这个事实扩大为唯一根因。日常产品路径不自动加载 harness
或该句；显式运行该验收、或把这句放进普通任务时，模型才会按任务要求处理。

原 `large` 保留以便复现历史受限任务，不把它提升为日常默认约束。已有 `daily`
不含该要求，应独立报告；它的题目、fixture 和预算不同，不是严格同题 A/B。
`--review-skill=none` 和 `--evidence-contract` 也不会去掉 large 的 400 字要求。
本轮没有改验收 prompt、原始技能或历史评分。

### 17.3 免费端到端链路验证及下一次验收边界

复用现有 harness，以隔离 HOME/profile、loopback 脚本模型分别运行：

- `offline-original-configured-high`：原 large、原私有技能、仅子配置 High；
  `normal_final`，3 子任务完成、通知已投递、父最终事件存在、guard=true、
  `fixture_changed=[]`。原 1200 秒、2M `input_excluding_cache_reads`、64 请求、
  60K 输出、$5 观察阈值保留。
- `offline-daily-configured-high`：既有无 400 字 daily；`normal_final`，
  read/write/terminal 链路完成，仅新增 `test_dry_transport.py`。dry 按设计
  不修业务 fixture，独立行为检查仍失败、`daily.accepted=false`，不算日常
  业务验收通过。该轮没有委派，不能作为子任务档位的额外证据。

两者仅证明本地传输和生命周期，不证明真实模型交付、答案质量、速度或费用。
原始技能两文件哈希仍与§16.6一致；离线 large 实际请求为父 Max × 3、子 High × 6，
四个会话各只有一个 system hash。证据与候选冻结目录为
`/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-resume-v0215-configured-high/`。
旧冻结文件保持不变。下一次若获单次付费授权，可沿用原任务与限额验证配置 High，
检查实际 wire effort、完整自然交付、引用与 limitations、耗时和全部费用；
不自动重跑、不扩预算。$5 是观察停止阈值，延迟结算可能超过。

### 17.4 配置 High 的真实原题运行：三个子完成，父未自然交付

用户随后明确授权“后续所有任务需求”，本轮执行了一次冻结的完整候选。
`live-v0215-configured-high` 的 report/events/settlement 和 runner 日志已保存于
§17.3 证据目录同名子目录。未改原题、技能或限额；归一化 workspace 后原题
与§16.6完全相同，技能哈希及全部12个fixture文件（含6个既有pyc）哈希也相同。
运行环境已从旧版本升级到 v0.21.5，因此它不是严格单变量因果对照。

实际委派任务省略 reasoning_effort，三个子从 delegation 配置得到 High；父保持
Ultra→wire Max。三子分别10/4/12次普通API调用，均正常 completed、无truncated。
最后一个子在554.671秒返回，父随后运行至1172.31秒，因观察到费用越过$5被中断。
runner 明确记录 `observed_budget_stop=5.033078`；harness 对应
`external_signal`、`caps=[]`，不能把它写成输入/输出上限或1200秒超时。

| 指标 | 本次记录 |
|---|---:|
| 普通请求 / 响应 | 39 / 38 |
| 排除缓存读取的输入 / 峰值 | 727,101 / 727,101 |
| 有效 usage prompt / cache read | 1,895,069 / 1,254,016 |
| 已观察输出 / 其中 reasoning | 38,736 / 28,637 |
| 父 read_file / search_files | 26 / 11 |
| 父精确重复工具 / 计数字数调用 | 0 / 0 |
| 最终事件 / 完整自然交付 | 无 / false |
| fixture 变化 | 无 |
| 各会话 system hash 数 | 均为1 |

停止时48条账单全部settled，合计$5.033078：chat $1.082352、delegation
$3.912001、other_auxiliary $0.034030、title $0.004695。仍有1条无响应普通
请求，不能把它推断为免费或宣称不可能后补结算。

可复核的400字行为：第三组8次 execute_code 都是草稿字面量的len/print，长度
646→563→460→433→428→415→409→399，实际最终正文含Markdown空白为401字符。
其中第一轮到第二轮还把一项确定问题降为疑点，不能把整段模型时间全部归为
纯排版。第一组只有一次terminal计数（965），随后继续读证据，不是连续计数循环。
父本轮没有计数调用，但仍持续核验源码，说明不能仅凭子计数就认定唯一根因。

子结果质量也不是全绿：第二组将“无锁额度检查可能被并发绕过”列为确定问题，
而固定快照没有证明同一父任务会并发进入此路径；构建还标注main-thread边界。
提前计额度且构建失败不回滚是可见代码事实，但注释写的是charge requested children，
是否违反“成功创建才收费”的契约未知。父尚未完成核验，不能把这些中间输出
当成已通过准确性的最终答案。

本次支持“有效High配置能贯穿子运行，三子在本次都完成”，不证明High使之完成，
更不证明原题自然交付已修复。下一诊断只在既有harness显式移除large末句400字
要求，其余题目、技能和限额保持；标注非原题验收，记录实际prompt，独立观察
字数计数、父核验、自然交付和质量。不会重评分历史结果或把该诊断冒充产品修复。

### 17.5 显式移除篇幅要求的诊断入口（免费验证）

复用现有 harness、Electron runner、Codex driver 和 convergence 报告，新增
`--large-report-length=original|unbounded`；默认 original 不变。unbounded 只移除
large 原题末句，不改技能、快照、档位或限额。报告保留实际 prompt，并明确
`large_report_length=unbounded`、`original_acceptance_eligible=false`。回放继承
源报告身份，不能把改题的回放再标成原题。旧报告缺少身份时保持 unknown。

独立审查发现 evidence-contract 的另一段提示还会加入400字；已在Python创建
run之前、Electron访问账号之前拒绝unbounded与matched-comparison的组合，
而非悄改那段提示。所有其他场景也拒绝直接设置unbounded。

两项参数化行为测试经真实offline RPC验证：初始9项红→9项绿；冲突组合也有
独立失败证据，修正后全部11项定向通过。完整受影响文件在最后组合guard加入前
为62 passed、1平台跳过；guard加入后复跑全部11项新增/变更用例。原私有技能
的额外离线运行`offline-unbounded-configured-high`也通过，归一化目录后题目仅
减少指定句子，技能、fixture和limits与§17.4一致；dry审批和title设置按既有
隔离规则不同，不能当真实模型对照。native Codex仅做loopback诊断身份传递验证。

两份技能哈希不变，默认产品配置没有改动。此入口用于回答400字要求的影响，
既不是新的收尾机制，也不是解除60K输出、1200秒或$5观察阈值。下一次真实结果
单独记录；即使出现最终答案，也还需核查证据与过度断言，不能外推为稳定修复。

### 17.6 无篇幅限制诊断已自然交付，准确性仍未全部通过

在同一后续授权下运行`live-v0215-unbounded-high`，完整证据保存在
`/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-unbounded-diagnostic/`。
实际首个user题归一化路径后仅删除400字末句；技能两文件、全部12个fixture、
配置（仅cwd变化）和限额与§17.4一致。三个子任务这次主动显式填写High，前次
省略该字段；有效档位相同，但不能把本轮High的来源说成纯配置继承。

运行494.67秒后`normal_final`，三个子正常完成、完整结果送达，guard=true，
父最终正文5,433字符。`diagnostic.original_acceptance_eligible=false`，所以是
无篇幅限制任务的自然交付，**不是原400字任务验收通过**。源文件无修改，各会话
system hash均保持稳定。本轮父子字数计数工具调用均为0；三子完整报告分别
4,588 / 4,125 / 4,511字符。

普通观测请求45、响应44；有效usage输出48,018，其中reasoning 31,893。
`input_excluding_cache_reads`结束值364,703、运行峰值418,930，均未触及2M；
没有输入/输出/请求/时间停止事件。父外层工具计数为skill_view 2、delegate_task 1、
execute_code 2、search_files 3、read_file 6。execute_code还批量核读源码，
不能把这6次直接与上一轮26次read_file当作同口径的总读取成本比较。

独立只读质量复核见该run的`quality-review.md`：父确实降级了部分子错误，
例如合成replay后缀消失是否等于用户原始任务丢失。但至少下列定性还缺契约证据：

- 把按requested children扣额度、构建失败不退还直接判作错误扣费。
- 把profile编辑覆盖旧pin及每次配置变更只尝试一次直接判作确定缺陷。
- 把未见外部函数实现时的后置异常风险表述为会产生“永久”半提交。

这些问题不靠行号存在或schema有效就能排除。完整自然交付维度通过一次；
准确性不能无保留通过，稳定性也未验证。旧原题失败记录不重评分。

两次结果也不是随机因果对照：本轮cache read占有效prompt约87.76%，前次约
66.17%；本轮输出48,018反而高于前次38,736，子报告和查询策略也不同。可以说
“本次去掉400要求后没有计数调用并完成交付”，不能把全部提速/省钱归因于去400。

### 17.7 延迟结算与当前保留边界

2026-09-29 17:01:23（Asia/Shanghai）再次读取账单，第一轮由结束时48条
$5.033078补为49条$5.582728；第二轮由48条$4.180215补为49条$4.28181175。
两轮合计$9.86453975。每轮49个wire http_call_id与49个账单desktop_call_id
逐一匹配，无缺失/多余ID，全部settled。分别保留结束时和后续对账收据；
这再次说明$5是观察停止阈值而非货币硬上限。内层普通请求仍各缺1条响应记录，
不凭无响应状态推断其用途或免费，也不把wire与内层请求强行逐条关联。

本轮确定修复的是子配置档位fallback丢失；诊断新增的是可审计的篇幅变体，
没有增加强制收尾、累计预算系统或产品通用400字规则，也没有降低日常产品
默认档位。自然交付与答案可靠性继续分别评价；没有新运行时缺陷证据时，
不以继续添加收尾提示或救回中间稿来冒充修复。全部改动仍在分支，未提交、
推送、合并或重启日常桌面。

### 17.8 程序化读取误用对话去重：离线红→绿

2026-09-29继续免费排查，无新增模型调用。历史父会话
`20260929_164821_d0da52`的messages 93/94记录首批37次内部read_file：
stdout 88,194字节，捕获50,000，完整spill保留。95/96记录第二批17次读取，
其中16个(path, offset, limit)与首批完全相同，只有3860/35是新key。两段
脚本都仅打印`r.get('content', '')`；第二批未截断但只出现35行源码。
历史记录没有保存这16次内部调用的原始返回dict，不能把源码预期冒充线上
捕获结果。

真实registry→execute_code→session kernel→RPC的离线复现补齐了机制证据：
首批37段打印触发截断，第二批1个新key有content、16个重复key返回
`status=unchanged`且没有content。另一个测试在脚本内循环读取时第二次
即返回stub。两个契约测试先失败，修复后通过。没有mock文件处理器、RPC
dispatch或dedup；使用临时文件及测试隔离profile，不访问模型服务。

这不只是脚本忽略status的问题。既有code-execution文档明确约定中间工具
结果不进入模型上下文，脚本可处理后仅print摘要；但read_file把这些字节
登记为模型已见，随后向脚本或模型声称“原文已在对话中”。该假设与既有
能力契约冲突。脚本漏报非content结果、忽略spill提示仍是独立的用法问题。
修复前这四个运行时源文件的HEAD blob与本地已同步v0.21.5标签
`v2026.9.24`逐一相同，说明这处具体缺陷继承自该上游版本；这不等于
所有Ultra交付或准确性问题都已归因于上游。

修复复用现有RPC dispatch、CellAuthority与read tracking：仅在程序化RPC
调用作用域中跳过对话去重stub及模型连续读取记账；读取成功仍走原文件
安全检查、脱敏、分页、版本校验、read coverage和写入基线。作用域在
CellAuthority捕获上下文内进入并finally恢复，本地socket与远端file-RPC
共用dispatch；token、allowlist、max_tool_calls和审批路由不变。程序读取
既不把未print的内容登记为模型已见，也不清掉已有直接读取的去重记录。

两项新测试还覆盖脚本连续读5次、脚本只print摘要后首次直接read仍有正文、
直接read已去重后脚本仍可读、脚本返回后直接read继续stub并最终阻断重复。
10个相关测试文件169 passed、0 failed；Ruff及git diff --check通过。
独立临时探针另有3 passed、0 failed，使用macOS LocalEnvironment实际
运行file-RPC：重复数据读取、直接读取去重、缺文件/拒读/脱敏、250字符
分页重建、部分读取禁止覆盖、完整基线允许覆盖、外部改动后再次阻断均
通过。探针首轮1过2失败是其自身误认direct第三次仍为stub及write_file
成功返回字段，修正断言后通过；不是生产代码的红→绿证据。
远端kernel既有回归不等于在真实SSH/Windows远端完成验收。该缺陷能解释
离线复现的补读缺文，不能据此宣称它是此前Ultra耗时或答案定性错误的
唯一原因，也尚未证明修复后完整模型任务更快或更准确。

### 17.9 固定答案质量反例与覆盖边界

复用README的人工验收段，记录三项已知反例，不改原技能、fixture或历史
评分，不新增关键词评分器：

1. **requested子额度**：先扣requested、构建失败不退是代码事实；是否应
   只按成功启动扣额缺契约依据，不能直接定成错误扣费，更不能与美元账单
   混同。现有oneshot行为测试证明按请求总额限制后续委派，不覆盖失败退款。
2. **profile与pin**：无composer来源直接返回，能反驳子结果的该触发说法；
   父最终已修正，不能再把子错误算到父头上。profile编辑覆盖旧pin、每次
   配置变更仅尝试一次有执行分支和行为测试支持。旧pin+失败+恢复的完整
   组合尚未证实，不能将这项设计直接判成永久失去自愈。
3. **后置异常与永久半提交**：换模成功后helper抛出并传播可跳过后续提交，
   本地缺完整回滚的条件性结论可保留。外部helper、DB语义、上层异常与
   后续turn/resume恢复未给出时，“永久”“最容易”不足以成立；也不能
   反向声称风险已排除。换模自身回滚测试不覆盖换模成功后的提交异常。

当前实现的定向行为验证为3文件5 passed、0 failed、无重试：
`test_oneshot_footprint.py`的requested额度用例；
`test_tui_gateway_server.py`的无composer来源保留pin和每次编辑一次失败
通知用例；`test_custom_provider_session_persistence.py`的profile覆盖
composer及持久化恢复用例。这些是当前实现测试，不能冒充冻结六文件
已经独立运行；未覆盖构造失败退款、旧pin换模失败组合或永久半提交。

下一次完整验收仍分别报告自然交付、证据评级、耗时/用量/费用、前缀/原始
证据完整性；日常任务和历史400字压力题分开。上述离线修复与质量检查表
不改变§17.4原题失败及§17.6无篇幅限制一次交付、准确性未全过的结论。

## 18. 冻结读取候选的两次完整验证（2026-09-29）

用户确认后，按§17.8候选先运行无篇幅限制诊断，再单独运行原400字压力题，
每种一次。两轮前后22个source hash及整worktree patch均匹配冻结清单；
运行期间没有改提示、源码、技能、fixture或停止条件。使用原1200秒、
2M input_excluding_cache_reads、64个主请求、60K输出及$5观察停止阈值。
两轮均不是`daily`小任务，也不是父阶段重放。完整证据保存在：
`/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-programmatic-live-validation/`。

### 18.1 两轮均未自然交付

| 项目 | 无篇幅限制诊断 | 原400字压力题 |
| --- | --- | --- |
| run | live-programmatic-read-unbounded-high | live-programmatic-read-original-high |
| 父stored session | 20260929_173645_d3c19d | 20260929_175842_1aeafe |
| 停止 | timeout，1203.08秒 | timeout，1202.87秒 |
| 子结果 | 3/3正常完成并送达 | 3组完成；首次组③失败后由父重派，共4次子尝试 |
| 父交付 | 1334字符正文在组①首条中途被截断 | 无报告正文；只有进度确认及运行时中断占位 |
| completion guard | eligible=false | eligible=false |
| 主请求/完整usage | 50/49 | 56/54 |
| 父请求/完整usage | 23/22 | 26/25 |
| wire请求 | 51 | 75 |
| 输入预算结束值/峰值 | 510403/510403 | 460910/460910 |

实际wire的父chat档位均为max、子delegation均为high，模型均为
gpt-5.6-sol；不能把配置标签Ultra写成wire的effort值。原400轮的18条
other_auxiliary全部通过审批prompt的canonical指纹匹配为execute_code
整脚本smart approval（父10、组②7、重派组③1），不是主API重试；另有
1条title。64请求阈值是主请求hook口径，不等于wire总数。

原400首次组③收到empty/broken回复，34.1秒后failed；父随后自动重派并
收到completed结果。错误提示的“可能过载/限流”不是已证实原因。两轮
输入都未触及2M；缺usage的请求按既有估算预留，而不是按零消耗。

### 18.2 读取正确不等于已证明自然收敛

无篇幅限制轮的四个会话均没有execute_code，根本未触达程序化读取路径。
父35次直接读取参数全部不同，2995行返回中2715行唯一、280行范围交叠；
其中70行来自同批并发的区间交叠，不能称为看过结果后重复读。均有正文，
没有dedup/error/BLOCKED。

原400轮父10次execute_code包含30次程序化read，另有8次direct read。
38个(path,offset,limit)全不同；30段脚本正文逐行匹配冻结源码。一次
stdout 51822→50000字节截断，spill完整；省略的1822字节所涉30个源码
行因同批区间重叠，均在捕获输出其他位置出现。父没有读取spill。
因此这轮虽覆盖程序化读取，仍未触发旧缺陷所需的同key重读条件，不能
把它宣称为该缺陷的模型实测红→绿；§17.8的离线契约证据仍独立成立。

父已完成API耗时合计分别656.440与772.014秒，父外层工具耗时合计分别
7.936与32.040秒；并行求和不等于墙钟。末次未完成请求另耗时间，不能
从完整usage统计中隐去。现有证据支持主要等待在模型交互，不能细分或
虚构“核验/起草/反复思考”的时间占比，也不足以将失败归因于读取修复。

### 18.3 准确性仍不可整体验收

无篇幅限制父id165确有1334字符文本；最后父request窗口的540个delta
拼接后仅多两个前导空白，与interrupted完成事件正文逐字匹配。因此
“未交付”成立，“从未开始作答”不成立。父首项失败状态残留有局部依据，
但正文未完成，不能据此评价三组及Top3整体准确性。子报告仍有requested
额度评级等缺契约问题，不能把子文本冒充父最终判断。

原400父无报告草稿；子组②有7次len(text)计数，结果620、530、542、
537、543、446、444，父自身没有计数。父一次阶段确认已将组③两个
结论说成成立，但其中profile/pin断言仍缺composer来源guard及
once-per-edit契约边界；未交付最终正文，不能断言最终一定保留或降级。
本轮没有证据把两次失败都归因于400字要求。

### 18.4 结算与尚未闭合的请求

两次结算刷新结果一致：无篇幅限制轮51条wire与51条账单ID逐一匹配，
全部settled，$5.03164500；原400轮75条wire对应74条已出现账单，
全部settled，$4.46411900。当前已结算可见合计$9.49576400。
原400缺少http_call_id `56c9d39d-a26f-4004-aebf-1a8f6f8a7fb3`的账单行。
该请求通过原始user item的canonical内容指纹及初始/重派因果顺序关联
到首次失败组③，不是仅按时间接近关联，也不是hook与wire有原生共同
request-id。未见账单不等于已证明免费，保留这项结算边界；$5仍是
观察停止阈值而非硬金额上限。

结论：本轮两种任务都未完成自然交付，最终准确性也不能通过。局部读取
缺陷有离线修复证据，但没有新的缺文或I/O阻塞证据可解释这两轮超时。
不以恢复中间稿、扩预算、强制总结或重评旧失败代替完整验收。

### 18.5 修正分析器的中断正文归因

两轮运行与零漂移收据保存完毕后，才修改convergence分析器及其现有测试。
旧实现只看最后一个已完成response的finish_reason；若它是tool_calls，
就将后续尚无完整response但已流出正文的请求描述为“从未作答”，本轮
1334字中断正文证明这种解释不成立。

修复复用现有events：只观察report明确的父身份及最后父request，严格
匹配非空api_request_id、session和已知turn；在同一窗口内收集实际
delta，排除旧start、interim、不同请求/消息及子会话，并与interrupted
完成正文匹配。不存在message_id时依赖已界定的请求窗口，不把两个空ID
当成有效关联。有可靠正文时标记interrupted_with_streamed_text；存在
未响应父请求但缺少可靠正文时unknown_after_tool_calls；没有未响应
父请求时可保留mid_tool_loop，仅表示最后观察到工具响应。自然交付
guard的判定保持原样。

独立review曾发现首版helper未join报告最后request，可能误归同父旧turn
或不在report中的请求，已由反例实红后修正。两项新增行为测试参数化后
定向15 passed；独立请求身份反例2 failed→2 passed。最终该现有测试
文件79 passed、0 failed、1 skipped，Ruff通过。首次全文件回归的旧
归档断言也已按pending请求的观察边界修正，历史natural_delivery=false
不变，未把旧失败重评为成功。

重新计算本轮无篇幅限制报告为interrupted_with_streamed_text/1334；
原400为unknown_after_tool_calls；两者natural_delivery仍false。此前
成功无篇幅限制报告仍answered/true，原题资格仍false。保留原分析输出
及新的convergence-corrected.json，明确这是运行后的测量修正，不能
冒充执行期间运行时修复或任务已通过。

### 18.6 用户指定的无篇幅限制、延时诊断（2026-09-29）

用户明确选择无400字要求的大任务、3600秒上限，以及$10观察停止阈值。
这同时改变时间与费用策略，不能当作历史1200秒/$5条件下通过。仍保留
原skill、六文件fixture、父Ultra/max、子配置High、64请求、60K输出和
2M排除缓存读取输入；其中任何其他上限仍可先于60分钟触发。用户的
假设是增加余量可使父任务完成，尚待真实运行，不预先宣称已修复。

检查发现实验runner只取得一次托管租约并关闭stdin；生产托管绑定
最多接受约一小时TTL，所以单改墙钟上限不能保证60分钟可用。新入口
使用原auth.modelLease与session.renew_managed_model协议，同grant、
同控制连接和binding_revision续租，不调整服务端到期时间或注入模型
消息。日常桌面默认不变。续租失败必须留下原因，不能伪装自然完成。

本节在运行前记录候选意图；真实结果、费用及零漂移收据另行归档，
不得将本节视为已执行或已通过。

本轮补测发现实验费用轮询的既有退出竞态：子进程结束关闭日志后，
在途查询恢复仍写日志，产生未处理EBADF。独立本地复现后改为在退出
状态下跳过该回调，保留运行中的费用约束；续租失败状态不用于关闭
费用轮询。真实失败的两个分支已转绿，runner共18项通过。

新增真实本机HTTP/RPC续租测试3项通过，验证首行stdin无需EOF启动、
在途续租后下一请求使用新凭据、system哈希不变、失败续租interrupt，
且旧新凭据均不进入证据。全部模型流量限制在loopback，未付费。

最终免费验证：convergence文件分为互斥三组，65+3+13=81 passed、
1 skipped；托管绑定/agent原有20项通过；新增续租3项通过；合计Python
104 passed、1 skipped。JS runner 18项通过，typecheck、窄lint、Ruff
通过。首次整文件运行被测试runner在355秒终止，保留该记录；分组没有
改断言或跳过测试，未将超时那次声称为全通过。独立复核竞态修复已关闭。

### 18.7 无篇幅限制/3600秒/$10真实诊断完成（2026-09-29）

冻结后执行一次完整large任务，保持原skill/fixture、父Ultra/max与子配置High，
未自动重跑。stop_reason=normal_final，最终父事件complete，guard eligible，
三个子结果completed/schema_valid且未截断；7790字符完整最终答案，耗时
1185.42秒。运行前后27个冻结文件哈希零漂移，六文件fixture未变，四会话
system hash各1个。线上续租尚未触发：任务在首次20分钟续租定时点前结束。

输入排除缓存读取最终365435、峰值423870，完整hook输出42045。hook
38请求/37响应，不把缺响应判定为任务或辅助；wire独立为chat15、delegation22、
title1、other_auxiliary6。一个缺hook响应仍预留70850输入。退出时43笔
settled/$3.52508800；14:01:03.738Z刷新后44笔wire与44账单一一匹配，
全部settled，最终$3.91826800；没有待匹配账单。

自然交付这一项通过，但整体准确性仍needs-correction。独立语义复核指出：
摘要终端标志漏清是真缺陷，但额外abort需补最终无摘要、当前非终端失败、
允许普通失败静态回退等条件；requested children额度计数不能无契约地
改判为只计成功spawn；批量构建的本地清理缺口与实际资源泄漏应分开；
profile supersede/once-per-edit是明示策略，不能仅凭清pin或不重试判bug；
连续once字段覆盖也不能忽略primary_runtime优先恢复而断定实际恢复错误。
原模型答案保持原样，人工勘误单列，不回写成“模型准确性已通过”。

本轮实际早于原1200秒、费用低于原$5，没有使用新增余量，故不支持
“放大超时/费用导致成功”；一次成功也不证明去400即可稳定交付。
后续重点是证据分级/设计意图遵循及稳定性，而不是继续无假设地扩预算、
强制总结或按这些未经证实的评审结论修改产品行为。

完整运行、逐项语义核验、冻结源码/构建、费用与初次测试超时证据：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-extended-unbounded-validation/report.md

### 18.8 过度断言的子父谱系核验（2026-09-29，免费离线）

本阶段复用§18.7的数据库、事件、history及实际wire项指纹，没有新模型
调用。三组均在子任务最终文本中先出现条件遗漏或过强评级，父级部分
纠正、部分保留，并在Top 3再次扩大；不是全部照抄，也不是已经证明
某种模型、档位或审查方法是因果根因。

组①child84（deleg_c9f73ec3/task0）漏写允许普通失败静态回退的配置
前提，并将局部abort描述为冻结。4455字符原文完整进入父notice85，
final109进一步写成“任意摘要失败”，Top1又称无需快照外契约。会话
reset漏清终端标志的局部缺陷仍成立，但额外abort须有最终无summary、
进入失败判定、当前失败非终端等条件；成功fallback和feasibility skip
不能混入。父同时将另一条回退状态正确降为疑点，须保留这一反例。

组②child55（deleg_9d2d7ea1/task0）已将requested额度写成永久消耗，
将局部清理缺口泛化为资源和状态残留。3880字符原文进入notice56；父
工具60/61实际返回Charge *requested*注释及完整函数，final109仍列为
确定缺陷，Top3又合并有限one-shot额度与batch部分构建失败的不同条件。
child34的execute_code stdout确有57672→50000字节裁剪，不能声称全部
输出未截断；但child28及后续定向窗口已返回关键契约，父60/61亦完整，
故现有证据不支持将该误判归因于这些关键行缺失。另须区分空消息
ValueError：str(exc)为空时不进入父if err直接错误返回分支。

组③child45（deleg_9d2d7ea1/task1）先将profile pin及连续once列为
confirmed。3692字符原文进入notice56，子25及父65/66/67/77确实返回
来源guard、supersede、once-per-edit和primary_runtime优先恢复逻辑。
父对连续once的恢复后果已有降级，但保留确定缺陷标题；QC-PIN主文
的“可能”在Top3又变成“会使”。字段覆盖事实不等于实际恢复错误，
也不能仅凭清pin或不重试就将明示策略认定为缺陷。

三份child正文=result/event summary，完整且各出现一次于相应父通知；
通知又与父history逐字相同。对通知及六个父工具输出构造canonical
Responses item，其SHA-256与实际chat wire项匹配：notice56覆盖10次
chat，notice85覆盖6次；两通知与60/61/65/66/67/77工具项均仍在最后
chat请求81ffb6b2-a8c1-435f-9980-dcfa4bf9a21a中。此证据只证明客户端
发送内容，不证明供应商内部处理方式、模型注意力或理解正确。父
86/96/100/105/107无中间论证正文，不据此虚构隐藏思考。

复用README既有Manual evidence-rating regression cases，补终端标志、
连续once反例与逐阶段归属核验方法；未修改原skill、通知或产品策略。
一次性复算脚本通过3条child链及6个父工具项；临时副本删一字的反例
被拒绝，仅证明审计脚本可检出该不一致，不是生产缺陷红→绿证据。

本样本没有新增运行时补丁依据；不为错误评审修改requested配额、
profile supersede或once-per-edit。若后续尝试审查方法/skill干预，
须独立标记契约改变，保留原始基线，同时防止将真缺陷一律降级。
自然交付已通过一次，准确性仍needs-correction，稳定性尚未证明。
本阶段未新付费，未提交、推送、合并或重启桌面。

逐阶段原文、来源身份、实际源码窗口与可复算wire证据：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-claim-lineage/report.md

### 18.9 独立审查方法候选（2026-09-29）

原skill已有保守评级、子结果核验及不确定性分离要求，不能把§18.8的
误判解释成规则缺失。候选仅在外部私有skill副本中替换现有分类和核验
步骤，强调已建立的契约、完整触发条件、最近反例/替代恢复路径、局部
事实与远端影响分开，以及最终排名保留前提。子任务沿用goal/context
传递这些检查的实质内容。局部反例完整时仍可确认，不要求快照外代码
才能判定；未加入fixture答案、强制JSON、字数或提前收尾规则。

复用评测器的外部skill复制及指纹机制，增加review-skill=candidate。
首版仅支持fresh large Aino；即使与原skill字节相同仍标为候选，不能
通过original_acceptance_eligible。replay、legacy replay与length读取
candidate来源时提前拒绝，避免派生结果被重新标成original；平台入口
在账号访问前作同样检查。原original/none默认及生产运行时未改。

新接线9项参数化Python行为案例先红后绿。平台首轮来源测试缺repo
参数，修正测试前提后确认原实现越过账号边界，保留两轮红灯记录。
独立review还发现SKILL.md为目录时existsSync与is_file不一致；目录
反例实红后增加isFile检查，平台全部26项通过。此处是新实验入口的
前置校验修正，不是Ultra语义误判的根因。现有回归结果随本阶段收据
记录，不以此前测试结果冒称重跑。

八个合成控制由另一个审查代理在不读预期答案的情况下静态审查，
分类与预期一致，并保留两项明确局部缺陷，拒绝全降级。但A把许可
计数称为计费，措辞有误，原文及批注保留。没有同代理原skill对照，
也不是Aino目标模型实验；不能据此声称候选提高了准确性。

候选属于独立审查契约实验，不是运行时修复，不追改原始基线。真实
验收须另查方法是否实际加载并传入子任务、完整自然交付、全部重要
结论及排名、真缺陷保留、输入前缀/fixture完整性、耗时和最终费用。
候选本身不保证质量或稳定性改善。本节仅记准备过程，不表示已经
启动或通过下一次真实验收。

候选diff、来源指纹、红绿证据与预先固定的评估协议：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-review-quality-candidate/plan.md

### 18.10 候选完整运行：交付通过，准确性未通过（2026-09-30）

§18.9的冻结候选首次尝试在31.63秒因provider overloaded结束，
首个父请求没有完整响应，未启动工具或child。用户随后要求继续，
使用同一代码、候选skill和任务新建一次运行；仅换run名，费用观察
阈值从$10降为$9.99以给首次已结算请求留余量。没有自动重试循环。

续行1872.46秒（31分12.46秒）以normal_final结束，最终事件complete、
guard eligible；6905字符正文与父session 20260929_233909_8a719e的
assistant136逐字一致。仍为无400字/3600秒/父Ultra-max/子配置High，
64请求、60K输出和2M input_excluding_cache_reads。候选身份及预算/
任务改变完整留档，original_acceptance_eligible=false；不能写成
原400字/20分钟通过，或证明技能导致完成、提高准确性及稳定性。

三个child中组①以overloaded失败，组②和③完成；父自行补查第一组。
第二次delegate_task只是action=list，不是重派；schema_valid=null
是未指定schema，不能标为格式错误。1200.323秒线上续租成功。续租后
父会话新发5次同交付turn请求，另有1次final后的不同turn请求；后一项
用途不能由时间猜测。child此前已结束，未验证child续租后行为。
四会话实际请求system hash各1个；27个冻结源码/构建文件、候选skill
及fixture运行前后无漂移。goal/context仅部分传标准，但三child实际
读取到候选主文；方法送达不等于正确应用，reference读取边界另记。

对父136与Top 3独立复核的最终结论仍为needs-correction：

- 组①保留五终端flag漏清的局部真缺陷，并把触发收窄为新普通失败；
  但混入_summary_model_fallen_back（不属abort的五flag），将已转主
  模型后的重试门误写成不再使用主模型；静态回退差异缺False配置、
  最终无summary且实际进入失败门等条件，Top 2持续无法压缩仍过强。
- 组②不再把requested计数确认为误扣，继承与排名有所纠正；但构造
  分支局部无显式补偿被过度确认成生命周期缺陷，漏空字符串ValueError
  的if err反例，固定custom忽略URL特例及native SDK入口条件。
- 组③补truthy tool_calls、撤回整事务no-op论证并保留once-per-edit；
  但fn.get还需truthy tc_id，局部投影异常不等于全恢复不可救济，
  Top 1扩大了下游后果，helper抛错不证明配置未落盘。457–462已有
  config-sync失败通知尝试，不能反向声称完全没有错误通知路径。

父答确有纠正，不能直接套child审计；也不能全降级抹去真缺陷。未见
新增运行时吞答案的证据，不为模型误判修改requested配额、profile或
once策略。本阶段仅候选评测接线、测试、文档及独立skill副本有增量，
生产运行时未因本轮审查新增改动。此处完成归档，不追加第三次付费运行。

hook 45请求/43响应，wire46调用（chat18/delegation26/title1/其他辅助1）。
input_excluding_cache_reads最终/峰值753597，其中缺usage预留269316；
完整hook输出53659，caps为空。两观察层不能无共享键逐请求归因。
北京时间00:23只读刷新后，续行45条可见账单均settled，$5.38678200；
加首次标题$0.00496500，本阶段可见已结算合计$5.39174700。首次chat与
续行一个delegation仍无匹配账单，不视为免费，不能称费用最终闭合。

本阶段免费验证收据为Python90 passed/1 skipped、JS26 passed；收尾
只核对日志与冻结指纹，不冒称重新运行。自然交付再次通过，准确性仍
未通过，整体目标不能宣告完成。完整运行、父级勘误及费用缺口：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-review-quality-candidate/report.md

### 18.11 需求范围澄清：看板摘要、对话压缩与400字测试分离

用户明确：此前摘要需求指看板摘要；对话中的压缩/摘要保持上游Hermes
做法。两者不能混用。§18.8–18.10所评判的摘要失败标志，是冻结审查题
第一组源代码中的结论准确性，不是为看板需求重新设计生产摘要算法。
此前并列描述易产生歧义，后续统一按下列边界执行。

1. 右侧“会话资源”目前从session.messages派生资源、计划和子任务列表，
   并非调用session.summary生成对话压缩摘要，也没有每组400字输出要求。
   独立session.summary后台能力缓存概览，不代替turn loop的压缩历史。
2. 真正Kanban的board API最多返回200字符摘要预览，详情接口返回完整
   summary；卡片再对latest_summary/body按两行省略，抽屉显示全文。
   某些通知首行或诊断的400字符截取有其下游用途，部分还会进入worker
   唤醒上下文；不能把所有400都当成纯UI或全部删除。
3. 人工large评测题的“每组结论控制在400字以内”仅是紧凑报告要求。
   该数字没有已证实的产品必要性，也不是Hermes通用对话规则；历史已
   观察到额外计数/改稿，但不能把所有失败归因于它。它有受限输出压力
   测试的用途，不能据此升级为正常对话或当前用户目标的默认限制。
4. 当前主验收明确使用既有--large-report-length=unbounded。保留原400
   fixture和旧入口默认仅为复现，运行当前验收必须显式带该参数；不再
   以original_acceptance_eligible=false本身判当前目标失败。准确性与
   稳定性仍独立评判，本次候选的needs-correction并非因为没有400字。

相对已合并上游f97608f178d1ffeca59860195ab7da295f7c8e5f，生产摘要周边
已有Aino的凭据路由、API sidecar、显示provenance和请求缓存修复；不能
声称字节完全等同上游，也不因本次看板澄清盲目撤销既有适配。本轮不
改摘要触发、压缩提示、压缩长度、回退策略或原始对话内容。上游自身
_is_summary_refusal内的normalized[:400]是拒绝检测窗口，不是输出上限。

独立概览的400也并非输出上限：web_session_summary.py在至少两条用户
轮次时以400输入字符判定是否有足够材料；其输出校验是每点最多600字
符、每节最多5点。应按展示需求评估这些规则，而非套用人工评测题。

已完成的免费归因复用原始会话和wire记录：12个源码回执及7段逐字
引文已核对。父112/113/116/127含回退、abort、retry和完整五flag；
父93/子32含provider特例与入口，父96/子29含truthy tc_id；关键内容
均出现在最终作答前的本地实际发送记录。首次可见错误分别在父136、
子70和子67，后两项继续出现在父136。没有发现这些关键证据本地漏传，
不能由此推断provider内部接收或模型理解，也不代表全部传输路径无错。
不把这三处语义错误当成改对话摘要算法的依据，不启动新付费运行。
范围核对及实际输入归因：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-summary-scope-audit/report.md

### 18.12 分支补丁收敛与免费回归（2026-09-30）

本轮保留codex/proactive-delegation的全部既有未提交改动，在实际
worktree审查运行时、评测与桌面三组边界。HEAD仍为32371ee0bdaa，
未提交、推送、合并、启动桌面或增加付费模型调用。没有修改看板
摘要、对话压缩算法、冻结fixture或模型提示；当前验收继续显式使用
--large-report-length=unbounded。

新增修复仅针对一处评测元数据缺口：显式--input-cap覆盖此前能同时
得到scenario_ceiling_overridden=true与original_acceptance_eligible=true。
在既有资格条件中增加args.input_cap is None，说明改为明确覆盖，
不再把等值/下调统称为上调。1M/2M/3M真实离线初始化三例先红，
修复后新增及相关来源合同14项通过。该标记与自然交付、准确性独立，
不是交付失败根因；历史报告未回写，当前无400字目标不因该标记false
而失败。修复前评测全文件基线93 passed/1 skipped，不能冒称修复后
重新全量运行。平台入口JS26项通过。

保留既有程序化读取修复，并在两个既有测试文件补齐两项组合合同：
本机真实file-RPC及CellAuthority异常后恢复作用域；真实kernel读取
仍保留完整/局部/版本变化/脱敏的写入基线。隔离副本只恢复四个生产
文件到HEAD，两例均因第二次读取收到空unchanged stub而红；当前两例
绿，两个完整文件43项通过。原工作树生产文件没有被还原或再修改。
本轮9文件运行时基线174 passed/2 skipped，写安全补充9项通过；
43项与前面有重叠，不相加声称独立测试总数。配置子任务档位继续
复用现有fallback override，相关真实loopback与父隔离回归包含在
运行时基线内。全部13个改动Python文件Ruff、py_compile通过。

桌面linked-worktree更新根补丁单独保留：复用既有resolver与git-root，
2文件7项测试和Electron类型检查通过；但测试只调用既有helper，撤回
main.ts接线仍会绿，不能宣称主进程接线已红绿或E2E。已有隔离E2E
fixture会启动真实桌面，本轮不为凑覆盖另建大mock或源码字符串断言。
这项桌面缺口不混入Ultra运行时完成度。

四份历史证据manifest逐项复核，144+23+207+13共387项全部一致，
缺失及哈希不匹配均为0；构建runner与本轮起点哈希一致。既有WIP
按程序化读取、子任务档位、评测、诊断、桌面拆成独立审查补丁，
不以归档代替提交。红绿日志、补丁清单、起止指纹及适用边界见：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-branch-consolidation/report.md

本轮收敛不改变§18.10的结论：已观察到自然交付，但重要结论准确性
仍needs-correction，稳定性未证明。下一轮应围绕独立质量判据提出
可证伪候选；不要用再次无差别重跑、强制收尾或修改压缩算法替代
准确性验证。真实SSH、Windows/Linux与桌面主进程E2E不在本轮收据内。

### 18.13 系统交付与模型质量分开核对（2026-09-30）

用户指出，局部回答错误不能自动等同于Ultra协作机制未修复。本轮
据此补充系统维度审计，复用既有natural_delivery、completion_guard、
最终事件、通知台账与wire记录；不改变历史质量实验的严格判据或
overall_acceptance=false，不把模型意见相异作为判错依据，也不要求
消灭所有模型错误才能关闭一个已有红绿证据的运行时缺陷。空答、
偏题、主要任务缺失和已证实的信息丢失仍是有效失败，不能据此放过。

从原始report/events重新计算，而非仅引用上一轮文字结论：

- 原skill无400任务1185.42秒自然结束，三个child均completed；候选
  skill续行1872.46秒自然结束，两个completed、一个provider overloaded
  failed。两轮均确有三个生命周期相互重叠的子会话。completed事件
  表示子任务结束，不能把第二轮写成三个子任务都成功。
- 五份成功child的完整最终正文和一份失败错误正文各在相应父通知
  中出现一次；通知canonical item hash均匹配实际发送的chat记录。
  台账无待投递项或缺失通知，父在结果之后继续请求模型。上述证据
  证明客户端发送链路，不证明provider内部处理或模型理解。
- 父最终正文分别7790/6905字符，与父持久化消息109/136逐字相同，
  三组及Top 3均有交付；normal_final、complete和guard eligible一致。
  第二轮失败子任务结束后，父对其组①文件又做23次读取/搜索工具
  调用并交付该组；不是重派成功或从中间草稿强制提取最终答案。
- 实际wire用途记录中，两轮chat分别15/18次全部max，delegation
  分别22/26次全部high，模型均为gpt-5.6-sol。这里读取嵌套
  wire_reasoning.effort，不把另一格式的空wire_reasoning_effort误认
  为档位缺失；wire用途总量不与无共同键的hook逐请求强行关联。
- 第二轮1200.323秒线上续租后，父在最终答案之前又发5次请求；
  child均在续租前结束，因此没有验证长child跨续租。第一轮早于
  首次续租结束，不能叫60分钟耐久通过。各会话记录的system hash
  唯一只证明system内容稳定，不扩展为所有前缀和provider缓存保证。

候选首次31.63秒的provider overloaded失败继续保留：未启动child，
natural_delivery=false，不能被两次成功覆盖。三次选定记录不是
随机或同条件重复实验；不同skill且同属一道审查题，不计算总体
成功率，不声称已经达到Codex同等效果。五份历史归档462项哈希
全部一致；两次成功冻结记录中的12个生产文件仍与当前工作树一致。

当前更精确的结论是：核心委派—回传—父续行—自然交付链路已有
真实成功证据，本轮没有识别出仍在阻断这些链路的已证实协作缺陷；
模型局部误判继续作为内容质量问题单列，不再单独阻挡系统收尾。
代表性稳定性仍待补：优先用既有daily场景及其独立行为合同补一个
不同任务类型的样本，避免再重复同一代码审查题或新增提示系统。
一个新样本也只能补覆盖，不能证明稳定成功率；长child跨续租、
桌面UI、真实远端和跨平台是另外的覆盖边界。旧账单缺口也仍保留，
本轮未刷新费用，不将历史可见已结算额冒称最终闭合。

本轮只更新README与诊断文档，未改生产代码、提示、fixture或测试
断言，未付费、提交、推送、合并或启动桌面。可重跑审计、逐项矩阵
及保留的历史边界：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-system-acceptance-audit/report.md

### 18.14 运行时分组提交及不同任务类型验证（2026-09-30）

用户确认后，提交前按canonical runner新跑11文件185 passed、
0 failed、2个Windows-only跳过；Ruff通过。只提交两组运行时补丁：
ba139e1651a155b3f751b5ee731386fe0fcb65fb（程序化读取，7文件）与
e4a48fc48a3b534f38f52b8e183e05052a4c92eb（子配置档位fallback，2文件）。
均在codex/proactive-delegation，本轮未推送或合并；其他9个tracked
修改及2个untracked测试继续保留。提交没有改变已验证的文件字节。

复用既有daily场景，从初始任务进行一次真实验证。题目是修复隔离
示例的auth.py、billing.py、exports.py，按SPEC补标准库unittest。
没有400字限制、审查skill或强制委派提示。父Ultra/max、子默认High；
沿用该场景600秒、48请求、500k排除缓存读取输入、60K输出及$1.50
观察费用阈值，结算延迟仍可能超过。未重跑、扩大预算或人工修正
模型输出。canonical十个fixture按既有--fixtures复制；排除仓库
测试预编译产生的pyc，原fixture文本和独立合同均未改变。

558.77秒normal_final，complete非空最终事件、guard eligible，
491字符最终正文与父持久化消息一致。模型自主启动三个子任务，
三者均completed；完整子答各在父通知52出现一次，该通知hash
匹配五次实际chat输入。台账无pending/missing，父继续整合和测试
后交付。实际wire chat10次全部max、delegation17次全部high，
均gpt-5.6-sol；四会话system hash各1个。未触发任何cap，输入
最终/峰值126113，低于500000。这里增加一个不同任务的成功
协作/自然交付样本，不推导总体成功率，也不叫全部功能验收通过。

功能结果必须单列：模型新增三个测试文件，其16项测试经独立运行
全部通过；预先存在的daily_contract基线为10个失败子案例及1个
错误，修复后仍有2个失败子案例、0错误。因此daily.accepted=false。
不是另一模型意见，而是既有可执行行为合同；一次免费隔离副本
复算得到同样两项失败，原输出未改：

- 极大整数金额2**53+3分在零折扣时变成多1分，因浮点计算损失
  精度；这是数值边界反例，不扩展为所有普通金额都错误。
- 并发重用导出job ID时，旧下载回写缓存，使新租户拿到旧租户
  payload；串行清缓存测试通过并不能覆盖该交错。

这些是隔离示例的模型生成代码漏修，不是Aino生产认证、计费或
导出模块漏洞，也没有证据表明由回传丢失或档位错误导致。协作
样本通过与功能样本失败同时记录，不重新把所有模型错误并入
Ultra运行时故障。

一次只读结算刷新后，2026-09-30T03:25:49.500Z可见32笔均settled，
按desktop_call_id逐一匹配33次wire中的32次，合计$1.35760500。
另1次title调用尚无匹配账单，不能视为免费或宣称总费用最终闭合。
28个冻结源码/构建文件执行期间零漂移，原始fixture哈希一致；
本节仅在结束后追加。没有重启日常桌面或更改日常配置。

本轮完成“两个本地提交+一次不同任务系统验证”。剩余的代表性
稳定性、长child跨续租、真机/远端覆盖仍需按目标范围评估；不
为了让此示例通过而再付费重跑或将样例代码改进混入运行时补丁。
提交、冻结、完整原答、失败回执、费用匹配与最终状态：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-runtime-commits-daily-validation/report.md


### 18.15 免费回归、桌面实际验证与本地收尾（2026-09-30）

本阶段按用户确认继续，不新增付费模型调用。起点e4a48fc48a，
先封存9个tracked与2个untracked修改；未覆盖历史归档。

首次完整Python回归在convergence文件触发343秒有效文件超时。
该文件混合纯分析断言与大量真实后端启动，不是模型运行超时。
按convergence、harness、config、scenarios拆分，复用唯一离线
进程夹具；52个函数AST（含参数化和断言）拆前拆后完全一致。
没有删测试、放宽timeout或开启重试。canonical runner新跑5文件：
96 passed、0 failed、1个Linux-only跳过；最长文件192.54秒。
JS runner另26 passed，Ruff通过；评测代码/测试提交000e6a6187。

用当前worktree构建Electron并以项目既有--dev选项打主进程包，
HOME、HERMES_HOME与userData隔离，模型只连接本机脚本服务。
首次沿用发布构建的兼容packaged标志，导致开发登录夹具不生效；
切到--dev构建后完成，未改产品登录逻辑、未用日常账户聊天。

实际UI发现：child完成事件被接收，但后台通知触发父任务新一轮
message.start时，pruneFinishedSessionSubagents清掉live行，委派
卡片退回原始receipt的Dispatched。两个行为回归先红，再在现有
retired-child bookkeeping中保留原生终态事实，按精确child/batch
身份供聊天和看板读取。live列表仍清理，晚到事件仍拒绝；同名新
任务、跨会话、清除会话和被原生事件替代的fallback占位不冒用旧
结果。未新增RPC、提示、核心工具或对话摘要策略。修复提交
8f14e3a785；9文件72项UI回归通过。终态历史只在当前session store
生命周期保留，重启后不把未知历史派发猜成已完成。

最终E2E等待child和后台进程两份通知进入模型请求、父分别回应后
再断言idle，避免把两轮间的暂时空闲算作结束。真实本机gateway/
child链路中：running卡片可见、完整子答进入通知、父续行、最终
正文可见、child Completed保留且展开可见原结果；Stop、Session
running、Background task running、streaming标记均清零。页面
异常、console error、alert均为空。脚本模型验证系统/UI链路，
不作为真实模型推理质量或新稳定性样本。截图已人工查看；正常
过程折叠通过真实点击展开，不改DOM绕过检查。

worktree更新根补丁独立提交8d499383cc。用真实.git文件linked
worktree调用生产hermes:updates:check IPC：原main返回
supported=false/not-a-git-checkout，同一新增E2E测试红；恢复修复
版后绿。复用resolveUpdateRoot/findGitRoot与offline update cache。
7项helper回归、Electron/renderer/E2E类型检查、构建及相关ESLint
通过。未执行更新应用、Windows恢复或真实远端验证。

2026-09-30T03:47:01.014Z只读刷新daily账单：32个items与上次
封存逐项一致，全部settled，合计$1.35760500。33个wire中仍缺
1条title账单，不按免费计、不称最终金额闭合。

本阶段完成已复现的运行时/界面缺陷修复及本地整理。此前两次
large与一次daily已有自然交付证据；daily独立功能合同仍有两个
失败子案例，未改写成通过。少量成功不证明总体成功率、所有任务
内容正确或Codex等效。长child跨续租、Windows/Linux、真实SSH/
远端仍未覆盖。改动留在codex/proactive-delegation，仅本地提交，
未推送、合并、发布或重启日常桌面。

完整命令、红绿日志、截图、初始WIP及最终提交台账：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-eval-desktop-finalization/report.md

### 18.16 独立分支：准入拒绝不丢通知，撤回强制收尾（2026-09-30）

本阶段从2f7cbdf13f在原linked worktree建立codex/ultra-delivery-stability。
主checkout继续在main；未改其.scratch/，未推送、合并、发布或启动
日常桌面。系统协作缺陷、模型内容质量和真实任务成功率仍分别判断。

保留上游异步交接说明：1378fa1b289、99f82de0f99分别cherry-pick为
c4f03df711、b0d89c2fd9，保留原作者；测试适配提交4ec5c60113。
只在delegate_task可用时放入稳定system层，解释工具明确要求让出
当前轮时可以等待后台结果，不将等待说明当成完整任务交付。
既有会话仍复用落盘前缀，不能为立即启用说明而重建历史system。

新复现的运行时缺陷位于TUI/Desktop通知消费侧：_run_prompt_submit
可能在缺少managed binding、会话关闭等准入检查时返回False，
此时它已经清除running；旧_notif_submit却丢弃返回值，消费侧把
没有启动的通知回合确认成delivered。不能将其描述为永久busy。
仅改为release也不完整：会消耗durable投递次数，并丢弃仍由活
owner持有的副本；普通completion、watch和interim事件没有可用的
durable claim，release不能恢复它们。

修复复用既有bool结果、defer_completion_delivery和队列忙碌退避：
拒绝时不确认投递、不消耗attempt，原副本留待恢复准入后重试。
普通completion batch只回排未consumed事件，保持原顺序；
render(None)代表已消费去重，不重新投递。明确抛异常的旧恢复
语义未扩展为无限重试。本轮未改对话压缩或看板摘要策略。

两项真实行为测试（5个参数化情形）在补全前全部失败：durable、
interim、watch丢掉唯一副本，普通batch丢掉两个未消费结果。
修复后通知测试文件13项通过。测试走真实_run_prompt_submit、
临时profile、SQLite台账、ProcessRegistry队列与orphan sweep，
仅在模型worker启动边界截断。连续拒绝超过投递上限后仍pending/0，
恢复后一次启动，durable变成delivered/1；已消费结果不复活。
独立复核又发现退款写入异常会阻止回排，下一轮简单重排也会撞上
自己尚未释放的claim。扩展同一测试，在退款边界注入连续两次
SQLite OperationalError，修复前1项明确失败；原事件暂存旧claim，
后续先完成退款再重新claim，修复后整文件14项通过。未新增通知
字段或持久化结构；私有重试标记不进入模型/展示内容。claim过期
或被其他consumer接管的安全性经静态SQL路径复核，未冒称并发实测。

最终canonical回归233文件：2307 passed、0 failed、9 skipped，
HERMES_TEST_FILE_RETRIES=0；覆盖完整tests/tui_gateway及委派、
Ultra、system prompt、缓存恢复、通知展示相关文件。初轮并非全绿：
6项失败中2项旧成功替身遗漏True返回，已修正；另4项因runner优先
选本worktree独立.venv（无anthropic），忽略HERMES_PYTHON fallback。
确认真实ModuleNotFoundError后，最终回归临时复用主checkout已有
完整.venv（anthropic 0.87.0，与锁文件一致），执行的生产模块仍
来自本worktree。未安装依赖、未改锁文件；trap已恢复原.venv，
前后目录inode一致。首轮失败、故障注入红灯与最终绿灯日志均保留。

6dbda6969f和9b490224c9中追加的收尾/等待提示已从最终工作树
撤回，保留提交与实测历史：把所有子尝试都有结果或失败视为停止
工具调用的理由，可能提前放弃必要核验或补救；按当前结果数量
推断还有sibling等待，也不适用于独立完成单元。一次成功不能
为这些语义风险背书。

本轮两次真实运行的证据必须分开：

| 项目 | live-ultra-delivery-stability | live-convergence-6dbd |
|---|---|---|
| 耗时 | 1251.05秒 | 308.55秒 |
| 结果 | 无任务最终答案 | normal_final，4253字符，guard eligible |
| skill | none | original |
| 实际子请求档位 | Max 25次、High 2次 | High 26次 |
| 实际父请求档位 | Max 7次 | Max 7次 |
| 触发阈值 | aggregate_output_threshold | 无 |
| 当时可见已结算 | $5.04721125（35行） | $3.28598100（36行） |
| 尚无匹配账单的wire | 4（2 chat、2 delegation） | 1 delegation |

两轮都无400字、3600秒、$10观察停止阈值，但并非同配置对照。
第一轮忘记传child-reasoning-effort=high，模型首批显式选择Ultra；
也未保留原skill，不能写成High/原技能验收。真正中断来自累计
输出63659超过60000，其中推理56936；不是64请求上限、2M输入、
墙钟或$10。子任务报600秒non-streaming超时，但HTTP已返回200和
部分body，不能称完全没有响应。

第一轮失败早通知确实进入父上下文，父随后补派；截停后原批次
仍pending，补派中断通知又启动了一条父请求。guard的children_finished
是截停前快照，最终事件有4次子尝试（1完成、1超时、2被中断）。
不得把这个现象简化成所有通知丢失或模型永远不交付。

第二轮确有3子完成、父自然答案，但带有已撤回的6dbda6969f提示。
其最终答案尚无完整独立质量验收，不能当作当前保留补丁的成功
验收，更不能证明稳定性、准确性或与Codex等效。

协作隔离失误也入账：并行代理在第一轮运行期间修改共享生产
文件并提交6dbda6969f；第一轮可见Ultra note和通知仍是旧文本，
第二轮通知匹配新文本，但没有完整模块加载追踪。两轮只有五个
评测脚本的起始manifest，没有完整生产模块/构建runner冻结。
事后归档哈希不能补成事前零漂移证明。账单快照均未覆盖全部wire，
两次可见合计$8.33319225不能称最终总费用；本次复核未再付费。

原始report/events/settlement、事后归档哈希、账单逐ID缺口、回归
日志及最终提交记录集中在：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-delivery-stability-20260930/

### 18.17 冻结版本完整验收：自然交付通过，准确性未全通过（2026-09-30）

按用户确认，仅执行一次完整真实验收。实际源码为
codex/ultra-delivery-stability @ 611074f7342024426ae4f9ba685caa35e16a10b6。
原技能、六文件、三组与Top 3任务，取消400字；父Ultra、子配置High；
3600秒、2M input_excluding_cache_reads、64 hook请求、60K hook输出
（含reasoning）、$10观察停止阈值。无matched-comparison、
evidence-contract、父阶段重放、压缩覆盖或强制收尾提示。

本次结果为normal_final、natural_delivery=true、caps=[]，耗时
1402.70秒，父最终正文6955字符。完成guard准入，3子均completed，
唯一durable批次投递一次，无pending/missing通知。父DB最终消息155
与最终事件、报告历史、原答导出逐字一致；早期47字符等待说明
没有被计为完整交付。实际wire为19次chat/max、29次delegation/high，
另有title1次及auxiliary7次，模型均为gpt-5.6-sol；无补派或子档位覆盖。

子最终正文3583/3760/2758字符逐项比对DB、durable、事件与父通知，
完整内容各出现一次。父通知83共12680字符，canonical hash匹配
随后全部15次父chat请求；160/500字符事件预览不是结果截断。

事前冻结及结束后的全树核验：15605个tracked文件、实际runner、
原技能和六个样本均无变化，fixture_changed=[]，依赖包版本无漂移；
未将包版本记录夸大为依赖全字节冻结。预检发现fixture内9个生成
.pyc，只将manifest中的10个规范文件复制到外部样本根，实际large
workspace恰好六个原文件、哈希相同；未删除或修改仓库样本。
本节在事后冻结核验完成后追加，属文档变更，不是运行期间改码。

49 pre/48 post hooks；输入最终/峰值444527=未缓存233612+缓存
写入121605+未决预留89310；无阈值越界。hook输出52475，其中
reasoning35619已包含；全用途账单输出53366，分别保留观察范围。
旧represented-input和2291888不是本次批准口径；不将本次记录
改判为历史400字/20分钟策略通过，也不将两种口径混作同配置对照。

退出快照55行/$4.80280525；唯一一次只读结算刷新后，56个wire
http_call_id与56个settled desktop_call_id逐一闭合，合计
$4.93338825，缺失/额外/重复ID均为0。补入的$0.13058300来自父
最终答案之后的一次auxiliary请求：客户端记录ReadError，无headers，
但后来有账单；不能定因provider或收尾，也不能称全程零异常。
刷新没有补造原hook缺失响应；未追加任何付费模型运行。

续租RPC在t=1200.256成功；最后父请求t=970.344开始，耗时421.768
秒后正常EOF与作答，跨过续租时点。续租后未新发起chat/delegation，
也未跨过初始租约真正到期点，不能宣称验证新凭证主/子请求或
一小时到期后的持续运行。主/子48次传输均有200和正常EOF；工具
发现、auxiliary及收尾警告原样保留。

准确性独立按冻结源码、真实父/子身份与实际工具正文审查：

- 终止标记reset遗漏有局部条件性问题，但额外错误abort还要求
  同实例、无成功清理、新失败非终止类型及普通fallback可用等。
  父总结和Top 3丢失必要条件、扩大持续增长后果，不能全判通过。
- requested children计数及构造失败无局部退款是事实；源码明确
  以requested为政策，未证明只收成功启动的契约。父收到这条注释，
  仍作确定配额缺陷，属于缺少契约依据的判断。
- model switch失败前清内存pin且未局部回滚属实，但不足以证明
  DB持久值已失或resume必选错模型；helper不清已有resume dict。
  Top 3的最小复现还遗漏composer provenance前置条件。
- summary_model字段被清空成立，永久主模型路由及必须恢复旧
  override的契约不在快照证据内，应降为待验证。

同实例compression_count与会话head protection的局部问题可保留；
父纠正了一条子投影字段结论，并将部分清理风险降级，不能将
整份答案归为完全错误。审查不以模型投票或仅引用行号有效判真。
已检查的关键反证到达父记录，未证明这些语义偏差源于通知丢失。
不为通过样题修改生产fixture代码或将指定答案写入提示。

因此本次是当前保留补丁的完整自然交付正证据，重要语义准确性
尚未全通过。单样本不证明总体稳定率、Codex/Hermes等效、所有
平台/远端或长child跨到期可用。本次授权运行已结束，无自动重跑；
只追加本地诊断记录，未推送、合并、发布或重启日常桌面。

事前/事后冻结、原答、逐项系统及语义审计、账单闭合与原始数据：
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-frozen-611074-acceptance/report.md
