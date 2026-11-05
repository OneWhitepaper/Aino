# Aino 桌面无绑定设备 Key 方案（一把 Key，套餐每次现算）

日期：2026-11-04
状态：方案草案 v3，待评审。
关系：本方案是 [desktop-device-key-plan.md](desktop-device-key-plan.md) 的下一版。v2 已确认的
"每设备一把永久 Key、取消续期、撤销不静默重建、自动管理"全部保留；**变化只有一处：Key 上不再绑定计费分组（套餐）**。
v2 中关于桌面安全存储、撤销语义、gateway 无到期绑定、批次 0 的内容继续有效。

## 1. 一句话

**每台设备只发一把 Key，Key 上不记录任何套餐/分组信息，它只回答"这个请求的主人是谁"。**
请求到达 Aino-API 时，服务端现场完成三步：验 Key → 得知账户；看请求的模型属于哪个套餐（计费分组）；
检查该账户当前是否有权限使用这个套餐 → 有则放行并按该套餐/余额扣费，没有则拒绝。
切换模型、跨套餐使用、订阅到期、套餐权限收回，都**不需要换 Key**。

## 2. 产品语义（与你的描述对齐）

一次模型调用的判定链：

```text
请求（model = gpt-x）
  → 验 Key：这是张三的设备 Key（账户 1001）
  → 模型解析：gpt-x 属于套餐 B（计费分组 B）
  → 权限检查：张三现在有套餐 B 的资格吗？
       ├─ 订阅型套餐 B：有有效订阅/额度 → 允许
       ├─ 标准套餐 B：账户可用余额 > 0 且分组允许 → 允许
       └─ 无资格 → 403（不扣费、不创建 Key、不要求用户改配置）
  → 放行：现有路由/渠道路由/余额或订阅扣费/用量记录（group_id = B）
```

对用户可见的效果：

- 登录后即可用；**所有设备只有一把 Key**，不需要按模型/套餐/生图分别管理。
- 换模型、换套餐、订阅到期/续费、管理员调整套餐权限，都不需要重新授权或换 Key。
- 文本与生图天然共用一把 Key；能不能用某能力取决于"该模型所属套餐 + 账户资格"。
- 撤销设备 = 这把 Key 失效；撤销后客户端不静默重建。

## 3. 与上一版（v2）的区别

| | v2：按分组建 Key | v3：无绑定 Key（本方案） |
| --- | --- | --- |
| Key 数量 | 每设备每分组一把（1–2 把） | **每设备固定 1 把** |
| Key 上绑定的信息 | `(user, device, group)` | 只有 `(user, device)`，无 group |
| 套餐选择 | 签发时由服务端解析并绑定 | **每次请求按模型现场解析** |
| 换模型/换套餐 | 可能需要再签发/切换 Key | 不需要，Key 不变 |
| 服务端新增 | 分组维度签发/撤销 | 请求内"模型→套餐→资格"解析器 + 缓存 |
| 热路径 | Key 自带 group，走现有管线 | 需多一步解析（缓存命中后可做到 0 SQL） |
| 复杂度 | 低 | 中（解析器 + 端点覆盖面 + 缓存失效） |

v2 的服务端改动更小；v3 的产品模型更干净（也是你想要的）。两者可以按阶段落地：
**先 v2 出货，再升级 v3**；v3 不需要迁移数据（Key 行不变，去掉 group 绑定即可）。

## 4. 现状依据（为什么可行、难点在哪）

