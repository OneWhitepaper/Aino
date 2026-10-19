# Aino v0.22.2 compatibility integration

## Specification and constraints
User requests a complete stable Hermes upgrade with upstream UI adapted to the existing Aino style and no loss of existing behavior. Reuse Hermes/Aino modules. Preserve Aino identity, account/model/billing authority, context limits, project folders, summary panel, compact UI, fixed palette and delegation. No paid calls, production-profile changes, release publication or daily desktop restart in this integration.

Base: da66d4279c9b6436a392a9ed9ecb861b423b3ce3.
Upstream: v0.22.2, d923a5eb487a17c0a68801bba9ef0f56c81040a8. Use this release line, not v0.22.1 or main.

## Tasks
1. Desktop integration: resolve Electron/renderer/i18n conflicts, adapt new theme/onboarding capabilities to Aino contracts; preserve all existing account and project behavior. Run typechecks, UI/Electron regressions and build. Review scoped changes.
2. Backend integration: resolve agent/config/gateway conflicts and generated contracts, preserve runtime invariants and Aino managed models. Run canonical targeted Python regressions. Review scoped changes.
3. Infrastructure integration: resolve workflow/install/dependency/credit conflicts, prepare isolated dependencies, regenerate shared artifacts; run existing static checks and health comparison. Preserve native-test fixes from prior integration.
4. System validation: complete UI and Electron suites, Python regression lanes, real isolated desktop/mock-backend E2E and visual checks, review whole integration, commit/push PR for native CI. Fix new failures; report exact scope and evidence. Never silently waive integration findings.

## Coordination
Desktop owns apps/desktop and locales. Backend owns agent, hermes_cli, tui_gateway, apps/shared generated contracts and tests/agent fixtures. Controller owns other files and commits/index. Workers may stage only resolved owned conflict files; never commit the shared merge or reset another worker's work.

## Verification limits
v0.22.0 release notes summarize prior releases too. Do not claim every listed feature is new. Existing v0.21.7 main CI is the baseline receipt; rerun focused invariants on integrated code and compare failures against original if needed. Native Windows/Linux CI cannot be replaced with mocked macOS tests.
