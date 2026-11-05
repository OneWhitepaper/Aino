# Aino 桌面设备授权 Key 方案（长期 API Key，手动撤销）

日期：2026-11-04
状态：方案草案 v2，待评审。本方案替代
`~/.codex/worktrees/aino-upstream-v0224/Aino/docs/aino-platform/account-direct-model-access-proposal.md`
里的设备授权/凭证生命周期部分；其中"批次 0 客户端减负"仍然有效并作为本方案的前置步骤。

## v2 修订（2026-11-04 用户确认）

1. **按（账户, 设备, 计费分组）管理，不按用途拆分**：文本与生图属于同一计费分组时共用一把设备 Key；生图权限仍由分组的生图能力控制，不为"用途"强制拆成两把。
2. **永久只等于"不自动过期"**：账号被禁用、余额不足、订阅到期（仅订阅型分组）、分组/模型权限被收回时，服务端仍会在请求时拒绝调用，与网站行为一致。
3. **撤销后不得静默重建**：客户端收到"已撤销/401"时清除本地 Key 并回到登录，只有登录成功或用户显式"重新授权"才允许创建新 Key；服务端撤销设备时同时吊销该设备对应的登录会话族，从根上避免"撤销后又偷偷生成"。
4. **取消定时续期**：桌面端只在登录/换模型时 provisioning，之后所有会话复用；gateway 契约需支持"无到期绑定"，并取消到期硬中断在途回合。

> 边界提醒：Aino 桌面自有模型目录（`desktop.models`）下架的模型，现有实现依赖每个请求的完整桌面复核才会拒绝。设备 Key 方案把复核精简为轻量检查后，必须保留一个 10–30 秒缓存的目录版本/开关校验；否则可能出现"分组白名单仍允许、但 Aino 目录已下架"的模型继续可用（见 §5.6）。

## 1. 一句话

**桌面就是 Aino-API 的官方第三方客户端：登录后由客户端自动申请一把长期有效的"设备授权 Key"（API Key），此后所有聊天、窗口、项目复用它调用 Aino-API 模型网关；除非用户在网站或桌面主动撤销/删除，否则一直可用。** 计费、余额、订阅、倍率、用量记录全部沿用现有 API Key 链路，不做任何账本结构改造。

## 2. 产品语义

1. 登录 Aino 账号（手机号/邮箱，现有流程）后即可使用平台模型，用户不配置 API 地址和 Key。
2. 网站与桌面使用同一个 `users.id` 钱包、订阅、倍率、订单、用量记录；余额不足、订阅到期、额度耗尽的行为与网站完全一致。
3. 凭证由客户端在登录后自动 provisioning，用户不可见；用户管理入口是「设置 → 我的账户 → 设备」：查看设备、最近使用时间、撤销设备。
4. 同一设备、同一计费分组的所有聊天共用一把 Key，不随新建会话、重启软件或发送消息重新生成；文本与生图同分组时共用同一把。
5. 凭证长期有效，没有到期/续期/每聊天签发。撤销后新请求立即拒绝（受现有鉴权缓存失效窗口约束，见 §5），且客户端不得静默重建。
6. 自定义模型（BYOK）路径完全不变，不因本方案改变。
7. 旧版桌面继续走现有短期 lease 路径；新版按能力协商切换，互不破坏。

## 3. 范围与非目标

**做**

- 设备级长期 Key 的签发、复用、撤销。
- 按 `(账户, 设备, 计费分组)` 维度管理，通常每设备 1–2 把；文本与生图同分组时共用一把。
- 桌面主进程安全存储、会话绑定复用、异常/撤销恢复。
- gateway 支持"无到期时间"的托管绑定，去掉到期硬中断。
- 按设备的用量归因与设备管理页。

**不做（v1）**

- 单把 Key 跨计费分组（见 §12 开放问题；v1 保持分组维度）。
- 远程/SSH/云连接上的托管模型（继续旧 lease 或后续做连接级委托）。
- 短期推理令牌/OAuth 令牌交换（未来可作为安全增强，不阻塞本方案）。
- 计费账本、`usage_logs` 表结构重构。
- 用户在网站上手动生成/复制设备 Key 的流程（Key 由客户端自动申请）。