| 现状 | 依据 | 对 v3 的影响 |
| --- | --- | --- |
| `api_keys.group_id` 本身可空 | `ent/schema/api_key.go`：`field.Int64("group_id").Optional().Nillable()` | 无绑定 Key 不需要新表结构，`group_id = NULL` 即可 |
| 无分组 Key 默认被部分协议拒绝 | `middleware/middleware.go:143` `RequireGroupAssignment` | 需要为无绑定 Key 增加"现场解析后视为已分组"分支 |
| 下游大量代码直接读 `apiKey.GroupID`/`apiKey.Group` | 例如 `gateway_service.ResolveChannelMappingAndRestrict(ctx, apiKey.GroupID, model)`、`gateway_handler.go` 的 `Models`、计费/路由 | **不需要改下游**：解析后把 group 填回上下文中的 Key 副本即可 |
| group 存在请求上下文 | `middleware/api_key_auth.go:392 setGroupContext` → `ctxkey.Group` | 解析中间件调用它，后续中间件与 handler 行为不变 |
| 每个请求的模型由各 handler 自行解析（body/path） | gateway 里大量 `requestedModel` 解析 | **v3 的主要新增工作**：在鉴权后、分组中间件前提取 model（表驱动） |
| 现有"用户可用模型/分组"解析逻辑已存在 | `DesktopModelService.resolveCatalog`：settings → user → available groups → subscriptions → group rates → 模型→分组 | 可抽取为通用 `UserPlanResolver`，桌面目录与 v3 共用；需加缓存 |
| 订阅/分组权限、计费、渠道路由已有现成服务 | `userSubRepo.GetActiveByUserIDAndGroupID`、`canUserBindGroup`、`GroupModelAllowlist`、billing/channel 服务 | 解析器只做"选套餐+资格判定"，扣费/路由复用现有管线 |
| Key 永久、撤销、缓存失效已就绪 | `expires_at=NULL`；`desktop_credential_repo.revoke()` 同时禁用 Key；migration 184 触发器 | v3 继续复用，无新增失效体系 |
| gateway 要求绑定剩余有效期 ≤3605s 且到期硬中断 | `tui_gateway/managed_model_runtime.py` | v3 仍必须改：允许无到期绑定、无 timer/无硬中断 |

## 5. 目标架构

```text
[Aino Desktop / Electron main]                     [Aino-API]
 登录成功
  │ POST /api/v1/desktop/device-keys { device_id }        （无模型、无分组参数）
  │        ─────────────────────────────────────▶ 创建/复用 (user, device) 一把 Key
  │  ◀── { device_key_id, api_key, expires_at: null }
  │ safeStorage 加密保存，仅主进程；之后所有会话复用
  ▼
[Python gateway] 绑定：Key + 模型元数据（来自 /desktop/models 目录）
  │ POST /v1/chat/completions { model: "gpt-x", ... }  Authorization: Bearer <设备 Key>
  ▼
[Aino-API /v1]
  apiKeyAuth（现有：验 Key → 账户；Key.group_id = NULL 属于"无绑定设备 Key"）
      │
      ▼  新增中间件 resolveUnboundPlan（在 groupModelAllowlist/compositeTarget/requireGroup* 之前）
  ① 按路由表提取 model（body/path；GET 类走专用分支）
  ② UserPlanResolver.resolve(user, model, purpose)：
       候选套餐 = 公共分组 ∪ 用户可绑分组 ∪ 有效订阅分组 ∪ 专属分配   （仅 active）
       过滤：该模型在分组白名单内、协议/平台匹配、账户资格有效
       排序：订阅套餐优先 → 专属/指定 → 公共/默认；同级按管理员配置优先级，再按价格配置
       结果：{group, subscription?, 依据} + 短 TTL 缓存
  ③ 命中：把 group 写回上下文 Key 副本 + setGroupContext（下游全部代码不变）
     失败：结构化 403（model_not_entitled / no_active_plan / model_unavailable）
      │
      ▼
  groupModelAllowlist → compositeTarget → 现有渠道路由/余额/订阅/限流/扣费/usage_logs
      （group_id = 现场解析出的套餐；client 不能指定 group/价格）
```

## 6. 服务端设计（Aino-API）

### 6.1 Key 与数据模型

新增表 `desktop_device_keys`（沿用 v2，去掉 group 维度）：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 账户 |
| `device_id` | 桌面安装 UUID |
| `api_key_id` | 指向 `api_keys`，唯一 |
| `created_at` / `updated_at` | 时间 |
| `revoked_at` / `revoke_reason` | 撤销状态 |
| `last_issued_at` | 最近签发/复用时间 |

