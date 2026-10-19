# Aino / Hermes v0.22.2 compatibility validation

## Scope

Integrates stable Hermes v0.22.2 (`d923a5eb487a17c0a68801bba9ef0f56c81040a8`) into Aino main baseline `da66d4279c9b6436a392a9ed9ecb861b423b3ce3`, preserving upstream history. v0.22.1 was published from an unintended commit; this integration uses the corrected stable tag, not upstream main.

Aino retains its neutral palette, compact response presentation, folder-backed projects, Summary panel, platform account/model authority, managed context limits and delegation. Upstream onboarding and appearance requests are adapted through existing components and configuration. There is no replacement collaboration engine or billing authority.

## Compatibility decisions

- Onboarding uses the ordinary managed-session ticket/claim/bind path before hidden model submission. It captures one backend owner across model preparation, start, binding, navigation and reconciliation. Managed selection does not claim the upstream trial.
- Retired first-task tools are removed. Existing stored first-task messages keep their model-facing content, while history projection hides the old internal tail using its exact delimiter.
- Theme requests retain Aino's neutral accent; light/dark/system and supported layouts remain available.
- Existing Aino streaming hooks, public session provenance, summary RPC, project creation and quick-entry rollback remain in place.
- Installer origin overrides and native CI test planning remain Aino-owned. Upstream code-health attribution is pinned to the exact reviewed release; integration regressions still block. Once main contains that release, the regular main ratchet resumes.
- The existing script entrypoint helpers now compare real file identity, fixing invocation through symlinked checkout paths without adding another launcher.

## Local verification

All Python tests used the canonical `scripts/run_tests.sh` with a fresh PM-managed isolated environment. No paid provider calls or daily desktop profile changes were made.

| Verification | Result |
| --- | --- |
| 211 changed Python test files | 4,439 passed, 56 skipped, no failures or flaky reruns |
| Additional core/tool lane | 240 passed, 4 skipped |
| Infrastructure lane | 105 passed, 6 skipped |
| Full renderer suite | 11,676 passed, 1,380 files |
| Full Electron suite | 3,763 passed, 36 platform skips |
| Native macOS project/account E2E | Initial combined 8 passed; after terminal repair, final project suite 7 passed (account suite unchanged), isolated Electron/backend and local mock services |
| Managed onboarding real SDK/loopback opening | 3 tests passed; no model request before binding |
| Final captured-owner/hook fix lane | 55 tests passed; real-dispatcher positive-control rerun 4 passed |
| Final desktop typecheck | Passed |
| Final full desktop ESLint | 0 errors, 303 warnings |
| Production desktop build | Passed |
| Static guards | 11 passed, including Windows footguns, paths, configuration writers, OS markers, AGENTS size, case collisions, lazy dependencies, profile archives, blob size and Ruff |

These lanes overlap; their counts must not be added as a unique total. Complete renderer/Electron suites preceded the final owner-routing adjustment, which has focused routing and window-role coverage plus final typechecking/build. A subsequent native rerun found a terminal restore defect inherited from both pre-upgrade main and upstream: the existing prompt cleaner removed the first command/output when preceded by the zsh spacer. The cleanup now requires real history before treating a blank as a multiline-prompt separator; its exact first-command case reproduces red before the fix. Skip navigation also retains its captured owner when the ended event arrives before the RPC reply. Both regression fixes pass the 60-test focused lane; the final native project suite passes all seven scenarios without assertion or timeout changes. Native Windows/Linux validation belongs to CI.

Failures found during validation included missing BYOK metadata in fixtures, outdated accent/localization expectations, an actual conditional React hook, captured-owner routing, legacy history display, and symlinked entrypoint handling. They were corrected rather than exempted. Pytest fixture registration was made explicit to satisfy the existing isolated Ruff health checker.

## Limits

This validates deterministic runtime/UI behavior, not probabilistic Ultra task accuracy or a paid production-model acceptance run. No signed release or daily desktop restart is part of the upgrade.

The dependency audit reports 27 findings (4 critical, 7 high). Sampled affected package versions already exist in both the pre-upgrade main and upstream release. This is not a security-clean claim; forced major dependency upgrades are outside this compatibility sync.

Final code-health analysis of the integration checkpoint retained five allowed findings and zero effective blockers; independent review approved the application changes. Full JSON, screenshots and local logs are retained with the task artifacts. Exact-commit CI results are recorded in the pull request before main integration.

## CI import compatibility

Contributor attribution uses the same fixed v0.22.2 SHA to preserve imported authorship without inventing GitHub identities. New Aino authors still require mappings.

The plugin admission workflow accepts the reviewed upstream import only while the target branch does not yet contain it, and only when the catalog and enforcement inputs match the pinned release. Before validating all 118 changed entries, it checks out the complete trusted release tree and removes untracked files from the disposable CI checkout. Aino application divergence therefore cannot change the plugin validation runtime. Ordinary catalog submissions retain the data-only restriction.

An initial overstrict whole-PR equality check was rejected by actual CI and corrected. Six real Bash fixture scenarios and an isolated synthetic merge of the actual Aino branch validate the import, rejection and expiry paths. The existing Linux-only fixture suite is skipped on macOS; its full pinned-plugin validation remains a Linux CI check.
