# 设备长期 Key 实施与验证记录

日期：2026-11-04。范围：已批准方案的批次 1 与本地桌面批次 2。代码在独立工作树验证，尚未部署、合并或发布桌面版本。

## 交付行为

| 事项 | 本地实现 |
| --- | --- |
| 设备身份 | 同站点、账户、桌面安装复用一把长期 Key；Key 不保存套餐或固定计费组 |
| 分类套餐 | 每个实际模型请求携带 `X-Aino-Model-ID`，服务端校验模型及接口后生成请求内的组、平台与订阅上下文 |
| 结算 | 复用原有转发、余额、订阅额度、限流和账务链；无静默换组或余额兜底 |
| 密钥材料 | 创建或轮换只返回一次；服务端显式 SHA256 校验类型；Electron 主进程使用已有系统加密存储 |
| 生命周期 | 稳定 Key ID、设备唯一关联与版本锁；撤销及软删除不会自动补发；需要明确重新授权 |
| 管理登录到期 | 保留已有模型身份；账户管理与恢复轮换仍使用独立登录管理通道 |
| 本地 gateway | 明确 `credential_type=device`、空到期与正整数 Key 版本，无长期绑定的续期或到期定时器 |
| 有效绑定复用 | 当前私有控制连接通过 gateway 可信状态核对 owner、模型、用途、绑定 revision 与 Key 版本后复用 |
| 迟到认证错误 | 使用实际 HTTP 请求捕获的 Key 版本；旧版本错误不能停用正在重新授权或已经轮换的新版本 |
| 普通异步图片 | 持久保存创建时的私有组、平台和订阅身份；读取结果沿原任务路由，核对账户及 Key 归属 |
| 网站设备显示 | 区分长期设备授权与旧临时租约；显示安全设备标识，撤销保留历史用量，不提供秘密取回 |

## 已验证的行为

- 多个窗口/会话与文本、图片共享设备身份，重复请求不重复签发或续期；100 次有效绑定检查不替换 gateway 中的绑定。
- 40 个并发文本/图片请求使用同一 Key、两个订阅组和零余额，组与订阅上下文保持独立；到期、额度耗尽、目录权限收回及模型/接口不匹配均拒绝，不改用其他收费方式。
- 隔离 PostgreSQL 18.1、Redis 8.4 与本机 HTTP 上游执行真实 `Forward → RecordUsage → transaction ledger`。余额路径扣减 `0.0001`、订阅路径记录 `0.0001`；重复上游请求只结算一次，历史 `group_id/subscription_id` 正确，持久 Key 始终无固定组且无到期。
- 真实数据库验证并发创建、同 ID 轮换、版本冲突、撤销/轮换竞争、软删除恢复、全部下线与旧手动 Key 兼容。原始值恰为 `sha256:<64hex>` 的旧手动 Key 仍按明文类型鉴权和失效。
- 设备身份缓存保留权威核验时间，L2 回填不重置其 55 秒硬上限；过期后无法向权威源核验会拒绝。目录权限投影为 15 秒硬上限，支出余额继续使用原账务服务，不冻结在身份快照内。
- 真实 Agent 与 OpenAI、Responses、Anthropic SDK 的回环请求验证目录标识、租约迁移、秘密轮换和辅助任务继承；系统提示、历史和工具集合无需修改。
- 旧租约到期、WebSocket 重连、profile/账户/会话隔离、生图/改图/画质/尺寸，以及浏览器和远程永久秘密边界都有回归覆盖。
- 主进程轮换单飞、记住登录与加密恢复、明确退出、管理登录过期、撤销停止、迟到响应和授权版本竞争均有行为测试。

## 验证入口

最终整合回归：Python 25 文件 **214 项通过**；桌面 Electron/UI 19 文件 **265 项通过**；网站 **40 项通过**。Aino 14 项阻断检查、桌面完整类型检查、两端修改文件 ESLint、Go 相关完整单元套件、竞态检查、服务端构建和 5 项真实数据库集成测试均通过。独立交叉复核发现的哈希类型失效、浏览器秘密边界、旧认证错误与新授权竞争及图片认证错误通知均已修复并补行为测试。

在 Aino 工作树使用已有测试解释器，通过项目 runner 运行 Python 测试：

```sh
HERMES_PYTHON=/Users/zizimutou/Protect/Aino/.venv/bin/python scripts/run_tests.sh <covering test files>
/Users/zizimutou/Protect/Aino/.venv/bin/python scripts/check --base beb7e58e2d
npm run typecheck --workspace apps/desktop
npm test --workspace apps/desktop -- --project electron <covering test files>
npm test --workspace apps/desktop -- --project ui <covering test files>
```

在 API 工作树的 `backend` 目录：

```sh
go test -tags=unit ./internal/service ./internal/server/middleware ./internal/handler ./internal/server/routes ./internal/handler/dto
go test -race -tags=unit ./internal/server/middleware ./internal/service -run 'TestDevice|TestDesktopProjection|TestDesktopCatalogBalance' -count=1
go test -tags integration ./internal/repository -run '^TestDevice(Identity|Billing)' -count=1 -v
go build -o "$TMPDIR/aino-device-key-server" ./cmd/server
```

网站使用 Vue 类型检查、修改文件 ESLint、KeysView 行为测试及语言完整性测试。测试状态均隔离；没有调用生产模型、生产数据库或生产账户。

## 交付边界与发布前工作

- 本批支持现有按金额额度结算的分类订阅。按图片张数计费、叠加包和一个产品授予多个独立组属于后续产品及账务功能。
- 独立批量生图后端仍为余额链路，新设备模式明确拒绝该接口；普通旧链路保持兼容，不能宣传批量生图可消费订阅。
- 浏览器、远程和旧 gateway 保留现有短租约。长期父 Key 不发送到远端；新远程委托在本地获准发布并稳定完整周期后推进。
- 密码修改是否级联撤销设备身份仍是待决定的产品规则，本批没有擅自实施。
- 55 秒是实现中的身份权威年龄上限和待验收撤销目标。本次单机隔离验证不能证明多实例传播 SLA、生产容量或连续运行 24 小时的实测结果。
- 发布前需通过既有迁移流程应用 migration 253，核对混合版本能力协商，再做指定账户/设备灰度、真实桌面启动验收、多实例撤销与负载测试。不得通过回滚余额或删除历史用量回退协议。
- 桌面依赖在新工作树单独安装；原目录及其依赖未被覆盖。两个原 API 文案修改与本批网站修改路径相同，未来整合需人工解决文案冲突，保留长期/临时授权区分。

## 工作树

- Aino：`/Users/zizimutou/.codex/worktrees/account-device-key/Aino`，分支 `codex/account-device-key`，基于 `beb7e58e2d` 的既有桌面集成链。
- Aino-API：`/Users/zizimutou/.codex/worktrees/account-device-key-api/Aino-API`，分支 `codex/account-device-key-api`，基于凭证整理提交 `ac3f42265`。
- 原 `/Users/zizimutou/Protect/Aino` 与旧 API hygiene 工作树中的未提交内容保持原位。本批没有把其他工作树内容整体搬入或清理。
