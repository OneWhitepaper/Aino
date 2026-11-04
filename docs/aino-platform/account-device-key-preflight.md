# 设备 Key 集成与灰度前验收

日期：2026-11-04。用户已授权核对两端集成分支、整理 PR、运行隔离 API 与真实桌面联调，以及多实例和负载验证。本轮不执行生产部署、主分支合并或桌面发布。

## 验收任务

| 任务 | 验收证据 |
| --- | --- |
| 核对集成链 | 最新远端 main、PR #26、设备 Key 分支的祖先关系；两端 PR 的精确比较基线；原工作树内容保持 |
| 隔离 API 环境 | PostgreSQL/Redis 实例、原迁移流程、真实 HTTP 管理与模型入口、受控本机上游；没有生产数据库或模型请求 |
| 真实桌面联调 | 原生 Electron 与私有主进程桥；真实登录、加密恢复、多会话复用、文本/图片套餐计费、撤销及明确重新授权 |
| 灰度前验证 | 两个独立 API 进程共享数据库和 Redis；正常撤销与失效链故障窗口；并发请求时延、错误数、组/订阅账务和重复结算 |

## 实施约束

- 继续使用现有工作树与分支。保留旧工作树的未提交文件，不把其他任务的修改整体搬入。
- 新 PR 以最小且完整的既有依赖为基线。若 main 尚未包含集成依赖，清楚列出合并顺序，不把整条上游集成历史伪装成本次协议差异。
- 所有运行状态、测试登录和 Electron userData、`HERMES_HOME`、`HERMES_RUNTIME_DIR` 隔离。测试秘密仅保存在本地受限文件，不进入报告、截图或 PR。
- 复用已有原生测试和 API fixture。真实进程与真实账务证据同单元/替身测试分开记录；未实测的容量或 SLA 不标为通过。
- 缺陷沿原服务和模块修复，补行为回归；不新增钱包、凭证管理器、主进程流量转发器或旁路鉴权。

## 结果

### 分支与 PR