- 唯一约束：`(user_id, device_id) WHERE revoked_at IS NULL`。
- `api_keys` 行：`group_id = NULL`、`desktop_managed = true`、`expires_at = NULL`、名称 `Aino 桌面 · <device label>`。
- **Key 上不落任何套餐、模型、用途信息**；所有权限在请求时判定。
- 撤销：`desktop_device_keys.revoked_at` + `api_keys.status=disabled` 同事务 + 吊销登录会话族。

### 6.2 签发/撤销接口

- `POST /api/v1/desktop/device-keys`：请求 `{ device_id }`，JWT 认证；按 `(user, device)` 幂等签发/复用。
  不需要 model，不需要分组，不需要目录解析 —— 登录后即可调用，一次网络往返。
- 返回 `{ device_key_id, api_key, expires_at: null }`。
- `DELETE /api/v1/desktop/devices/{device_id}`：撤销该设备 Key + 登录会话族（现有 TOTP/手机验证保留）。
- `DELETE /api/v1/desktop/device-keys/{id}`：单 Key 撤销/轮换。
- 客户端错误语义：`revoked/401` → 回登录、不自动重建；网络/5xx → 退避重试、不新建 Key。

### 6.3 请求内解析（本方案的核心）

**中间件位置**：`apiKeyAuth` 之后、`groupModelAllowlist` / `compositeTarget` / `requireGroup*` 之前
（当前注册顺序见 `server/routes/gateway.go`）。仅对"无绑定设备 Key"生效，普通分组 Key 完全走原路径。

**模型提取**：表驱动，按 `methon + route` 从 body/path 取 `model`（必要时缓冲 body 后恢复）。
v1 覆盖（桌面实际使用 + 主流协议）：

| 端点 | 模型位置 | 说明 |
| --- | --- | --- |
| `POST /v1/chat/completions` | body.model | 主路径 |
| `POST /v1/responses`、`/responses/*subpath` | body.model | 主路径 |
| `POST /v1/messages`、`/messages/count_tokens` | body.model | Anthropic 兼容 |
| `POST /v1/embeddings` | body.model | 文本 |
| `POST /v1/images/generations`、`/images/edits` | body.model | 生图 |
| `POST /v1/images/generations/async`、`/images/edits/async` | body.model | 异步任务需在创建时持久化解析结果 |
| `POST /v1/images/batches` | body.model | 批处理同理 |
| `POST /v1/alpha/search` | body.model | |
| `GET /v1/models`、`GET /v1/models/:model` | path/branch | 见 §6.5 |
| `GET /v1/usage`、`GET /v1/sub2api/billing` | 无 model | 见 §6.5 |
| WebSocket `/v1/responses` | 帧内 model | **v1 拒绝无绑定 Key**（桌面不使用；错误码明确） |
| 其余未知端点 | — | v1 拒绝无绑定 Key，返回 `unsupported_endpoint_for_device_key` |

**解析器 `UserPlanResolver`**（复用/抽取 `DesktopModelService.resolveCatalog` 逻辑）：

1. 候选套餐：用户可用的 active 分组 = 公共非专属分组 + `user_allowed_groups` 指定的专属分组 +
   有效订阅对应分组 + 其他现有分配关系；全部 active 且模型在分组白名单内。
2. 过滤：模型属于该分组、协议/平台匹配（chat/image/视频等能力）、分组可用、账户状态有效。
3. 排序（**产品需拍板**，建议默认）：有效订阅型分组优先（先消耗计划额度）→ 专属/指定分组 →
   公共/默认分组；同级按管理员配置优先级，再按价格低的优先。
4. 资格判定：订阅型分组要求有效订阅且额度未耗尽；标准分组要求余额 > 0；并发/限流沿用现有检查。
5. 返回 `{ group, subscription?, reason }`。

**缓存与失效**：

