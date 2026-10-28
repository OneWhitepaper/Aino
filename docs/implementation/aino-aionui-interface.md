# Aino 全界面风格统一实施计划

日期：2026-10-28。工作分支：`codex/aino-aionui-interface`。
改造前基线：`29c12cc637a4546ba13f420294ab61565b9e25e1`（已推送到 `codex/aino-ui-baseline`）。

## 已确认目标

将已确认的 AionUi 风格效果稿落地到 Aino 全部自有界面：侧栏、首页、会话、文件工作台、管理页、设置、引导、弹窗、菜单、提示及加载/空/错误/成功状态。保留 Aino 品牌和完整现有功能；设计稿未展示的功能依然必须可用。

视觉依据位于本机独立设计目录：
`/Users/zizimutou/.codex/visualizations/2026/10/28/aino-aionui-mockup/`。
`screenshots/01-home.png`、`03-files.png`、`07-skills.png`、`08-agents.png`、`09-messaging.png`、`10-settings.png` 及交互细节图构成已确认的视觉参考。

## 架构与边界

- 继续使用现有 React、Radix、Tailwind、nanostores、路由与 Electron 能力桥。不导入原型的状态、演示数据、图标依赖和后端架构。
- 配色、字号、圆角、边界和阴影在既有 `styles/aino-theme.css` 与主题 token 中统一，组件复用现有 Button、Tabs、Dialog、Popover、Menu、Tip、Loader、ErrorState 等。
- 标准图标仍使用现有 Tabler/Codicon；使用现有 Aino logo。不增加另一套图标系统。
- 所有行为继续读写原有状态和接口。保持个人会话/机器人/连接/项目的归属、草稿、队列、流式回复、审批、终端、远程能力、在线更新等。
- Agent Hub 管理卡片点击只查看详情；明确切换操作才切换工作区。聊天侧栏机器人入口保留既有规范会话行为。
- 文件预览、编辑、多标签、比较、终端和外部打开继续沿用现有实现。用户文件/代码/终端输出/第三方网页的内容不做全局强制样式覆盖。
- 透明度、字号、浅色/深色/系统、减少动态效果、键盘操作和高层级弹窗继续有效。不会为了截图覆盖用户偏好。
- 不更改模型、委派、提示词、上下文、权限、计费、统计授权或服务器接口，不调用付费模型做视觉验收。

## 批次与功能对应

| 批次 | 页面及提示 | 既有实现/复用位置 | 必须保留 |
| --- | --- | --- | --- |
| 0 | 改造前基线 | desktop vitest、typecheck、scripts/check | 基线结果与新增问题可区分 |
| 1 | 全局色彩/字体/控件、弹窗/菜单/提示/空错状态 | `styles/aino-theme.css`、`styles.css`、`components/ui/`、`components/page-loader.tsx` | 焦点、ARIA、Esc、portal 层级、语义颜色、主题和透明度 |
| 1 | 左侧栏、项目、最近会话、机器人入口 | `app/chat/sidebar/`、shell/sidebar 原语 | 搜索、筛选、拖动、归档、项目创建/打开、连接切换、未读/活动状态 |
| 1 | 首页、普通/项目/机器人对话、输入区 | `components/intro.tsx`、`components/assistant-ui/`、`app/chat/composer/` | 快捷任务、模型/推理档位、附件、语音、审批、队列、状态抽屉、字号 |
| 2 | 文件目录、预览、多标签、源码/预览/分屏、变更、浏览器、终端 | `app/chat/right-rail/`、`app/right-sidebar/`、既有 pane/editor 组件 | 文件作用域、保存、查找、复制、系统打开、下载、审批、远程路径 |
| 3 | 技能/插件/连接器/工具集 | `app/capabilities/`、既有插件页 | 安装/卸载/开关、筛选/搜索、来源、权限与说明、详情、分页 |
| 3 | Agent Hub、工作区、消息平台、计划任务、Webhooks、制品、星图 | `app/agents/`、`profiles/`、`messaging/`、`cron/`、`webhooks/`、`artifacts/`、`starmap/` | 全部动作、配置字段、审批、刷新、数据读取、保留滚动区域 |
| 3 | 设置全部分类及详情、账号、登录、更新、远程连接、引导/安装/启动故障 | `app/settings/`、`app/account/`、`components/onboarding/`、shell 和 boot 原语 | 所有设置和恢复入口，原有来源/权限/协议/凭据边界 |
| 4 | 辅助窗口、自有平台提示、窄窗、深浅主题 | Quick Entry/HUD/pet、通知与通用浮层 | 原生窗口行为、透明宿主、外部内容边界 |

## 执行与验证清单

- [x] 0. 修复后桌面完整回归：16,348 项通过、38 项跳过，作为本轮基线。
- [x] 1. 统一共享 token 和原语、主侧栏/首页/对话/输入区；保留所有既有事件与归属路由。
- [x] 2. 文件工作台自有 chrome 接入统一规范；实际验证目录、多标签、预览/源码、编辑保存、上下分屏及隐藏恢复。
- [x] 3. 管理页、设置、弹窗、提示、启动与辅助窗口接入同一规范；辅助原生窗口与生产服务的未手工覆盖部分列入验收边界。
- [x] 4. 各批次运行受影响回归，持续打开隔离开发桌面；保存实际截图并与已确认设计稿并排检查。
- [x] 5. 验证浅色、深色、跟随系统、901px 窄窗、长表单滚动、透明度、嵌套 Esc 及 UI 缩放恢复。
- [x] 6. 最终完整桌面回归 16,348 项通过；后续修整涉及的 1,300 项回归、类型检查、ESLint、构建及 `scripts/check --staged` 12 项检查通过。
- [x] 7. 验收记录见根目录 `design-qa.md`；保留基线分支与独立实施分支，等待用户查看开发版。
- [ ] 8. 用户确认界面后，对照当时最新 main 处理差异并通过 CI，再合并 main。

## 本轮实施记录

- 样式复用 `styles/aino-theme.css` 与既有组件；从 `styles.css` 提取现有会话样式为 `styles/aino-chat.css`，文件工作台自有外框样式归于 `styles/aino-workbench.css`。没有新增组件库、运行时依赖或业务状态机制。
- 侧栏导航及纯搜索映射从既有大组件提取为 `sidebar/navigation.tsx`、`sidebar/session-search.ts`，原回调和测试跟随移动。没有另建导航或搜索系统。
- 发现并修正 sidebar-only Glass 影响主内容及浮层不透明度的问题；whole-window Glass 保持原有行为。
- 真实 GUI 操作使用隔离测试资料、本地模拟推理与临时项目；无付费模型调用，没有更改日常账号资料或服务器配置。
- 截图、并排图和结果画廊位于 `/Users/zizimutou/.codex/visualizations/2026/10/28/aino-aionui-implementation/`。测试日志位于 `/var/folders/d8/tb_9ybdj5xzg_l5451f5209c0000gn/T/aino-aionui-implementation-jj16x2d1/`。

## 验收标准

1. 同类控件/层级/空错提示在不同页面使用相同视觉规范；不靠逐页散落的新颜色和字号拼接。
2. 已确认设计稿的核心布局/留白/导航/文件工作台关系落地；现有功能比设计稿多时，按同一规范兼容。
3. 所有现有路由、设置分类和恢复动作可到达，所有功能事件和原有能力桥继续使用。
4. 无全页横向溢出、不可滚动内容、浮层互相覆盖或不可见可点击控件；保留语义状态和键盘焦点。
5. 本地检查和回归通过，并提供真实开发桌面截图；不以效果稿演示代替产品验证。
