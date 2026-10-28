# Aino brand and compatibility boundary

Aino is an independent, publicly developed product built on the Hermes Agent runtime. This document defines product identity without changing the runtime's compatibility interfaces or removing upstream attribution.

## Aino-owned entry points

`apps/desktop/brand.json` is the existing authority for the desktop's product name, application identity and public website/download/guide routes. Renderer and Electron identity modules consume it. Repository-specific links derive from its Aino repository URL.

| Entry point | Destination or identity |
| --- | --- |
| Product, windows, tray and default notifications | Aino |
| Website | <https://petoi.cn/> |
| Download | <https://petoi.cn/download.html> |
| Getting started | <https://petoi.cn/guide.html> |
| Releases and release-note requests | <https://github.com/OneWhitepaper/Aino/releases> and the Aino GitHub API |
| Commit links and generic product feedback | Aino repository commits and Issues |
| Desktop diagnostic upload | Authenticated Aino account service; private administrator access |
| Optional daily usage statistics | Aino statistics endpoint; a fresh Aino opt-in, no account token |
| Detailed runtime references | Actual documentation files in the Aino repository |

The renderer's existing translation overlay changes product labels while retaining compatibility code spans. Native product copy uses the existing identity exports. Neither layer rewrites user conversations, custom names, raw error evidence or system prompts.

Root landing pages describe Aino's actual desktop installation and support flow. They do not present the upstream Hermes installation scripts as an Aino download. Source-build and remote-install guidance continues to use the real `hermes` command; a remote installer hint explicitly selects the Aino source repository using the installer's existing override.

## Installed identity and data

The existing stable application identity stays `com.ablankpaper.aino`. Signed identities, variant IDs, update channels, protocol registrations and user-data migration rules are unchanged by brand completion.

| Scope | Default | Existing compatibility behavior |
| --- | --- | --- |
| Electron application state | The OS application-data directory for Aino | Explicit desktop user-data overrides remain supported |
| Agent state for the desktop | `~/.aino` on macOS/Linux or `%LOCALAPPDATA%\aino` on Windows | Explicit `HERMES_HOME` remains authoritative; supported legacy-runtime discovery can reuse an existing usable Hermes runtime only before an Aino root exists |

No new credential copy, data migration or account merge is introduced. An existing installation's resolved paths are not renamed for appearance. Source/CLI and remote runtime paths continue to follow their existing configuration; changing a displayed name does not change them.

## Interfaces that remain Hermes-compatible

- Python distribution/module names and the `hermes` executable;
- `HERMES_HOME`, other existing configuration/environment interfaces and `@hermes/*` packages;
- IPC/RPC methods, session/state schemas, profile routing and authentication headers;
- `hermes-media`, legacy `hermes://` links and existing Aino protocol aliases;
- installed launchers, signed package identities, update hand-off files and process-discovery contracts;
- upstream references and historical technical documentation describing these real interfaces.

These are deliberate compatibility boundaries, not a second product installed alongside Aino. Aino's project metadata points to its own public repository, while upstream history and the fetch-only upstream remote remain intact.

## Third-party services retain their real identity

Branding must never imply that Aino operates another provider's service:

- Nous Portal/Nous Cloud login, billing, gateway recovery and provider support remain Nous-specific.
- The standing Nous free-tier legal strip appears only while the selected inference route uses that service. An available free-tier identity beside an Aino or user-configured provider is not enough; the linked policies belong to Nous.
- The desktop **Send diagnostics to Aino** action collects through `diagnostics.collect` and uploads through the existing native Aino account client, after per-upload consent. Aino-API stores private bundles and exposes them only to authorized administrators; there is no public view link or Nous fallback. The explicitly named legacy `diagnostics.share_nous` and CLI `hermes debug share --nous` still target Nous. See [private diagnostics](implementation/aino-private-diagnostics.md) for access and retention boundaries.
- Daily **usage statistics** reuse Hermes's collector and queue but require a new recipient-bound Aino consent. The same private administration page distinguishes statistics from manually uploaded logs. No old Nous opt-in or historical send window is reused. See [usage statistics](implementation/aino-usage-statistics.md).
- The existing upstream-hosted plugin catalog and Skills Hub remain available at their real service URLs. Submitting to that shared catalog still targets its actual upstream maintainers. This change does not create an Aino mirror or alter iframe trust policies.
- Other providers, model families, external plugins, user-authored content and dependency licenses retain their names.

## Public source, licensing and releases

The GitHub repository stays public. [LICENSE](../LICENSE) and [NOTICE.md](../NOTICE.md) preserve Nous Research's copyright, MIT permissions and source attribution. Product branding is not a claim that the runtime and dependencies were authored entirely by Aino.

Source changes are developed on purpose-named `codex/` branches. A merge into main is not an installer publication. Build, native acceptance, signing/notarization and update-feed publication continue through the existing release pipeline; the website's installed downloads change only when a release is actually published.