- 缓存键 `(user_id, model, purpose, catalog_version, subscription_version)`，TTL 30–60 秒；
  命中 0 SQL。冷路径复用现有仓储读取（~10 SQL/次），需要压测与预算。
- 失效复用现有机制：分组/模型/订阅/用户变更的缓存失效入口 + 版本号；
  桌面目录/后台配置变更已有 `desktop.*` 设置读取，可纳入版本。
- 解析结果不缓存余额/额度本身（余额与扣费仍每请求走现有计费链）。

**上下文填充（不改下游的关键）**：

- 复制上下文中的 `APIKey`，设置 `GroupID = 解析分组ID`、`Group = 解析分组`，
  写回 `ContextKeyAPIKey` + `setGroupContext` + 订阅上下文（如适用）。
- 之后 `groupModelAllowlist`、`compositeTarget`、handler、计费、usage 读取到的都是"已分组"的 Key，
  行为与普通分组 Key 完全一致 —— 这是把改动收敛在中间件层的原因。

### 6.4 计费、用量、权限边界

- 扣费复用现有链路：解析出的 `group` 决定价格/倍率/订阅/信道；`usage_logs.group_id` 记录实际消耗的套餐；
  `subscription_id` 按现有逻辑写入；`api_key_id` 是设备 Key。
- 同一请求只解析一次、只按一个套餐扣费；客户端传入的任何 group/价格/用户字段一律忽略。
- 权限变化即时生效：订阅到期、套餐权限收回、模型下架，下一次请求按新状态判定（缓存 TTL 内最多延迟 30–60s，
  可通过版本失效缩短）。
- 余额/订阅额度不足、并发限制：沿用现有计费合同；解析器在选套餐时做预判，最终以计费链为准。
- 计费失败/无资格的请求不产生用量、不扣费、不自动重试或切换套餐（除非现有产品规则明确允许 fallback）。

### 6.5 端点语义

| 端点 | 无绑定 Key 的行为 |
| --- | --- |
| 推理类（§6.3 表） | 解析 model → 选套餐 → 走完整管线 |
| `GET /v1/models` | 返回该账户**所有可用套餐模型的并集**（去重），不返回分组/内部价格明细 |
| `GET /v1/models/:model` | 解析该模型，有资格则返回，否则 404/403 结构化错误 |
| `GET /v1/usage` | 按账户维度返回（可跨套餐），不要求 group |
| `GET /v1/sub2api/billing` | v1 对无绑定 Key 返回 `400 model_required` 或按主套餐返回；建议前者，避免"默认套餐"歧义 |
| 异步生图/批处理 | 创建时解析并**持久化** group/subscription，后续状态查询无需再解析 |
| 视频/其他媒体 | 创建时有 model 则解析；查询类无 model，按任务已持久化信息处理 |
| WebSocket / 未知端点 | v1 拒绝（明确错误码），不做隐式猜测 |

### 6.6 热路径与可观测性

- 解析缓存命中：0 SQL（仅内存），失败时一次查询；加指标：命中率、解析耗时 P50/P95/P99、
  冷回源 SQL 次数、解析失败原因分布、每请求解析次数（应恒为 1）。
- 容量测试：分别测"缓存命中/冷缓存/同模型并发/多套餐账户/批量启动"，确认解析层不成为新瓶颈。
- 关键告警：解析失败率、缓存命中率骤降、解析耗时上升、同一请求多次解析。

## 7. 桌面端设计（比 v2 更简单）

- **每设备一把 Key**：登录成功后 `POST /desktop/device-keys {device_id}` 获取/复用；safeStorage 加密保存；
  只主进程持有；记住登录关闭时内存-only，下次登录再取回同一把（服务端幂等）。
- **不再有"按模型/分组/用途"的凭据申请**：切模型、切套餐、生图、子任务、压缩全部复用同一把 Key；
  会话绑定时从 `/desktop/models` 目录拿模型元数据（`api_mode/capabilities/context_window`）即可，
  不再需要 `/desktop/credentials` 的 lease 响应。
