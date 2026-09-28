# Ultra 委派：交给 DeepSeek 的未完成工作检查点

记录日期：2026-09-28。分支：`codex/proactive-delegation`。原始基线：`559bbf043287752ed97afd0d6d4d68c9e74227a3`。

**本分支是 WIP 检查点。已有运行链改造和回归，但核心目标尚未完成。不要把提交、测试通过或父阶段单独重放成功当作完整任务验收通过。**

## 先理解要解决什么

让 Aino 的 Ultra 档在完整复杂任务中合理调用子智能体、收回结果、完成必要核验，并在合理时间和成本内稳定交付可靠的最终答案，尽量接近 Codex 使用 GPT 模型的协作效果。Aino 基于 Hermes 二次开发，必须同时参考上游 Hermes 和 Codex 的代码、文档，优先扩展现有机制。

当前最主要的问题仍是：**从头运行复杂任务时，子任务已经完成且结果已送达，父任务仍可能持续查文件、修订、计数字数，消耗完预算却没有自然最终答案。** 某些能够交付的答案仍把证据不足的疑点写成确定缺陷。效率和准确性都需要验收；只修几个审查结论不能代替解决完整任务交付。

最新证据没有证明一个能解释所有失败的确定性运行时根因。已确认部分轮次通知完整且及时送达，因此不应继续无证据叠加完成通知、催促收尾提示或第二套调度器。模型行为、输入契约、核验策略、请求时延各自的贡献仍需区分。

## 交接入口

1. 先读根目录及所改区域的 `AGENTS.md`。
2. 阅读本文件和 [精选验收证据](ultra-delegation-evidence/README.md)。该目录包含来源说明、派生统计、原始子证据和最终答案；不是完整私有会话归档。
3. 阅读 [可移植验收脚本说明](../../evals/ultra_delegation/README.md)。脚本从先前实际使用的外部 harness 迁入，便携化只处理路径/入口，未用新调度器代替生产逻辑。
4. 查看 `git diff 559bbf043287752ed97afd0d6d4d68c9e74227a3..HEAD`，区分生产代码、测试、交接材料及冻结测试快照。

新机器可获取这个分支：

```bash
git clone --branch codex/proactive-delegation --single-branch https://github.com/OneWhitepaper/Aino.git
cd Aino
git status --short
git log -1 --oneline
```

原机器已经有该分支的独立 worktree；直接使用该 worktree，不在主 checkout 强行切换一个已被占用的分支。交接提交不会合并 `main`、更新生产或启动日常桌面。

## 已有代码具体做了什么

| 部分 | 主要文件 | 行为和边界 |
|---|---|---|
| Ultra 选档与界面 | `agent/reasoning_effort.py`、`agent/model_metadata.py`、桌面 reasoning-effort / reasoning-pill / model-edit-submenu / config-field 与翻译 | Ultra 是客户端协作模式；实际请求按模型支持范围转换，本次 GPT 路由为 max，不直接发送不支持的 ultra 字面值。保留父档位与自定义模型选择。 |
| 模式说明与可见消息分离 | `agent/ultra_collaboration.py`、`agent/turn_context.py`、`agent/api_content.py`、`agent/session_persistence.py`、`hermes_state_messages.py` 及消费侧 | Ultra 开启/关闭说明只在需要时进入当前消息的 API sidecar。通过运行时来源信息判断状态，支持持久化和恢复；不每轮重建系统提示，不把 API 附加内容暴露为用户原文。 |
| 子任务选档 | `tools/delegate_tool.py`、`tools/delegate_tool_tasks.py`、`tools/delegate_tool_dispatch.py` | 扩展现有任务参数，可显式指定单任务 reasoning_effort；未指定继续使用已有配置/继承规则。先验证整批参数，不强制所有子任务降档。 |
| 子上下文选择 | `tools/delegate_tool_tasks.py`、`agent/inline_tool_executors.py`、`run_agent.py` | 现有任务 context 可选择 context_turns=none/all/正整数；投影可见用户轮和最终回复，过滤系统提示、工具轨迹、隐藏推理和图片。默认 none 保留 Hermes 隔离语义，不等于 Codex 全量原生 fork。 |
| Responses 恢复顺序 | `agent/codex_responses_adapter.py` 与 sidecar 相关文件 | 保存原生 reasoning/message items 的相对顺序，恢复后重建；仅本地顺序标记不发到 API。继续使用 issuer/model/call-ID 与压缩保护，不能为模拟一致性删除这些保护。 |
| 子任务输出格式重试 | `tools/delegate_tool_child_run.py`、`tools/delegation_output_schema.py` | 格式纠正继续原历史；传输失败或中断不当作 JSON 格式错误重跑任务。完整继续历史不再次重复拼接。JSON 合法不代表事实正确。 |
| 异步完成恢复 | `tools/async_delegation.py`、`gateway/run_notifications.py`、`tui_gateway/session_notifications.py` 等 | 复用 durable ledger、delivery claim、profile scope、现有通知队列；重捞已死亡 owner 遗留的完成事件，并支持失去归属或消费失败后的重新投递。子完成状态与父最终交付分开。 |

