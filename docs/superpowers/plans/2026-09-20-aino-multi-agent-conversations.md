# Aino 多智能体普通会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一普通会话实现“通用 Aino → 专家 A → 专家 B → 通用 Aino → 专家 A”，保持项目、公开历史及自动子代理能力。

**Architecture:** 复用 Hosted room/event/driver，在其上添加指定回复者策略；每个参与者保留 Profile 内部会话。公开记录与内部模型历史分离，使用可靠输入回执桥接。前端可见 conversation ID 与执行 session ID 分开。

**Tech Stack:** Python / SQLite / 既有 JSON-RPC 与 Pydantic contracts；Electron / React / nanostores / Vitest；现有 Hermes 模型、工具与委派运行时。

**Spec:** [已确认架构](../specs/2026-09-20-aino-multi-agent-conversations-design.md)。用户于 2026-09-20 确认。

## Global Constraints

- **一个可见会话、一份公共记录、每位参与者一份属于自己 Profile 的内部会话。**
- 首期同后端、同一已验证文件执行环境；每轮一位主执行者，仍可自动派出并行子代理。
- 选择 / 取消专家只影响下轮；通用助手是固定运行身份；保留无项目会话。
- 内部 session 的 system/SOUL/工具/记忆快照稳定，增量只追加；历史作者与本轮身份进入模型输入。
- Profile 私有记忆与 Bot Chat 不自动汇入公共记录，能力与权限不取专家并集。
- 自动子代理结果、终端后台结果、其他唤醒都经过正确会话的协调入口，不绕写 / 串线 / 重复运行。
- 新功能不得绕过原模型计费、权限审批、隔离执行策略；不承诺外部副作用 exactly-once 或子代理跨进程恢复。
- Python 测试始终用 `scripts/run_tests.sh`；JS 行为用 Vitest，禁止读源码文本作测试；真实导入与临时 Profile E2E 是发布条件。
- 生产代码不增加常驻核心模型工具；沿用原依赖，无新非密钥环境变量；新增协议从 Python 生成 TS。
- 只读 root 及所改目录的 AGENTS 后编辑；巨大 facade 先提取相应职责，禁止继续堆大函数。
- 保留当前未提交改动；不使用 `reset --hard`、`clean -fd` 或 `git add .`；本计划本身不指示推送、发布或搬动真实用户状态。

## 范围与执行顺序

拆成两份相互依赖、可单独验证的计划：

1. [A：运行闭环与桌面接线](2026-09-20-aino-multi-agent-conversations-core.md)。在隔离测试环境交付完整切换、公开上下文、工具、审批、自动子代理及取消恢复。A 阶段不替换用户的默认普通会话入口。
2. [B：项目统一、数据迁移与默认启用](2026-09-20-aino-multi-agent-conversations-rollout.md)。完成共享项目管理、旧会话接入、存储 / 备份、Agent Hub 导航整合和默认启用。A+B 完成才满足已确认的完整产品目标。

不纳入本轮实施：自动选择多位命名专家组团、跨宿主项目映射、跨项目私有记忆命名空间。这不删减已有 Agent Hub 群聊或自动临时子代理能力。

## 当前基线与工作区交接

- 基线提交：`148c35ab27bd752b19e1e35273229d714ac57d4b`。
- 原工作区分支：`codex/aino-platform-identity-models-billing`；实施分支：`codex/multi-agent-conversations`，位于 `.worktrees/multi-agent-conversations`；远端基准为 OneWhitepaper/Aino。
- 已有未提交界面工作包括 Profile 导航、配置页、移除设置重复入口、技能隔离及对应测试。执行者先逐项审阅 diff，保存到仓库外的任务快照；隔离 worktree 必须应用这份已审阅的增量，不能只从 HEAD 启动后丢掉已完成工作。不得携入真实密钥、Profile 数据库或项目产物。
- 架构 / 计划原所在目录被忽略；本次仅对四个项目文档增加精确跟踪例外，其余 superpowers 文件仍忽略。
- 之前已有 Hosted 基础回归：4 文件、174 通过；这不是新功能测试，也不能代替实施后的验证。
- 新功能测试全用临时 HERMES_HOME，多 Profile 测试还需隔离 `Path.home()`；不迁移真实用户数据做开发验证。