- **删除续期与按会话申请**：绑定只在建会话/换模型时做一次；token/Key 不过期，无 timer、无 mid-turn 硬中断。
- **错误处理**：
  - `model_not_entitled/no_active_plan` → 提示"当前套餐或额度不可用"，引导去账户/模型页；
  - `401 revoked` → 清 Key、回登录，不自动重建；
  - 网络/5xx → 退避重试，不新建 Key；
  - 解析失败不自动换套餐重试（避免隐式消费），除非产品明确允许。
- **目录缓存**：`platform-models.ts` 增加 ready + 30–60s TTL + 账户/站点失效；目录只用于展示与绑定元数据，
  不参与权限判定（权限以服务端每次解析为准）。
- **多账户/多设备**：Key 按账户隔离；每设备一把；切换账户清空并重新取。

## 8. gateway 设计

- 绑定载荷允许 `expires_at` 缺省/`null`（设备 Key，无到期）；无到期 timer、无硬中断。
- 能力协商：`session.claim_managed_model` 增加能力位（`managed_device_key` / binding 版本升级）；
  旧 gateway 不支持时，新桌面回退旧 lease 路径（兼容窗口）。
- 会话绑定只承载"模型/协议元数据 + Key"，不承载套餐；套餐由服务端解析。
- 远端连接不获得设备 Key（沿用 v2 结论）。

## 9. 兼容与迁移

- 普通分组 Key、旧桌面 lease 路径完全不变；v3 只新增"无绑定设备 Key"分支。
- 新桌面按能力协商切换 v3；旧桌面继续 v2/v1 路径。
- 不需要迁移历史数据；`desktop_model_credentials` 与旧 managed Key 保留。
- 回滚：服务端开关/客户端能力位切回旧路径；新 Key 与表保留不影响旧逻辑。

## 10. 安全

- Key 长期有效 + 无套餐信息：泄露后攻击者可消费**该账户有资格的任何套餐**，爆炸半径比 v2 按分组的 Key 略大；
  缓解：每设备一把、safeStorage、仅主进程、日志/诊断脱敏、设备页撤销、异常消费提醒、
  可选每设备速率/消费上限与 180 天未使用过期。
- 客户端只能提交模型名：套餐、价格、用户 ID 全部服务端决定，不能通过参数越权或选择更便宜的套餐。
- 无绑定 Key 只允许推理类端点（+ 只读模型/用量），不能用于账户管理/密钥管理等非推理接口。
- 撤销链路与 v2 相同：撤销设备 Key + 吊销登录会话族，客户端不静默重建。

## 11. 实施批次与文件落点

### 批次 0：客户端减负（1–2 天，不依赖 v3）

沿用 v2 批次 0：有效 binding 复用、新会话不重复绑定、生图明确禁用即跳过、目录 ready 短路、
旧路径续期 jitter。

### 批次 1：无绑定 Key 数据与签发（3–4 天）

- migration：`desktop_device_keys`（无 group、`(user, device)` 唯一部分索引）。
- `internal/service/desktop_device_key.go`：签发/复用/撤销。
- `internal/handler/desktop_handler.go`、`internal/server/routes/desktop.go`：新端点、设备撤销联动。
- 测试：幂等、并发、撤销、无 group Key 不被现有分组中间件误拒。

### 批次 2：解析器与请求内选套餐（1–1.5 周，核心）

- `internal/service/user_plan_resolver.go`（新）：抽取/复用 `DesktopModelService.resolveCatalog` 的候选分组、订阅、白名单、价格逻辑；缓存 + 版本失效。
- `internal/server/middleware/resolve_unbound_plan.go`（新）：模型提取表、上下文 Key 副本填充、错误码、指标。
- `internal/server/routes/gateway.go`：插入中间件顺序；无分组 Key 通过 `RequireGroupAssignment` 的 v3 分支。
- 端点矩阵（§6.3/6.5）：models/usage/billing/async/websocket 的专用处理。
- 测试：解析优先级、订阅/余额、权限收回、模型下架、多套餐同模型、客户端无法指定分组、缓存失效、多实例。

