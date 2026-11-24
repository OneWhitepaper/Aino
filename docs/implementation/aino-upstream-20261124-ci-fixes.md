# Aino 上游合并后的 CI 修复（2026-11-24）

## 核查基线与范围

- 基线为 main `1fa1ca242143f610e196449e1de47670e2c03609`，对应 PR #61。
- 原始 main CI run `45339137770`：8 个 Python 分片、macOS 专项、JS/TS 及汇总门禁失败。
  Python 日志汇总为 96,780 passed、156 failed、25 errors；失败和 setup/collection 错误不等于独立缺陷数量。
- 从完整日志提取到 57 个 Python 失败文件（包括 collection/setup 错误），不是仅挑选容易通过的用例。
- 本轮在隔离测试 home 中修复并验证，不读取真实账户历史，不改线上渠道、更新源或安装包。
  原始失败收据保留，不改写上一轮集成验收记录。

## 修复内容

### 运行时修复

1. `hermes_cli/profile_provision.py`：在选定的克隆源作用域内复制凭证及语音配置。
   源的空配置不会被承载 RPC 的另一个 profile 填充；新建非克隆 profile 仍继承当前源。
   保留源消失时的 warning、OAuth 单次令牌剥离、频道隔离及显式模型验证。
2. `hermes_cli/web_session_summary.py`：摘要生成绑定 typed persistence 的辅助用量写入器。
   保留 REST/RPC 的真实 HTTP 请求、缓存、模型及账单头断言，并检查摘要用量实际落库。
3. `persistence/sqlite/authority/_local.py`：历史执行收据缺少 `policy` 或 JSON 损坏时，
   模式列表回退到会话保存的模式，而不是中断整个列表；合法收据仍优先。
4. `persistence/sqlite/admin/_reconcile.py`：移除预算启用前重复执行的 durability PRAGMA，
   保留已受预算保护的调用，避免 macOS 冷 schema 解析无限占用网关预留锁。
5. `persistence/sqlite/_schema.py`：列查询和 ALTER 捕获到 `SQLITE_INTERRUPT` 时立即传播，
   由现有事务回滚和预算分类处理，不在取消后继续向其他表发出 schema 操作。
   交叉回归另发现 legacy gateway 探测在筛选身份前枚举所有进程的文件描述符，
   在 macOS 高负载时耗尽预算；现在先用现有 gateway 身份判定筛选，再枚举候选的描述符。
   `foreign_state_db_holders` 的默认全 writer 扫描保持原样，结构维护仍然 fail closed。
6. `process_identity.py`：同一可检查 PID namespace 中已退出但未回收的 zombie/dead 进程
   不再占用完整 lease TTL。未知、存活、同进程或其他 namespace 的 holder 仍保守处理。
7. `hermes_cli/data/plugin_api.json`：移除错误放开的整个 `hermes_state` 模块入口，
   保留已经公布的具体名字，并通过现有生成器更新公开 API 文档。

### 测试与契约适配

- Aino 的 agent、gateway、TUI、历史恢复、摘要、暂停和计费测试改用现有 typed
  persistence 的 sessions/messages/runtime 等接口；不恢复已退休的内部 API 或兼容 shim。
- Worker/插件引擎测试双体补齐实际接口字段；保留 Work/Code 路由、工具配对、未知操作不重试、
  profile/账户隔离、子代理控制范围和资源关闭断言。
- 内存 reference backend 补齐存储协议已经声明的 verbs，并增加同一行为在 SQLite 与
  reference backend 上执行的契约测试，不删除运行时协议一致性检查。
  审查补充了 continuation 返回值的深拷贝测试，防止读取结果反向修改保存的 admission 输入。
- Context engine 测试显式启用要发现的插件，并验证未选择或禁用的插件不会被配置列表执行。
- 版本兼容测试围绕现有上游版本边界检查，不把旧版本字符串当永久值。
- Linux afterPack 测试提供 electron-builder 实际传入的 packager/config/projectDir；
  缺失 facts、丢失文件及不一致 payload 仍被原有门禁拒绝。
- 数据库预算测试通过真实 StoreAdmin 进入，并分别在 BEGIN、PRAGMA、ALTER 注入取消；
  不延长截止时间，不跳过字节、历史和锁占用断言。
- 异步委派测试等待前一用例的真实持久化完成，避免它的晚到完成事件污染下一用例；
  共享存储初始化测试在第二个 opener 实际进入 registry wait 后才释放第一个 initializer。
- 两项自动 VACUUM 回归显式限定为测试自己创建的进程库存，仍使用真实 psutil 描述符及
  SQLite 扫描，避免 macOS 的 psutil 在枚举无关桌面进程时触碰真实账户文件。
  只投影扫描器的 psutil 绑定，不改全局 psutil 或 home I/O guard；保留外部 holder 拒绝、
  holder 退出后的 VACUUM 成功、以及 retired generation 持续持有期间三轮维护断言，
  并增加真实子进程 PID 被识别的正向断言。生产的全 writer 扫描未因此缩小范围。