本分支相对于基线包含两个此前已存在于工作树、尚未跟踪的生产模块：`agent/api_content.py` 和 `agent/ultra_collaboration.py`。它们会随检查点提交；不能把“最近一次对齐阶段未新增模块”误写成“整条分支零新增模块”。其余三份先前未跟踪文件是对应测试。

本次交接前原有 54 个文件的内容保持不变。后续核查发现的风险应明确记录并做针对性修复；本检查点不宣称这些修改已可合并发布。

附带的小改动包括 `config-field.tsx` 的 Unicode 描述去重及对应中文测试、通用 prose 长度提示调整；中文委派文档默认并发 3→10 是与既有配置默认值同步。

## 交接审查新复现的两项待修问题

本次保存前的独立审查通过纯内存生产 helper 探针复现了两项风险。它们尚未修复，且**没有被证明是此前大型任务无 final 的唯一根因**。详细路径、输出和可复制命令见 [检查点代码审查](ultra-delegation-evidence/checkpoint-review.md)。

1. **恢复队列的 offer 登记竞态。** `tools/async_delegation.py` 先向共享队列 put，再记录 `_offered`；另一 poller 可在两者之间消费无主事件并 return_completion_offer，随后生产线程再次登记，造成队列已空但 offer 仍存在，后续 sweep 跳过它。修复时要保留现有所有权和 delivery claim 语义，并测试真实交错时序。
2. **未答复消息重试中的 Ultra 撤销缺口。** adopt_unanswered_turn 保留原 ON sidecar；effort 改为 Max 后，重试仅检查被采用用户行之前的历史，可能写入 false 元数据却仍发送旧 ON 内容，下一轮也不补 OFF。普通新消息的 Ultra→Max 测试未覆盖此路径。修复需区分未发送重试行与已发送历史，保持缓存和用户原文合同。

## 已查明的事实与未完成项

- **400 字来自测试输入。** 它是“每组结论控制在 400 字以内”的任务要求，不是 Hermes 或会话资源面板的输出限制。
- **短英文思考摘要属于实际保存的原生摘要。** 没有证据证明界面删掉了正文；不能据摘要短就断定没有推理。HTTP 总耗时也不等于内部思考时长。
- **委派和结果回传已在多轮真实请求中验证。** 默认批量和上游 independent_completions 都试过。切换逐项回传不曾证明解决完整交付问题。
- **长篇完成通知等无效改动已撤回。** 已恢复通用执行规则，并保留简短字数例外及已验证的运行链修复。不要从历史报告捡回已撤回提示。
- **固定子结果后父阶段能够结束，但完整任务仍未通过。** 2026-09-28 最后一次 replay 没有重跑任何子模型；首次 8 项真实输入与源运行一致。
- **核验仍存在过度断言。** 例如局部 provenance 恢复不对称不等于已证明后续错误消费；显示视图和行动视图不同不等于显示 bug。必须保留调用方未知及明确设计条件。

## 最近实验与合理解释