### 批次 3：桌面 + gateway 接入（4–5 天）

- 桌面：DeviceKeyStore（safeStorage）、单 Key provisioning、绑定用目录元数据、删除 per-model 申请与续期、错误恢复。
- gateway：无到期绑定 + 能力协商 + 无硬中断。
- E2E：登录→首条→100 条→切模型跨套餐→订阅到期→撤销→不自动重建→多窗口/多设备。

### 批次 4：灰度与旧路径收敛（约 1 周）

指标：解析命中率/耗时、每设备 Key 数（应为 1）、切套餐后 Key 数不变、各套餐扣费与网站对账一致、
撤销收敛、401 率、容量测试。

总工期：单人约 3.5–4.5 周（不含发版）；比 v2 多约 1–1.5 周，主要花在解析器与端点覆盖。

## 12. 验收标准

| 场景 | 通过条件 |
| --- | --- |
| 连续 100 条消息 | 首次签发后 0 次新 Key；每请求恰好 1 次解析；无续期 |
| 切换模型跨 2 个套餐 | Key 不变；每次按正确套餐扣费；usage_logs.group_id 正确 |
| 文本 + 生图 | 同一把 Key；按模型所属套餐计费 |
| 订阅套餐 vs 余额套餐 | 按约定优先级选套餐（如订阅优先）；订阅额度耗尽/到期后按新状态判定 |
| 套餐权限被收回 / 模型下架 | 下一请求按缓存 TTL 内拒绝，Key 不变，返回结构化错误 |
| 客户端伪造 | 指定 group/价格/用户 ID 均无效，不能越权或选低价套餐 |
| 模型列表 | `/v1/models` 返回可用套餐并集；单模型查询按资格返回 |
| 撤销/设备管理 | 撤销后缓存窗口内拒绝；不自动重建；其他设备不受影响 |
| 旧客户端/旧 Key | 普通分组 Key 行为完全不变；旧桌面 lease 路径可用 |
| 计费对账 | 与网站同模型同套餐扣费一致；重复扣费 0；失败请求不扣费 |
| 性能 | 解析缓存命中 0 SQL；冷路径 SQL 与 P99 在预算内；容量测试有结论 |
| 安全边界 | Key 无分组信息、不进 renderer/日志/诊断包；无绑定 Key 不能调管理类接口 |

## 13. 风险与开放问题（需要拍板）

1. **套餐优先级策略**：同模型在多个套餐可用时先扣哪个？建议默认"有效订阅套餐优先 → 专属/指定 → 公共/默认；
   同级按管理员优先级，再按价格低"；也可改为"账户显式选择的默认套餐优先"。这是产品决策，必须写进文档。
2. **同模型存在不同价格套餐**：允许用户自动享受更低价格，还是固定优先级（可能多花钱）？需要明确且可配置。
3. **订阅额度用尽但余额充足**：是否自动 fallback 到下一个可用套餐？建议允许（对用户更友好），
   但要保证不跨到无资格套餐，且每次 fallback 有明确记录。
4. **端点覆盖范围**：v1 是否只覆盖桌面用到的端点（chat/responses/messages/images/models/usage），
   其余对无绑定 Key 明确拒绝？建议是。
5. **异步媒体任务**：解析结果必须随任务持久化；需要确认现有 async image/batch/video 任务的落库字段。
6. **解析缓存失效链路**：分组/模型/订阅/目录变更的失效是否全覆盖、多实例收敛目标（建议 ≤30s）。
7. **无绑定 Key 是否只给桌面**：还是未来也开放给第三方客户端？建议先只给桌面（key type 限制 + 端点限制）。
8. **热路径预算**：解析层允许的额外 P99 与 SQL 上限（例如命中 0 SQL、冷路径 ≤10 SQL、P99 +5ms）。