## 4. 现状依据（为什么这个方案改动小）

| 现状 | 依据 |
| --- | --- |
| API Key 原生支持永久（`expires_at = NULL` 表示永不过期） | Aino-API `ent/schema/api_key.go`（`expires_at` Optional/Nillable，注释 "null = never expires"） |
| 现有托管凭证是短期 lease，且 scope 绑到聊天/登录族 | `ent/schema/desktop_model_credential.go`；`service/desktop_credential.go`（`expires = min(now+ttl, family deadline)`） |
| 每次发送都重新申请凭据 | Aino `src/api/platform-session-binding.ts`（`prompt.submit` 无条件 bind）；`shared/platform-runtime-binding.ts`（每次 claim + `POST /desktop/credentials` + bind） |
| 续期定时器跟着每个聊天/用途，`min(20min, ttl/3)` | `shared/platform-runtime-binding.ts` |
| gateway 要求绑定剩余有效期 ≤3605s，到期硬中断在途回合 | `tui_gateway/managed_model_runtime.py`（`managed_binding_expired`、`_expire → _interrupt`） |
| 撤销已经能把 backing Key 置 disabled 并由 DB 触发器失效缓存 | `repository/desktop_credential_repo.go`（`revoke()` 同时 `SetStatus(disabled)`）；`migrations/184_auth_cache_invalidation_outbox.sql` |
| 桌面已有 safeStorage 加密存储设施可复用 | `electron/platform-token-store.ts`、`electron/hardening.ts` |
| 模型目录桌面侧完全没有缓存 | `src/store/platform-models.ts`（只有并发合并，无 ready/TTL 短路） |
| `usage_logs.api_key_id` 是必填外键 | `ent/schema/usage_log.go`；`migrations/001_init.sql` |
| 桌面 key 不参与普通密钥列表更新 | `APIKeyService.Update` 对 `desktop_managed` 直接拒绝 |

结论：不需要新鉴权体系、不需要新缓存/投影、不需要改计费；只需要一条新的"设备 Key 签发/撤销"路径 + 桌面复用 + gateway 放宽到期契约。

## 5. 目标架构

```text
[Aino Desktop / Electron main]                          [Aino-API]
 登录成功（已有 JWT access + refresh family）
   │ POST /api/v1/desktop/device-keys
   │   { device_id, model_id }
   │        ───────────────────────────────────────▶ ① JWT 认证（现有中间件）
   │                                                 ② ResolveForUser(model) 解析计费分组
   │                                                 ③ 按 (user, device, group) 签发/复用
   │                                                    desktop_device_keys + api_keys(永不过期)
   │  ◀── { device_key_id, api_key, group_ref, model:{...}, expires_at: null }
   │
   │ safeStorage 加密保存（仅主进程；不落 renderer/日志/诊断包）
   │ 发起会话时把 Key + 模型元数据交给本地 gateway（私有桥接，内存）
   ▼
[Python gateway]  session.bind_managed_model（expires_at 缺省 = 不过期）
   │ POST /v1/chat/completions   Authorization: Bearer <设备 Key>
   ▼
[Aino-API /v1 中间件]  现有 API Key 鉴权路径（命中快照缓存 0 SQL）
   → 精简后的 desktop 复核（Key 状态/设备 Key 未撤销/目录版本/端点白名单）
   → 现有模型白名单/路由/余额/订阅/限流/扣费/usage_logs（全部不变）
```

### 5.1 数据模型（Aino-API，新增表 + 复用 api_keys）

新增表 `desktop_device_keys`（不改旧 `desktop_model_credentials`，旧客户端继续用旧路径）：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 账户 |
| `device_id` | 桌面安装 UUID（现有 `desktopInstallationId`） |
| `group_id` | 计费分组（由服务端按模型解析，客户端不可指定） |
| `api_key_id` | 指向 `api_keys`，唯一；Key 永久有效、`desktop_managed=true` |
| `created_at` / `updated_at` | 时间 |
| `revoked_at` / `revoke_reason` | 撤销状态 |
| `last_issued_at` | 最近一次签发/复用时间（用于设备页展示与统计） |