| 运行 | 结果 | 已结算 USD |
|---|---|---:|
| `live-large-132101`：默认批量、证据 JSON 契约 | 三子自然完成且完整送达；父后续 21 次读取、19 次搜索、1 次计数；1120.27 秒触及累计粗估输入 2,012,563，未交付 final | 3.855903 |
| `live-replay-140532`：上述固定结果的父阶段独立重放 | 17 次读取、4 次搜索、4 次草稿计数；433.356 秒自然 final，436.66 秒结束；准确性未整体通过 | 1.632997 |

源批量实验的预算：1200 秒、64 次普通请求、累计粗估输入 2M、$5 延迟结算观察阈值。父重放重新计预算：1200 秒、24 次普通请求、2M 粗估输入、60K 观测输出、$2 延迟结算观察阈值。金额阈值不是硬金额封顶。核对入口和报告，不要只根据旧默认值推断实际预算。

源在批量结果齐备前已用约 833.838 秒、840,260 粗估输入。重放父 chat 使用 972,632 粗估输入，比源名义剩余输入少，但用时高于源剩余约 366 秒。运行轨迹和缓存状态不同，不能拼接两次采样来宣称原完整预算通过，也不能把成功直接归因于多给 token。

重放最终三组原始 Markdown 正文长度 392 / 401 / 356；仅去格式标记的可见正文为 384 / 385 / 346。第二组在严格原文口径超 1；同时保留两种口径。原始输出不能人工修改后再作为验收证据。

重放有 11 次父 chat（$1.543187），final 后另有 1 次自动后台技能复盘（$0.089810）。后者没有客户端完成 usage，但有实际 HTTP 和最终结算，不能当作新子任务或零费用。12/12 请求均已 settled。25 次历史运行累计 $56.080199；本次准备检查点没有新付费模型调用。

日常任务曾自然交付，但独立增强合同发现大整数零折扣和并发导出 ID 的边界错误，不能当作整体质量通过。Codex 参考运行也有累计输入耗尽；早期父 Max/子 Low 与 Aino 子 High 不匹配，后续显式 High 运行仍触及预算。因此尚无严格、成功的 Codex 等效性证明。

## 验证记录与复现入口

本次检查点重新运行的定向测试：

```bash
scripts/run_tests.sh \
  tests/agent/test_api_content_row_addressed_backfill.py \
  tests/agent/test_api_content_sidecar.py \
  tests/agent/test_codex_responses_adapter.py \
  tests/agent/test_gateway_turn_sidecar.py \
  tests/agent/test_reasoning_effort_labels.py \
  tests/agent/test_run_agent.py \
  tests/agent/test_ultra_collaboration.py \
  tests/gateway/test_message_timestamps.py \
  tests/tools/test_async_delegation.py \
  tests/tools/test_delegate_output_schema.py \
  tests/tools/test_delegate_reasoning_effort.py \
  tests/tui_gateway/test_notification_turn_release.py -j 8

npm --prefix apps/desktop run test:ui -- \
  src/app/chat/composer/reasoning-pill.test.tsx \
  src/app/settings/config-field.test.tsx \
  src/lib/reasoning-effort.test.ts
```

Python：12 文件 / **489 项通过**，0 失败，41.9 秒。桌面：3 文件 / **9 项通过**。worktree 可通过已有 `HERMES_PYTHON` 选择安装了项目依赖的 Python；不要直接运行裸 pytest。它们是定向回归，不是完整项目全套测试，也不是模型效果验收。

验收脚本迁入后，Python 编译、TypeScript 打包及 Electron `--help` 均通过；最新 matched evidence-contract 的离线真实 RPC 为 3 个子任务、9 次脚本模型请求、9.54 秒、`normal_final`，冻结快照未改动。根代理已读取原始 run report 复核此结果；16 项 HTTP 观察器本地合同也通过。这些调用全部是本地模拟，没有新付费请求。

提交前逐项核对了原 54 文件、10 个冻结输入及证据包哈希。源码和交接文档的 diff 空白检查通过；唯一原始模型答案保留五处 Markdown 双空格换行，通用 `git diff --check` 会报告这五处 trailing whitespace，未为消除提示而改写原始证据。