准备检查命令（只读）：

```bash
git status --short
git diff --stat
git diff --check
git worktree list
git rev-parse --show-superproject-working-tree
git check-ignore --no-index docs/superpowers/specs/2026-09-20-aino-multi-agent-conversations-design.md
```

最后一条对这份设计应返回非 0；用 `git ls-files --others --exclude-standard docs/superpowers` 确认四个目标文档可被跟踪。执行时用 `codex/` 功能分支；已有外部管理 worktree 则直接沿用。环境已具备依赖时不重复安装或更新 lockfile。

## 可验证的交付关卡

| 关卡 | 完成条件 | 失败时处理 |
|---|---|---|
| G1 存储和输入回执 | A1–A4：原群聊行为不变；重复输入、跨库中断和恢复均不重复入模 | 停留于后端修复，不接桌面新入口 |
| G2 运行与自动委派 | A5–A7：精确 owner、桌面能力、后台续答、子代理控制都走同一协调链 | 新模式维持测试环境能力，不删除旧路径 |
| G3 可见端到端 | A8–A10：完整五段切换、无专家、作者回顾、停止和重连通过 | 记录具体失败，不以 UI 截图或 mock 全绿代替 |
| G4 数据与兼容 | B1–B4：共享项目、可重入迁移、完整备份恢复、Agent Hub 回归通过 | 不默认启用，不迁移真实用户数据 |
| G5 默认发布准备 | B5：真实桌面验证、相关 Python/JS/契约/类型/构建通过 | 保留旧入口与数据；修复后仅重跑受影响验证 |

## Spec coverage

| 架构要求 | 实施任务 |
|---|---|
| 指定专家、取消回通用、A→B→A | A1、A5、A8、A9、A10 |
| 独立 Profile/session、缓存及模型快照 | A2、A3、A4 |
| 作者 / 回复对应、摘要溯源、配置新 generation | A2、A3、A9、A10 |
| 项目 cwd、真实执行环境、无项目 | A3、B1 |
| 幂等、取消、流式、审批、恢复 | A4–A7 |
| 自动子代理及其他后台唤醒 | A6、A7、A10 |
| 旧会话迁移与阻止旁路写入 | A3、B2 |
| 公开历史容量、附件、归档、备份 | A1、A2、B3 |
| 统一列表、项目管理、Agent Hub 唯一管理入口 | A8、A9、B1、B4 |
| 不影响 CLI/TUI/网关/cron/既有 Bot Chat | A1、A3、A6、B4、B5 |

## 实施纪律与提交边界

每项任务先证明行为测试失败，再实现并跑对应回归。提取现有职责的任务只做等价移动，与新行为分开审阅。测试可使用确定性模型边界，但会话创建、真实配置、文件目录与 SQLite 走实际路径。

独立任务完成后做一次聚焦审阅；只有接口契约固定且不编辑同一文件的任务才并行。以下子计划中的示例是拟议 API / 测试入口，绝不表示当前生产已有这些函数。实现以定义的行为契约为准；任何新发现若改变用户交互语义，应记录回本架构，而非隐藏降级。

任务对应逻辑提交边界，但实施过程中不得混入原工作区的无关改动。发布、推送、真实数据迁移不是“文档已确认”的自动副作用；产出可审阅实现与测试记录后再按实际用户授权执行这些动作。

## 状态

- [x] 用户确认架构，补充身份可见性与自动子代理兼容。
- [x] 核实当前代码落点、制定 A / B 子计划并修正文档跟踪问题。
- [x] 完成 A 计划及 G1–G3。
- [x] 完成 B 计划及 G4–G5（本机验收；Docker/Nix、其他宿主与外部服务边界见验收记录）。
- [x] 对实际实现填写测试结果和剩余风险；不得沿用基线通过数宣称新功能完成。

最终结果见 [实施与验收记录](../../implementation/aino-multi-agent-conversations-core-acceptance.md)。
默认已开启；全量 Python 的唯一测试竞态修复后定向复测通过，最终真实桌面 17 个场景全部通过。
代码保存在实施分支，未推送、部署或迁移真实用户数据。