- 唯一约束：`(user_id, device_id, group_id) WHERE revoked_at IS NULL`。
- `api_keys` 行：`desktop_managed=true`、`expires_at=NULL`、`name='Aino 桌面 · <device label> · <group label>'`、`key` 为随机高熵字符串（沿用现有 Key 生成与存储方式）。
- 撤销时：`desktop_device_keys.revoked_at` + `api_keys.status=disabled` 同事务；`api_keys` 触发器自动写 outbox 失效缓存。

### 5.2 签发/复用接口

`POST /api/v1/desktop/device-keys`（JWT + 现有 panel rate limit + 桌面用户模式守卫）

请求：`{ device_id: UUID, model_id: string }`

处理：

1. 校验登录态与账户状态（现有 JWT 中间件）。
2. `DesktopModelService.ResolveForUser(user_id, model_id)` 解析模型 → 分组、平台、api_mode、capabilities、context_window；结果加 **60 秒进程内缓存**（`(user_id, catalog_version)`），因为签发只在登录/换模型时发生。
3. 按 `(user, device, group)` 查找未撤销行：
   - 存在 → 复用，返回同一把 Key（返回明文仅用于客户端绑定；Key 不提供给普通列表接口）。
   - 不存在 → 事务内创建 `desktop_device_keys` + `api_keys`（永不过期）。
4. 返回：`{ device_key_id, api_key, group_ref, expires_at: null, model: {id, model, api_mode, capabilities, context_window, ...} }`。`group_ref` 为不透明标识（便于日志/缓存键，不暴露内部 group id 语义）。

并发/幂等：唯一约束 + upsert 语义，重复请求幂等返回同一把 Key；不需要客户端幂等键。**只有登录态有效时该接口才可用**；已撤销的设备 Key 不会被复用，需要重新登录后再创建新 Key。

### 5.3 撤销接口

- `DELETE /api/v1/desktop/devices/{device_id}`：现有接口，保留 TOTP/最近手机验证；**新增同时撤销该设备的全部 `desktop_device_keys`**（旧 lease 撤销逻辑保留），并保留现有吊销登录会话族的行为。撤销后桌面被登出，因此不会出现"检测到撤销又静默重建"。
- `DELETE /api/v1/desktop/device-keys/{id}`：单把撤销（按分组），用于设备页细化管理或轮换。
- 网站"设备"页：合并展示设备（旧 lease + 设备 Key），可撤销；Key 明文永不出现在任何页面。
- **撤销后不得自动重建**：客户端在 `DESKTOP_CREDENTIAL_REVOKED` / 401 时清除本地 Key 并回到登录，不得静默重新 provisioning；只有登录成功或用户显式"重新授权"才允许创建新 Key。
- 撤销在途请求：已接受的请求按原规则完成结算，不重放；只拒绝后续请求（与现有计费合同一致）。

### 5.4 桌面端设计

**主进程（Electron）**

- 新增 `DeviceKeyStore`：safeStorage 加密文件，按 `account_id → device_id → (group_ref|model) → { api_key, model metadata, device_key_id }` 保存；复用 `platform-token-store` 的加密/原子写模式。未开启"记住登录"时只在内存保存，重启后重新 provisioning（服务端复用同一行，不产生新 Key）。
- 触发时机：**只允许两个入口**——登录成功、用户显式"重新授权/换模型到新分组"。发送消息、重启、新建会话都不触发 provisioning。单飞（singleflight），失败不阻塞普通文字对话（可降级提示）。
- 会话绑定：建会话/换模型时把缓存的 Key 与模型元数据交给 gateway；**发送消息时不再申请、不续期、不重新绑定**。多窗口、多会话共享同一把 Key。
- 生图：与文本同组时共用同一把 Key，生图绑定只做模型/参数绑定，不再申请第二份凭据；不同组时按分组各自一把。
- 退出登录：先调用撤销接口（best-effort），再清本地 Key 与登录态；离线失败时本地清除并记录待撤销项，下次启动补撤销，同时提示可在网站设备页确认。切换账户：清空当前账户 Key，按新账户重新 provisioning。
- 撤销/失效恢复：`DESKTOP_CREDENTIAL_REVOKED` / 401 → 清缓存、回登录（不自动重建）；网络错误/5xx → 有界退避重试，不创建新 Key。
- 明文边界：Key 只在主进程内存与加密文件；不进 renderer、不写普通日志、不进入诊断包（必要时替换为 `key_id`）；发送前只经现有私有桥接交给本地 gateway。
- 目录缓存：`platform-models.ts` 增加 `ready + 短 TTL（30–60s）+ 账户/站点变化失效` 短路，并合并并发加载。

