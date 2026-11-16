---
title: "Aino 内置工作流技能"
description: "49 项技能的使用入口、来源和外部依赖"
---

# Aino 内置工作流技能

本组包含 49 项内置技能，复用 Aino 原有的技能加载、按需读取、斜杠命令和 Profile 同步机制。技能是工作方法与资源，不会替运行时凭空增加工具；浏览器、桌面操作、生图等仍使用 Aino 已有能力。

## 使用方式

在技能页面查找下面的 Aino 名称，或在支持技能命令的会话中输入 `/技能名`。也可以直接说“用 impeccable 检查这个页面”，由智能体按需读取。普通会话与 Bot 使用相同机制；每个 Bot 的修改、删除、禁用选择仍独立保留。

例如：

```text
/systematic-debugging 定位这个启动错误
/impeccable 检查当前页面的层级和交互
/documents 生成一份可编辑的 Word 报告
/control-in-app-browser 检查当前浏览器页面的表单
```

安装/升级时，当前 Profile 沿用原有同步；已存在 Bot 在桌面服务首次承载该 Profile 时补齐内置技能。显式退出内置分发的 Profile、已删除的技能及自定义内容按原有策略保留。更新不会重写既有会话的系统提示；使用新会话或现有受控刷新流程获取新的技能索引。

## 来源与能力边界

- **适配**：可再分发的 MIT/Apache-2.0 指南，保留许可证与署名，并改为 Aino 的真实工具接口。
- **原生**：Aino 独立实现的同类工作流。原 Codex 专属服务、受限资源与私有接口未被复制；不表示两者能力完全相同。
- **复用**：使用 Aino 已有对应技能，避免重复加载同名实现。

Figma 仍需授权的 MCP/API；CodeRabbit、Playwright、HyperFrames 需相应 CLI/运行环境；生图需配置可用服务。`chronicle` 能整理授权的当前屏幕与已有记录，**不提供后台屏幕历史录制**。Word、PowerPoint 和 PDF 复用随包分发的 Office/PDF 工具链，首次运行按现有 PM 机制准备文档环境；中文导出应选择已安装的中文字体并验图。

## 对应清单

macOS 专用的三项技能在 Windows/Linux 不会被当作可执行能力提供。表中的“条件”描述调用条件，不代表安装时自动下载所有外部软件。

