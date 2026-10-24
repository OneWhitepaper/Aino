<p align="center">
  <img src="assets/aino-banner.svg" alt="Aino" width="100%">
</p>

# Aino

Aino 是用于对话、本地项目和智能体协作的 AI 工作平台。在独立的桌面界面中提供模型配置、工具、技能和任务委派，底层继续复用 Hermes Agent 的运行能力。

[官网](https://petoi.cn/) · [下载 Aino](https://petoi.cn/download.html) · [使用指南](https://petoi.cn/guide.html) · [版本发布](https://github.com/OneWhitepaper/Aino/releases) · [问题反馈](https://github.com/OneWhitepaper/Aino/issues)

[English](README.md) · [Español](README.es.md) · [اردو](README.ur-pk.md)

## 安装 Aino

1. 打开 [Aino 下载页](https://petoi.cn/download.html)。
2. 按页面实际提供的安装包，选择你的操作系统和处理器架构，并阅读该版本的安装说明。
3. 安装并打开 Aino，完成当前版本提供的登录或模型配置，即可开始对话。

可下载的平台和版本以下载页为准。仓库同时包含源代码和底层运行组件；Hermes 上游的安装命令不等于安装 Aino。

## 开始使用

- **对话与项目**：直接发起会话，或打开、创建本地项目文件夹后在其中工作；空文件夹也可以作为项目。
- **模型配置**：使用账户实际可用的内置模型，或配置支持的服务商及自定义端点。可用性、上下文和费用以所选服务的实际配置为准。
- **智能体协作**：通过现有委派机制分配任务、查看子任务进度，并在主会话接收结果。
- **工具与扩展**：沿用终端、浏览器、文件、技能、插件和定时任务等现有能力。
- **本地与远程**：通过现有网关和连接设置选择执行位置；连接远程主机后，任务在对应主机执行。

具体操作见[使用指南](https://petoi.cn/guide.html)和[账户、模型与钱包指南](docs/aino-platform-user-guide.md)。高级功能是否可用取决于当前运行时和已经配置的服务。

## 更新与反馈

在“设置 → 关于”查看当前安装版本和更新状态。[Aino Releases](https://github.com/OneWhitepaper/Aino/releases)记录正式发布的安装包；[main 分支](https://github.com/OneWhitepaper/Aino/tree/main)可能包含尚未打包发布的改动。

产品问题请提交到 [Aino Issues](https://github.com/OneWhitepaper/Aino/issues)，附上应用版本、操作系统、复现步骤和必要的脱敏错误信息。现有的“向 Nous 发送诊断”属于单独的第三方上传，确认窗口会说明接收方和访问权限。提交 Aino Issue 不会让 Aino 维护者获得 Nous 私有诊断包的访问权限。

## 开发与贡献

```bash
git clone https://github.com/OneWhitepaper/Aino.git
cd Aino
```

开发环境与检查方法见 [CONTRIBUTING.md](CONTRIBUTING.md)，原生构建与打包见[桌面构建指南](apps/desktop/BUILDING.md)。激活开发环境前，先选择隔离的 `HERMES_HOME` 和 `HERMES_RUNTIME_DIR`。

底层命令仍使用 `hermes`，例如 `hermes model`、`hermes setup`、`hermes desktop`。这些是保留的兼容接口，不表示需要另装一套产品。桌面默认使用 Aino 的数据位置；显式配置的数据目录和支持的旧运行时发现逻辑保持原有行为。具体见[品牌与兼容边界](docs/aino-brand-boundary.md)。

详细技术资料位于本仓库的[配置指南](website/docs/user-guide/configuration.md)、[模型服务商指南](website/docs/integrations/providers.md)和[开发架构](website/docs/developer-guide/architecture.md)。继承的运行时文档仍可能使用 Hermes 的命令、模块或 API 名称，这不代表要求把 Aino 替换成上游发行版。

从其他智能体迁移时，复用官方 `agent-importers` 插件：先运行 `hermes plugins install agent-importers`，再用 `hermes import-agent <source> --dry-run` 预览。详见[迁移指南](website/docs/user-guide/import-from-other-agents.md)。

## 开源与来源

GitHub 仓库继续公开。Aino 是基于 Nous Research 的 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 开发的独立产品。原始版权、许可与贡献者署名保留在 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md) 中。第三方模型、依赖和托管服务保留其真实名称、许可及服务条款。
