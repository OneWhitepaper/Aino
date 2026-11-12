# Aino local help routing

Read the bundled Aino product guide before answering an Aino usage question. This routing page
does not require network access and does not install a new tool, manager or service.

## Read the installed guide

- Product guide: `skill_view(name="hermes-agent", file_path="aino-docs/README.md")`.
- Complete handbook: `skill_view(name="hermes-agent", file_path="aino-docs/handbook/README.md")`.
- Chapter or template: append the selected relative filename below to `aino-docs/`.
  Resolve links from the current document's directory, retaining this prefix.

This uses the existing skill-reading channel on the runtime host. It also works when `terminal`
and `read_file` target SSH, Docker or another sandbox where the host's installation path is absent.
It does not grant those environments access to arbitrary host files. Do not use a remote shell
to resolve or read the host's installation directory.

For local source inspection, the source tree stores the guide at `docs/aino/README.md`; a
Python distribution stores it in `hermes_cli/data/aino-docs/README.md`. The host runtime resolves
its installed root with `hermes_cli.product_identity.LOCAL_DOCUMENTATION_PATH`.

The complete handbook is `handbook/README.md` under this installed documentation directory.
All original chapters and templates are available there; open `handbook/runtime-guide.md` for
the full original help body. All links inside the Aino guide are relative and work offline. A model catalog, account balance,
third-party login or server availability still requires the appropriate live service.

## Map the question

| User intent | Aino product guide | Complete local chapter (relative to the documentation directory) |
| --- | --- | --- |
| Start, sign in, first task | `getting-started.md` | `handbook/references/cli-reference.md` for CLI-only use |
| Isolation, re-login, device Key, subscription | `accounts-and-devices.md` | Verify native/API contract; old guide is not account authority |
| Ordinary/Bot/group, delegated tasks, capsule | `conversations-and-collaboration.md` | `handbook/references/background-systems.md` for runtime lifecycle |
| Built-in/provider/custom model, image editing | `models-and-images.md` | `handbook/references/providers-and-models.md`, `handbook/references/configuration.md` |
| File tabs, previews, summary, widgets | `files-and-panels.md` | `handbook/references/desktop-plugins.md` for extension SDK only |
| Settings and saved configuration | `settings.md` | `handbook/references/configuration.md`, `handbook/references/project-context-files.md` |
| MCP installation and authorization | `extensions-and-safety.md` | `handbook/references/native-mcp.md` |
| Plugins and skills | `extensions-and-safety.md` | `handbook/references/desktop-plugins.md`, `handbook/references/cli-reference.md` |
| Approval, secrets, external actions | `extensions-and-safety.md` | `handbook/references/security-privacy.md` |
| Cron, gateway, messaging | `scheduling-and-gateway.md` | `handbook/references/background-systems.md`, `handbook/references/webhooks.md` |
| Failure or recovery | `troubleshooting.md` | `handbook/references/troubleshooting.md`, `handbook/references/windows-quirks.md` |
| Old cached persona/prompt | `prompt-refresh.md` | Current `hermes sessions refresh-prompts --help` |
| Audit facts against source | `feature-map.md` | Exact named source file in the repository |

The product recovery guide is `troubleshooting.md`; the complete technical chapter is
`handbook/references/troubleshooting.md`. They have different roles. Resolve each relative to
`aino-docs/` rather than treating a matching basename as equivalent.

## Preserved technical references

The full original skill body is in `handbook/runtime-guide.md`; its source is retained in
this skill as `upstream-runtime-guide.md`. All nineteen original references and three templates
are included in the Aino handbook. The old installer, product description, default directories
and interface wording must not override the current Aino guide. Open the local chapters for
exact implementation protocols:

- `handbook/references/cli-reference.md`, `handbook/references/slash-commands.md`: actual `hermes` command families; verify current help.
- `handbook/references/native-mcp.md`: MCP transports, discovery, existing installation confirmation flow.
- `handbook/references/configuration.md`, `handbook/references/providers-and-models.md`: configuration and provider parameters.
- `handbook/references/security-privacy.md`, `handbook/references/project-context-files.md`: approval, redaction and project context.
- `handbook/references/background-systems.md`, `handbook/references/webhooks.md`: lifecycle and service requirements.
- `handbook/references/desktop-plugins.md`, `handbook/references/themes.md`, `handbook/references/tui-widgets.md`, `handbook/references/petdex.md`: optional extension contracts.
- `handbook/references/portal-auth-for-third-party-apps.md`: Nous-specific authorization boundaries, not Aino entitlement.

For upstream-only capabilities, say that the material is an implementation reference and
check whether the installed Aino surface supports it. An undocumented feature is not proof
of absence; an upstream document is not proof that it is exposed in Aino.

## Recovery boundaries

Account workspaces use platform origin and user ID; an email, selected profile or UI request
revision is not the principal. Keep model recovery bound to the original conversation and
current native identity. Never patch a database or borrow another account's Key to force send.

Device authorization identifies an account. Aino API evaluates model permission and billing
for each request; provider/custom API credentials retain their own authority and billing.

Cloud conversation synchronization has been retired. Do not offer sync retries, restore old
cloud records or create a substitute upload system. Local history and explicit file export
are separate features and retain their normal account boundaries.

Prompt refresh is explicit and scoped: `--session` targets one conversation, no `--session`
targets the current profile's continuing sessions, and `--json` reports the request. There is
no `--dry-run` flag. The next turn rebuilds from current sources once, retaining history and
incurring one cache miss per refreshed session. Do not refresh on every turn.
