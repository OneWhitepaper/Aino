<p align="center">
  <img src="assets/aino-banner.svg" alt="Aino" width="100%">
</p>

# Aino

Aino is an AI workspace for conversations, local projects and agent collaboration. It combines a desktop interface, configurable models, tools, skills and delegated tasks using the existing Hermes Agent runtime.

[Website](https://petoi.cn/) · [Download](https://petoi.cn/download.html) · [Getting started](https://petoi.cn/guide.html) · [Releases](https://github.com/OneWhitepaper/Aino/releases) · [Report an issue](https://github.com/OneWhitepaper/Aino/issues)

[简体中文](README.zh-CN.md) · [Español](README.es.md) · [اردو](README.ur-pk.md)

## Install Aino

1. Open the [Aino download page](https://petoi.cn/download.html).
2. Choose an available installer for your operating system and processor architecture. Follow that release's installation instructions.
3. Open Aino, complete the sign-in or model configuration offered by your version, and start a conversation.

The download page is the authority for available packages. This repository also contains source and runtime components; an upstream Hermes installer is not an Aino installer.

## Work with Aino

- **Conversations and projects:** chat directly, or open/create a local project folder and work in that folder. An empty folder is a valid project.
- **Models:** choose from the models available to your account or configure a supported provider/custom endpoint. Actual availability, context limits and pricing come from the selected service.
- **Agent collaboration:** delegate work through the existing runtime, follow child progress and receive results in the parent conversation.
- **Tools and extensions:** use the existing terminal, browser, files, skills, plugins and scheduled-task capabilities.
- **Local and remote connections:** use the existing gateway and connection settings. Remote work runs on the connected host.

See the [getting-started guide](https://petoi.cn/guide.html) and [account/model/wallet guide](docs/aino-platform-user-guide.md) for the relevant flows. Advanced configuration and capability availability depend on the runtime and services actually configured.

## Updates and feedback

Use Settings → About for the installed application's update status. Aino's [release history](https://github.com/OneWhitepaper/Aino/releases) describes published packages; the [main branch](https://github.com/OneWhitepaper/Aino/tree/main) can include changes that have not yet been released.

For product problems, open an [Aino issue](https://github.com/OneWhitepaper/Aino/issues) with your application version, system, steps and relevant redacted error details. The existing optional “Send diagnostics to Nous” action is a separate third-party upload: its consent dialog identifies the recipient and access rules. An Aino issue does not give Aino maintainers access to a Nous-private bundle.

## Build and contribute

```bash
git clone https://github.com/OneWhitepaper/Aino.git
cd Aino
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) for environment setup and checks, and [Desktop building](apps/desktop/BUILDING.md) for native packaging. Select an isolated `HERMES_HOME` and `HERMES_RUNTIME_DIR` before activating the development environment.

The runtime's command remains `hermes`; examples such as `hermes model`, `hermes setup` and `hermes desktop` are compatibility interfaces, not another product to install. The desktop defaults to Aino's data location, while explicit homes and supported legacy runtime discovery retain their documented behavior. See [the brand and compatibility boundary](docs/aino-brand-boundary.md).

Detailed runtime references live in this fork's [manual](website/docs/getting-started/quickstart.md), [configuration guide](website/docs/user-guide/configuration.md), [provider guide](website/docs/integrations/providers.md) and [developer architecture](website/docs/developer-guide/architecture.md). These inherited references can retain Hermes command, module and API names. They are not instructions to replace Aino with the upstream distribution.

## Open source and attribution

This repository remains public. Aino is an independent product based on [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research. Original copyright and contributor attribution remain in [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Third-party providers, libraries and hosted services retain their own names, licenses and terms.