- 桌面 `main=e86635e60e` 已包含于 `v0.22.6 集成 03fbd556f5 → PR #26 beb7e58e2d → 设备 Key`。新 [PR #27](https://github.com/OneWhitepaper/Aino/pull/27) 基于 PR #26 的分支，避免将 3,498 个既有集成提交混入本次协议审查。
- API 原设备提交基于 hygiene `ac3f42265`，缺最新 `codex/upstream-v0219-mcp=b30d50515` 的 92 个集成提交。已保留备份分支，并将设备提交移到 b30，得到 `7f94506f8`；[API PR #2](https://github.com/OneWhitepaper/Aino-API/pull/2) 基于最新集成。两种旧 v26 鉴权快照合同合并为 v27，同时保留按图片数量计费、scoped admin Keys 和管理 MCP。
- 独立临时副本重新生成 Ent/Wire，342 个生成及依赖文件与新基线下的提交一致，没有生成差异。
- 两端最新 main 都是当前分支的祖先。集成父分支仍须先合入，父 PR 若使用 squash，再仅移植子提交并重新核验。两端 PR 目前是草稿。

### API 双实例实测

使用 PostgreSQL 18.1、Redis 8.4、完整 SQL 迁移和两个真实 `cmd/server` 进程。控制代理只提供本地受限 fixture 和计数；登录、目录、设备身份、模型转发和结算全部经过实际服务。上游为受控本机替身，没有生产模型请求。

| 验收项 | 实测结果 |
| --- | --- |
| 同 Key 混合文本/图片、余额/订阅并发 | 48 请求，0 错误，114 ms 总耗时；p50 101.112 ms，p95 111.679 ms，max 113.870 ms |
| 历史账务 | 60 条真实 HTTP 请求用量；余额扣 0.08130000，文本订阅 0.00330000，图片订阅 1.04000000；实际组与订阅逐条核对 |
| 同次结算重复投递 | 相同 `UsageBillingCommand` 并发提交 12 次，仅 1 次实际记账，订阅增加 0.00010000 |
| 相同 HTTP 内容重新发送 | 8 次独立物理请求分别计费，沿用原服务端权威请求 ID；不能以重用客户端请求内容免单 |
| 套餐权限收回 | 约 15 秒内拒绝，符合目录投影 15 秒硬时效；重新授予可恢复 |
| 余额耗尽 | HTTP 403，不采信身份快照中的旧余额 |
| 正常撤销传播 | 实例 1：9 ms；实例 2：10 ms 后拒绝；另一次完整运行确认明确重新授权保留 Key ID、更新秘密且两实例均可再次推理 |
| outbox 与广播事件均省略 | L1/L2 配置 300 秒，真实等待且不加速时钟；实例 1 于 55,012 ms、实例 2 于 55,016 ms 的轮询中首次拒绝，未把旧 L2 回填变为新权威 |

以上是本地有界并发与故障恢复证据，不能外推生产容量或网络传播 SLA。故障实验仅对专用探针 Key 的一次数据库更新省略 outbox；不操作生产数据，也未影响桌面测试账号。

最新集成还暴露了组 `image_count_billing` 收费开关变化未触发原 outbox 的缺口。已在 migration 253 补齐比较，并用真实数据库行为测试证明先红后绿。永久 Key 无固定组，组权限和费率变化仍由单独的 15 秒投影约束。

### 原生桌面

真实 Electron 44.9.3 已完成 UI 登录、余额聊天和独立文本套餐聊天，均使用同一 Key ID 1、版本 1，设备签发 POST 计数为 1。直接只读查询专用 PostgreSQL，余额请求归属 group 2、文本套餐请求归属 group 3 / subscription 1，并保留独立 session/turn/call 关联。

系统 `safeStorage.isEncryptionAvailable()` 为真，账户快照为 `remember_state=encrypted`。完整冷重启后自动恢复登录，Key ID/版本不变、签发 POST 仍为 1，首个真实文件工具回合耗时 4.144 秒。原生主进程读取的实际秘密未出现在 renderer local/sessionStorage、可见页面、配置、聊天数据库及 WAL、桌面/Agent/gateway 日志；密文文件权限 0600，未含明文 Key。

原生验收定位并修复了只读工具可用性、runtime readiness 和上下文长度探测等待 Nous 交互挑战的问题；复用现有 `background_caller`，不改变前台登录挑战、会话工具或提示缓存。真实 cold start 已验证首回合不再等待 120 秒。余额生图、同聊天改图和图片套餐完整回合均已通过，界面显示真实生成附件。实际图片转发保持 `gpt-image-fixture / auto`；改图上传一张原生生成的 PNG，fixture 校验源图像素完全匹配。三次请求分别沿余额或图片套餐计费，每次图片成本 0.08；图片套餐对应 group 4 / subscription 2。

真实设备 UI 撤销要求近期登录；通过正常退出/登录后确认撤销。原 Key 版本从 1 变为停用版本 2，后续聊天明确提示重新授权，用量行数不变，设备 Key 总数仍为 1。退出已清除本机秘密，首次重试有一次被拒绝的 ensure POST，因此“未自动重建”指无新 Key 或秘密、无新增模型用量，不等于零 HTTP 调用。再通过 UI 明确重新授权，同 Key ID 变为有效版本 3，并完成恢复后的真实工具回合。

第二窗口连续文本套餐测试发现回合结束事件未带 catalog ID、使后续界面退回同名底层模型的缺陷；已在既有 `local_session_info` 统一附带托管模型元数据，保留 SDK wire model。lease/device 先红后绿，另覆盖 BYOK、单回合覆盖、图片与状态。最终源代码 `8c3f37e709` 已再次冷启动：自动恢复加密登录与同 Key ID / 版本 3，签发 POST 仍为 3。第二个原生窗口选择文本套餐，首回合 2.364 秒完成，同聊天后续回合也成功；聊天 ticket 计数 1 → 1（另有独立图片用途 ticket），界面始终保留套餐名。四条实际调用账单全部为 group 3 / subscription 1，余额不变。公开事件同时保留 wire model 与明确 catalog ID，不再从套餐漂移到余额。

全部运行使用本机受控模型上游。测试协议修复仅覆盖唯一工具调用 ID、读取正确 session 列及显式图片临时根；合法 PNG、精确配对和已知模型校验保留，未知 ID/模型、路径和符号链接逃逸、错误 PNG 的负例均通过。原始 API origin、设备身份和账务数据库在原生矩阵中保持一致；为修复测试协议切换过本机上游，直接数据库证据与实际文件独立核对，不将测试替身当真实供应商验收。

最终原生账本共 40 条已结算物理调用、40 个独立 call ID，覆盖 11 个会话、15 个回合。余额组文本合计 0.0028、图片 0.24，严格满足 `37.5 - 0.2428 = 37.2572`；文本订阅累计 0.0008，图片订阅累计 0.08，与各订阅用量完全一致。初期协议诊断及修复前的调用保留在历史账本内，没有删除或冲销来制造结果；修复后的指定文本套餐四条调用单独核对正确。

### 复跑

API 两进程验收复用现有 opt-in `integration && nativeconsumer` 测试和 Docker harness。在 API 仓库的 `backend` 目录构建；直接运行编译后的测试二进制时切到测试包目录，以保留 `go test` 原有的资源路径：

```sh
go build -o "$TMPDIR/aino-device-key-preflight-server" ./cmd/server
go test -c -tags 'integration nativeconsumer' -o "$TMPDIR/aino-device-key-preflight.test" ./internal/repository
task_dir=$(mktemp -d "$TMPDIR/aino-device-key-preflight.XXXXXX")
cd internal/repository
AINO_DEVICE_PREFLIGHT_DIR="$task_dir" "$TMPDIR/aino-device-key-preflight.test" -aino-preflight-server "$TMPDIR/aino-device-key-preflight-server" -test.run '^TestDevicePreflightAPI$' -test.v -test.timeout 70m
```

fixture 目录包含临时测试登录与控制 nonce，只能本地保留为 0700/0600，不应作为 PR 或截图附件。测试报告仅记录非秘密计数与账务结果。断言完成后环境仍等待原生桌面消费者；仅桌面矩阵可追加 `-aino-native-only` 以从空计数开始。若 API 与桌面使用不同临时根，追加 `-aino-native-artifact-root` 指定桌面隔离的 `cache/generated/images` 绝对路径，验证器继续检查路径边界、模型和实际 PNG。消费结束后，在另一终端从本地 manifest 读取 origin 与 nonce，向 `/fixture/control/complete` 发送带 `X-Fixture-Nonce` 的 POST，再确认测试进程退出 0；不要公开 manifest：

```sh
python3 - "$task_dir/manifest.json" <<'PY'
import json, sys, urllib.request
with open(sys.argv[1]) as source:
    fixture = json.load(source)
request = urllib.request.Request(
    fixture['origin'] + '/fixture/control/complete', data=b'',
    headers={'X-Fixture-Nonce': fixture['nonce']})
with urllib.request.urlopen(request, timeout=15) as response:
    assert response.status == 200
PY
```