**gateway（`tui_gateway`）**

- `session.bind_managed_model` / `session.renew_managed_model` 载荷允许 `expires_at` 缺省/`null`：表示"设备 Key，无到期"。
- 能力协商：`session.claim_managed_model` 增加能力位（如 `managed_device_key: 1` / `managed_model_binding` 版本升级）；旧 gateway 不返回该能力时，新桌面回退旧 lease 路径。
- 无到期绑定不启动到期 timer、不 `_interrupt` 在途回合；会话关闭、撤销、切换模型时清理绑定。旧 lease 路径保持现有行为。
- 远端连接：设备 Key 不交给远端 gateway；远端保持旧 lease 路径（或后续连接级委托）。

### 5.5 服务端鉴权路径（精简，不改热路径管线）

- 设备 Key 是普通 `api_keys` 行，`/v1` 鉴权复用现有 API Key 快照缓存（命中 0 SQL、L1 15s/L2 300s、现有失效链路）。
- `enforceDesktopCredential` 对设备 Key 精简为：
  1. 端点白名单（推理 / 模型 / 用量读 / 生图端点；生图权限仍由分组的生图能力控制）；
  2. `desktop_device_keys` 未撤销（按 `api_key_id` 走现有快照或 1 次主键查询）；
  3. 桌面功能开关 `desktop.enabled` + 桌面目录版本（10–30s 缓存，见 §5.6）；
  4. 分组/模型白名单由下游现有 `GroupModelAllowlist` 中间件继续强制。
- 因此每请求新增成本从当前 9/11 SQL 降到 ~0–1 SQL；余额/订阅/限流/计费链不变。
- 旧 lease 路径保持现有完整复核逻辑，直到旧客户端退役。

### 5.6 永久 Key 的权限边界（与用户确认的语义对齐）

- 账号被禁用 / 删除：现有用户状态检查在鉴权阶段拒绝。
- 余额不足、额度耗尽、并发/限流：现有计费链每请求检查，与网站一致。
- 订阅到期：只影响订阅型分组；普通分组不受影响（与网站现有行为一致）。
- 分组/模型权限被收回：现有 `GroupModelAllowlist` 每请求强制，Key 无需重建。
- Aino 桌面目录下架/映射变化：需要轻量目录版本检查（10–30s 缓存 + 变更失效），不能仅靠"Key 永久"放行；否则旧目录里的模型会在分组仍允许时继续可用。
- 改密码 / 全设备退出：建议默认撤销全部设备 Key（可配置），避免长期 Key 脱离登录态。
- 账户封禁：现有检查拒绝；可选同步撤销设备 Key。

## 6. 安全设计

**威胁模型**：设备 Key 是长期 bearer。主要风险是本地文件/备份/同步/恶意软件/日志/诊断包泄露后可持续消费，直到用户撤销。

**控制**

- 仅主进程持有，safeStorage 加密；renderer/插件/终端工具无法直接读取；诊断包与日志强制脱敏（加自动化测试）。
- 撤销入口：网站设备页 + 桌面退出登录/设备管理；撤销走现有 Key disable + DB 触发器，正常 ≤16.5s 收敛，outbox 兜底。
- 设备页展示：设备名、创建时间、最近使用、Key 分组；异常提示（如新设备、用量突增）。
- 可选风控（建议默认开启，阈值可配）：每设备速率/消费上限、长期未使用自动过期（如 180 天）、`password change` 时撤销全部设备 Key、支持手动轮换。
- 远程隔离：Key 只交给本地 gateway；远程连接不获得设备 Key。
- 与旧模型对比：旧模型 1h 凭证泄漏窗口小，但生命周期复杂、到期会硬中断；新模型泄漏窗口大，但有 revoke/安全存储/审计。残余风险需产品明确接受（记录在案）。