此前更广的委派 661 项、Responses 444 项、恢复 113 项回归均曾通过；范围可能交叉，不相加成独立总数。上一次 replay 准备还跑过 15 项恢复合同。历史记录与本次新鲜验证分开理解。

先按 eval README 做本地 scripted-model dry，确认真实 RPC、委派、恢复和记录路径，再安排必要的真实模型实验。dry 只能证明调用链，不能证明模型会主动合理委派或最终事实准确。默认批量证据场景不需要私有 review skill。旧原始任务若启用该 skill，需要明确提供它；缺失时不得静默换提示后称为原题复现。

**旧父重放无法仅靠 Git 中的精选 JSON 精确重建。** 原恢复依赖本地原会话数据库及 issuer 绑定的 Responses sidecars；这些私有材料不会推送。可以在新机器先执行完整任务得到新 run，再对自己的 run 做 replay；那是新实验。冻结源码快照用于保持旧题目，当前生产代码的修复不会自动改变该快照。

## 对照依据及作者来源

- Codex 官方代码固定在 [`c7e80f873f67dbef58206b9d4f3c60e9d556eb16`](https://github.com/openai/codex/tree/c7e80f873f67dbef58206b9d4f3c60e9d556eb16)，并参考 [Subagents 文档](https://developers.openai.com/codex/subagents/)。
- Hermes 对照固定在 [`a3a85a3143a54305cafd79065a22de5b51395027`](https://github.com/NousResearch/hermes-agent/tree/a3a85a3143a54305cafd79065a22de5b51395027)，并参考 [Delegation 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation/)。不要把固定版本称为未来时点的最新上游。
- orphan completion 恢复部分窄范围移植自 Hermes [`021530a69ecb19426fe168118cbfea039780cb0d`](https://github.com/NousResearch/hermes-agent/commit/021530a69ecb19426fe168118cbfea039780cb0d) 和 [`02ed55e572a96246d34f0e2fb3aa51197db50df5`](https://github.com/NousResearch/hermes-agent/commit/02ed55e572a96246d34f0e2fb3aa51197db50df5)，作者 brooklyn!，须保留来源与贡献，不宣称原创。没有一起移植那些版本的无关功能。
- OpenAI 托管 Responses multi-agent 不是 Codex 本地子任务实现的直接替代；当前 managed endpoint 未完成该能力验证。维持现有 Hermes 审批、租约、profile、持久化机制。

## 接手后的具体工作与验收标准

先从保存的失败轨迹建立可证伪解释：哪些请求在验证什么、何时证据已足、何处重复读取、修订或丢失 limitations；分别检查运行时控制流与模型决策。新发现的代码 bug 要给真实可达路径和红→绿行为合同。优先修改已有模块、任务契约或技能；保持系统提示稳定、原历史前缀、profile 隔离及工具调用配对。

原先估算的 4–8 小时只是首轮定位、修复及验收的工作量估计，不是已确认根因或保证修好的期限。应在前 1–2 小时形成具体解释与修改依据，避免不断改变多项变量或无目的重复付费。保存失败记录，记录每轮模型、父/子实际 effort、工具、提示、预算、请求、耗时及最终费用。

完整验收至少同时满足：

1. 从用户初始请求开始，自主决定是否委派，主任务无需人工催促而自然最终交付；不能只给子完成、工具草稿或强制总结。
2. 在明确且一致的原预算内完成；全部子/父/辅助请求纳入费用和请求记录，延迟账单完整核对。
3. 委派结果完整、不重复；失败/中断与格式修正语义正确；缓存、恢复、profile 和副作用边界保持。
4. 最终答案满足任务约束，重要结论有证据，未知项保留条件；生成代码通过独立行为合同。
5. 多个复杂任务重复验证稳定性；与 Codex 比较时固定模型、父/子 effort、任务、预算，并公开工具和上下文差异。

本次交接保存并推送 WIP 分支，没有合并、发布或安排新的付费实验。