| 原使用记录中的标识 | Aino 技能名 | 实现 | 条件 |
| --- | --- | --- | --- |
| `superpowers:systematic-debugging` | `systematic-debugging` | 复用 | Aino native tools |
| `superpowers:verification-before-completion` | `verification-before-completion` | 适配 | Aino native tools |
| `superpowers:test-driven-development` | `test-driven-development` | 复用 | Aino native tools |
| `build-web-apps:frontend-testing-debugging` | `frontend-testing-debugging` | 适配 | Project frontend test/browser toolchain |
| `superpowers:using-superpowers` | `using-superpowers` | 适配 | Aino native tools |
| `superpowers:brainstorming` | `brainstorming` | 适配 | Aino native tools |
| `playwright` | `playwright` | 适配 | Node.js/npm and installed Playwright CLI/browser |
| `impeccable` | `impeccable` | 适配 | Aino native tools |
| `superpowers:finishing-a-development-branch` | `finishing-a-development-branch` | 适配 | Git repository and project validation commands |
| `superpowers:executing-plans` | `executing-plans` | 适配 | Aino native tools |
| `build-web-apps:frontend-app-builder` | `frontend-app-builder` | 适配 | Project frontend toolchain |
| `superpowers:subagent-driven-development` | `subagent-driven-development` | 适配 | delegate_task when available; otherwise explicit sequential execution |
| `superpowers:requesting-code-review` | `requesting-code-review` | 复用 | Git repository; delegate_task for an independent reviewer when available |
| `superpowers:using-git-worktrees` | `using-git-worktrees` | 适配 | Git repository |
| `build-web-apps:react-best-practices` | `react-best-practices` | 适配 | React/Next.js project for code application |
| `product-design:index` | `product-design` | 原生 | Aino native tools |
| `superpowers:writing-plans` | `writing-plans` | 适配 | Aino native tools |
| `product-design:user-context` | `product-design-user-context` | 原生 | Aino native tools |
| `build-macos-apps:packaging-notarization` | `packaging-notarization` | 适配 | macOS; Xcode command-line tools; distribution identity/keychain profile for an authorized release |
| `visualize:visualize` | `visualize` | 原生 | Local HTML-capable preview for interactive artifacts |
| `product-design:image-to-code` | `product-design-image-to-code` | 原生 | Aino native tools |
| `superpowers:dispatching-parallel-agents` | `dispatching-parallel-agents` | 适配 | delegate_task when available |
| `superpowers:receiving-code-review` | `receiving-code-review` | 适配 | Aino native tools |
| `documents:documents` | `documents` | 原生 | PM documents environment; LibreOffice and installed CJK fonts for Chinese layout verification |
| `imagegen` | `imagegen` | 适配 | Configured image_generate provider |
| `openai-docs` | `openai-docs` | 适配 | Web search/extraction or official documentation MCP |
| `build-macos-apps:build-run-debug` | `build-run-debug` | 适配 | macOS; Xcode or Swift toolchain |
| `design-taste-frontend` | `design-taste-frontend` | 适配 | Aino native tools |
| `product-design:audit` | `product-design-audit` | 原生 | Aino native tools |
| `product-design:ideate` | `product-design-ideate` | 原生 | Aino native tools |
| `product-design:get-context` | `product-design-get-context` | 原生 | Aino native tools |
| `chronicle` | `chronicle` | 原生 | Authorized current screen observations or user-supplied records; no background screen history |
| `figma:figma-use` | `figma-use` | 原生 | Configured Figma MCP or authorized Figma API access |
| `product-design:design-qa` | `product-design-design-qa` | 原生 | Aino native tools |
| `figma:figma-design-to-code` | `figma-design-to-code` | 原生 | Configured Figma MCP/API or supplied design export; Project UI/browser tooling |
| `coderabbit:coderabbit-review` | `coderabbit-review` | 适配 | Installed CodeRabbit CLI; CodeRabbit authentication/service |
| `computer-use:computer-use` | `computer-use` | 复用 | Configured cua-driver computer_use backend and host permissions |
| `presentations:presentations` | `presentations` | 原生 | PM documents environment; LibreOffice/poppler and installed CJK fonts for Chinese slide verification |
| `browser:control-in-app-browser` | `control-in-app-browser` | 原生 | Aino desktop desktop_ui tools and selected tab |
| `openai-developers:openai-platform-api-key` | `openai-platform-api-key` | 原生 | User-owned provider/project credential destination |
| `build-macos-apps:signing-entitlements` | `signing-entitlements` | 适配 | macOS; Apple code-signing tools |
| `skill-creator` | `skill-creator` | 适配 | Aino native tools |
| `skill-installer` | `skill-installer` | 适配 | Aino native tools |
| `product-design:research` | `product-design-research` | 原生 | Aino native tools |
| `codex-security:security-scan` | `security-scan` | 原生 | Aino native tools |
| `hyperframes:hyperframes` | `hyperframes` | 适配 | Node.js 22+; Project-local HyperFrames CLI; FFmpeg; Supported rendering browser |
| `pdf:pdf` | `pdf` | 复用 | PM documents environment; OCR tools only for scanned inputs |
| `codex-security:triage-finding` | `triage-finding` | 原生 | Aino native tools |
| `product-design:url-to-code` | `product-design-url-to-code` | 原生 | Authorized source URL and web/browser observation tools |

许可证以每个技能包内的 `LICENSE` / 署名为准。仓库 `skills/aino-builtin-catalog.json` 是本组来源与依赖清单，不替代现有运行时注册或加载机制。