## 7. 生命周期策略（建议默认，待拍板）

| 场景 | 建议行为 |
| --- | --- |
| 桌面显式"退出登录" | 撤销本设备全部设备 Key（best-effort），清本地；离线时记录待撤销，下次启动补撤销 |
| 关闭窗口 / 退出应用（未退出登录） | 不撤销；Key 保留，重启直接复用 |
| 取消"记住登录" | 本地不持久化 Key；服务端 Key 保留，下次登录复用同一行 |
| 切换账户 | 清空当前账户 Key；新账户独立 provisioning |
| 网站撤销设备 | 撤销该设备全部设备 Key + 登录会话族；桌面被登出，不自动重建 |
| 改密码 / 全设备退出 | 建议默认撤销全部设备 Key（可配置） |
| 账号封禁/删除 | 现有用户状态检查拒绝请求；可选同步撤销 |
| 长期未使用 | 建议 180 天自动过期（可配置/可关闭） |
| 手动轮换 | 设备页提供"轮换"：签发新 Key → 新绑定生效 → 旧 Key 延迟撤销 |

## 8. 计费、报表与数据

- `usage_logs` 结构不变：`user_id`、`api_key_id`（设备 Key）、`group_id`/订阅/倍率仍按现有逻辑落账；网站与桌面费用完全一致。
- 报表：按 Key 聚合会看到"设备授权 · MacBook · 默认分组"这样的名字，属正常；建议在用户侧密钥列表隐藏设备 Key，只在设备页展示；后台/报表可按 `desktop_managed` 类型区分。
- 历史数据：旧 lease/Key 保留；新方案不迁移、不改写历史。
- 可选增量：`usage_logs` 增加可空 `desktop_device_id` 便于按设备筛选（若设备页/报表需要，再加）。

## 9. 实施批次与文件级落点

### 批次 0：客户端减负（不依赖新协议，先做，1–2 天）

- `src/api/platform-session-binding.ts`：有效 binding 且剩余 >2 分钟时直接复用，跳过 `claim + lease + bind`；保留账户/归属守卫。
- `src/api/platform-session-binding.ts`：新建会话草稿已绑定后，首条 `prompt.submit` 不再重复绑定。
- `src/api/platform-image-session-binding.ts`：明确禁用生图时跳过；已启用时保留首次准备（懒授权放后续）。
- `src/store/platform-models.ts`：`ready` + 短 TTL + 账户变化失效短线；并发合并保留。
- `shared/platform-runtime-binding.ts`：续期加 jitter（旧路径过渡期）。
- 验收：连续 100 条消息凭据申请次数从每回合 1–2 次降到 0（有效期内）；新会话不再双申请。

### 批次 1：Aino-API 设备 Key（3–4 天）

- migration：新增 `desktop_device_keys`（唯一部分索引、FK、撤销字段）。
- `internal/service/desktop_device_key.go`（新）：签发/复用/撤销；`ResolveForUser` 结果 60s 缓存。
- `internal/handler/desktop_handler.go`、`internal/server/routes/desktop.go`：新端点 + 撤销扩展。
- `internal/server/middleware/desktop_credential_auth.go`：设备 Key 分支（端点白名单、撤销、目录版本、功能开关、轻量检查）；旧 lease 分支保留。
- `internal/service/api_key_service.go`：设备 Key 的创建/撤销复用现有 Key 服务与失效入口；`Update` 对 `desktop_managed` 保持拒绝。
- 测试：签发幂等、唯一约束、并发 provisioning、撤销后 401 且不自动重建、分组解析、旧客户端兼容、缓存失效。

### 批次 2：gateway 无到期绑定（2–3 天）

- `tui_gateway/managed_model_runtime.py`：`expires_at` 可缺省；能力位；无 timer/无硬中断。
- `gateway/session_platform_model.py`：`session.*_managed_model` RPC 契约与能力协商。
- `tests/tui_gateway/`：无到期绑定、撤销、会话关闭、旧 lease 兼容回归。