## Nexus 固定源单独交付

原 PR 的 catalog run `45338928226` 另有 Nexus pin 不可达的问题。
完整 clone 无法获得旧对象 `526ef84dc163d074bcbe9bd670ceaa8b2f7952db`；
GitHub 仍能读取旧对象，因此不是“仓库已删除”。

对同版本 0.22.65 的可达对象 `4122426a8dbd85b880e13bdaeeb49615c4fc41d7` 做了逐 blob 比较：

- 插件子目录文件集合不变，除 `__init__.py` 外所有 blob 相同。
- 唯一文件差异为注释和一个示例 docstring 中的信息匿名化；移除 docstring 后的 Python AST 相同。
- 旧插件树为 `57bc0e2695d54065dc92f32703cd418d6f34254a`，
  新插件树为 `e52dd7a317ffb45e89c0020d9f8f2831d01c5634`。
- SHA、文档链接和图片链接一起固定到同一个经检查的 commit，不采用浮动分支或 tag。

**提交/PR 必须拆分**：catalog pin 修复只包含 `plugin-catalog/**` 数据；
运行时及测试修复走另一条 PR。现有 catalog admission 明确拒绝 entry 与运行时代码混合的 PR，
本轮不放宽这个门禁。

因此 pin 修改保存为收据目录的 `nexus-repin.patch`，**未混入当前运行时修复 diff**。
2575 个目录文件的结构校验通过；原样固定源校验也返回 0，但 Linux 依赖准备报告了
browser-harness/Pillow 版本冲突和一个 NVIDIA 包的平台不匹配，随后现有 validator 回退完成探测。
这不能称为“依赖安装完整验收通过”，独立 catalog PR 交付前仍需处理该依赖验证问题。

## 验证收据

本轮收据目录：`/private/tmp/aino-upstream-20261124.djqV9J/ci-fixes/`。
Python 一律经过 `scripts/run_tests.sh`、隔离 home 和 per-file subprocess；最终回归禁用失败重试。
各领域的原始 red、过渡失败、最终 green 和精确文件清单均保留在 worker 报告中。

### 最终本地验收

| 检查 | 结果 | 收据 |
| --- | --- | --- |
| 原始 57 个 Python 失败文件，扩展为 69 文件回归，4 workers、失败重试为 0 | 849 passed，0 failed，13 平台/既有 skips，exit 0 | `controller-final-regression-4.log` |
| 全部存储契约及进程身份相关测试，183 文件 | 4937 passed，0 failed，65 skips，exit 0 | `controller-contracts-final.log` |
| Electron/platform 测试 | 514 文件通过，11 文件跳过；4883 passed，76 skips，exit 0 | `controller-electron.log` |
| 桌面 TypeScript 类型检查 | exit 0 | `controller-typecheck.log` |
| 原生 Linux browse/holder 两文件 | 37 passed，0 failed，6 macOS skips，exit 0 | `linux-holder-optimized-final-3.log` |
| 最后新增的维护测试隔离与 browse/holder 交叉回归 | 41 passed，0 failed，4 Linux skips，exit 0 | `maintenance-inventory-green.log` |
| `python scripts/check` | 22 checks，ok；0 blocking、0 advisory，exit 0 | `check-final-maintenance.log` |

原始 57 文件清单逐项包含在最终 69 文件清单内；以上测试集合有重叠，不相加当作独立用例总数。
13 项跳过不是新增豁免；原生 Linux 专项另有上述实际执行收据。
未重跑完整约十万项 Python 测试，不能将定向及契约回归描述为全量 CI 通过。

最终维护测试隔离经独立只读审查通过，无 Critical/Important/Minor findings，报告为
`maintenance-inventory-review.md`；之前运行时及契约问题的审查与修复记录保留在 `review.md`。
先前 `controller-final-regression-3.log` 的两个环境隔离失败原样保留，新增的 red/green 收据为
`maintenance-inventory-red.log`（2 failed）与 `maintenance-inventory-green.log`，没有覆盖中间失败。

完成上述本地验收时，修复在分支 `codex/fix-upstream-ci-20261124`，尚未提交、推送或合并。
后续按用户授权提交、推送及合并时，以该分支对应的 GitHub PR 和实际 CI 记录为准。
GitHub 的旧失败结果不会因本地测试通过而改变，需要提交推送后重新运行完整 CI 才能确认。
Nexus catalog pin 及其依赖准备问题仍按上文独立交付，不在本次运行时修复中宣称解决。

这份记录不代表 GitHub 已经重跑成功，也不代表完成新的安装包发布。
没有通过关闭检查、删除断言、修改计费渠道或更换模型来处理失败。