### 批次 3：桌面接入（3–4 天）

- `electron/device-key-store.ts`（新）+ `electron/main.ts`：provisioning、复用、退出/切账号清理、撤销/401 恢复（不自动重建）。
- `shared/platform-runtime-binding.ts`、`src/api/platform-models.ts`：绑定载荷、删除续期 timer、分组/模型缓存。
- `electron/platform-ipc.ts`、`src/store/*`：设备页数据、撤销入口、错误文案（撤销 → 重新授权，不泄露内部错误）。
- E2E：登录→首条消息→100 条消息→重启→撤销→不自动重建→重新登录授权→多窗口/多分组。

### 批次 4：灰度、验收与旧路径收敛（约 1 周）

- 按客户端版本/账户开关灰度；指标：provisioning 次数、Key 数、撤销收敛、401 率、鉴权 SQL、费用对账。
- 旧 `/desktop/credentials` 保留兼容；新客户端稳定后停止新建旧 lease，保留历史读取。

总工期：单人约 2.5–3 周（含测试与验收），不含发布流程。

## 10. 验收标准

| 场景 | 通过条件 |
| --- | --- |
| 连续发送 100 条消息 | 首次 provisioning 后 `/desktop/credentials` 与 `/desktop/device-keys` 均为 0 次；仅 1 把设备 Key；无续期请求 |
| 重启桌面 / 多窗口 | 复用同一把 Key；不新增 Key 行；多窗口共享 |
| 新建 100 个聊天 | Key 数不随聊天增长；不新增旧 lease |
| 文本 + 生图同分组 | 共用同一把 Key；生图不额外申请凭据；分组不同则各自一把 |
| 网站撤销设备 | 撤销后新请求在现有缓存收敛窗口内被拒（正常 ≤16.5s，outbox 兜底）；桌面被登出且**不自动重建 Key**；在途请求完成结算、不重放 |
| 桌面退出登录 | 本地 Key 清除、本设备 Key 撤销；再次登录重新授权；离线时下次启动补撤销 |
| 切换账户 | 账户间 Key/额度严格隔离，无串用 |
| 多设备 / 多分组 | 每设备每分组一把 Key；余额/订阅/限流共享；撤销一台不影响其他设备 |
| 权限边界 | 账号禁用、余额不足、订阅到期（订阅组）、模型下架均被拒绝；Aino 目录下架不被旧目录绕过 |
| 账单一致性 | 新旧路径同脚本对账：余额、订阅、倍率、费用、usage_logs 完全一致；重复扣费 0 |
| 安全边界 | Key 不出现在 renderer/日志/诊断包；不能用于非推理端点；旧版桌面不受影响 |
| 功能回归 | 流式、停止、工具、子任务、压缩、生图/改图、BYOK、远程连接逐项通过 |

## 11. 风险与回滚

- 风险：长期 Key 泄露（见 §6 控制）；每分组多 Key 的管理复杂度（设备页聚合展示）；旧 gateway/旧桌面兼容（能力协商 + 保留旧路径）；撤销传播窗口（沿用现有缓存 SLA 与 outbox）；桌面目录下架需要轻量版本校验（见 §5.6）。
- 回滚：能力位/服务端开关切回旧 lease 路径；新表与新 Key 保留不影响旧路径；不删历史、不回滚账本；桌面降级后重新走 `/desktop/credentials`。
- 发布：本方案不自动发布；正式发版等待明确指令。

## 12. 需要拍板的问题

1. 退出登录是否立即撤销设备 Key（建议：是；离线时记录待撤销、下次启动补撤销）。
2. 长期未使用是否自动过期（建议 180 天，可配；若产品坚持"除非手动撤销否则一直可用"，可关闭）。
3. 改密码是否撤销全部设备 Key（建议默认是，可配置）。
4. 设备 Key 是否完全从用户密钥列表隐藏、只在设备页管理（建议是）。
5. 是否提供手动轮换入口（建议提供，成本低）。
6. 远程连接托管模型是否 v1 不做（建议 v1 不做）。
7. 单 Key 跨计费分组是否列入后续（v1 不做；若要做，需要服务端按模型解析分组）。
