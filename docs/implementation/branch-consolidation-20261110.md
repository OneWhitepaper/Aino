# Aino branch consolidation — 2026-11-10

The audit baseline is main `7c669f1053abc372c7fce579ac3e767806fa4355`, after the verified Hermes v0.23.0 integration. This ledger accounts for all 21 remote branch tips whose original commits were not ancestors of that baseline. Commit ancestry alone was not treated as proof of missing functionality: the review checked squash results, stable patch IDs, current implementations and superseded designs.

Every original tip is preserved by an annotated remote tag named `archive/2026-11-10/<original-branch>`. The peeled tag commits were verified against the inventory before removing the reviewed remote branch heads. A separately verified incremental Git bundle also preserves the unique history. Existing worktrees, user data and local acceptance material are retained.

The only remaining implementation change selected from this inventory is the nine-action dependency update. It preserves the original author's commit and must pass the repository checks and CI before integration. No desktop product behavior or visual styling is changed by this cleanup.

## Inventory

| Original branch | Original commit | Disposition | Evidence / rationale |
| --- | --- | --- | --- |
| `aino/candidate-fix` | `58522d43035f5a00921ce9f0078a35c5b901ddd4` | Superseded | Old v0.21.1 merge attempt; official integration 12979be71c retains the intended Aino boundaries. |
| `aino/full-v0211-merge` | `507036101c0af33a4718f0646db6c905e3de5fb9` | Superseded | Old merge alternative, superseded by 12979be71c; restoring it would regress branding and watchdog fixes. |
| `aino/full-v0211-ours-merge` | `58522d43035f5a00921ce9f0078a35c5b901ddd4` | Duplicate | Same commit as aino/candidate-fix. |
| `aino/manual-v0211` | `0a9235b0f30b6ac896000d49104e67aac72d77ce` | Superseded | Old structural integration attempt; final main integration includes compatibility and profile isolation fixes. |
| `aino/ui-terminal-workspace` | `daa9d976dcb8c63fc7bcde46bb0986f9dc094682` | Already integrated | Complete tip tree equals main ancestor abf3774524. |
| `aino/upstream-v0211-integration` | `9c0cd40327c5cc64cde95d4bb62a03be3f5f591b` | Already integrated | All six unique patches match main commits by stable patch ID. |
| `bot/js-autofix` | `04e2a71e4b9c0ef62a8228b11dc7f85be9f26bc4` | Archive only | Formatting-only proposal; current checks pass without it and it introduces blocking code-health size findings. No functional fix to salvage. |
| `codex/aino-desktop-0.1.2` | `29676084c5bec5ce93ad1a6e5bf70c8535a27ce9` | Already integrated | Patch equivalent to merged PR #19, commit 7d6fb44939. |
| `codex/aino-upstream-v0226` | `269d3f83f896a4c72502daf9ccdd1f12a4884e84` | Superseded | Approved single-device Key design is in main; old temporary-lease UI wording no longer describes the current protocol. |
| `codex/aino-usage-statistics` | `ee2b4ea39dcd02a3542de55e9852d98fc85a7a90` | Already integrated | PR #23 functionality is in 29c12cc637; later account fencing and config-backend changes preserve its consent boundaries. |
| `codex/archive-aino-icon-variants-20260917` | `b806522258ed238687a67f175e6ace3c09b8c495` | Archive only | Unused historical icon candidates remain recoverable; they are not current production assets. |
| `codex/archive-device-key-plans-20261105` | `2886eba017abaa0daa0bb779b8e739ca88e644d7` | Archive only | Historical device-Key drafts remain recoverable; current approved implementation supersedes them. |
| `codex/deduplicate-desktop-bundle` | `6860e8673a79da5c189a5358f42eeed3fda2defd` | Already integrated | Patch equivalent to merged PR #15, commit 3d375c1c76. |
| `codex/desktop-update-acceptance` | `645a58442fcbd974932f7ed2cba69ccded645574` | Already integrated | Four-commit aggregate patch equals merged PR #20, commit 018dba5cb6; later native/Windows improvements remain. |
| `codex/device-key-reauthorize-feedback` | `bae29eb4266aef469f96fec8e7e9601fa35509cd` | Already integrated | Patch equivalent to merged PR #29, commit 3ca71d0871. |
| `codex/fix-platform-readiness` | `4b821458ca4306d8e8516117d1562b63f0ed2750` | Already integrated | Patch equivalent to merged PR #22, commit 7156e9e5c5. |
| `codex/managed-inference-operation` | `2993d8203802c80192c525d3cd39b0080081018c` | Already integrated | Patch equivalent to merged PR #30, commit 633d4c78ae; unknown-outcome replay protection remains. |
| `codex/multi-agent-conversations` | `c52025fbac7890ffda38dc5acaf3c7ce47f332d1` | Withdrawn / integrated baseline | Implementation was explicitly withdrawn; final tip tree equals main ancestor f8d777736b. Do not revive the withdrawn architecture. |
| `dependabot/github_actions/actions-minor-patch-b1969bedb0` | `ba5b7049417b07ddc4d23a80d9c65672d34103c9` | Integrate after validation | Nine reviewed action updates, cherry-picked with source attribution as 825a0fc03b; no workflow permission or trigger changes. |
| `dependabot/github_actions/actions/cache-6.1.0` | `a4627172b2aa07005d6e48db9b84ddd46b734e8d` | Already integrated | All cache uses already pin official v6.1.0 commit 55cc834586; PR #5 is superseded. |
| `dependabot/github_actions/actions/cache/save-6.1.0` | `5b782d966569438174742857f3d43e3b1b6dff47` | Already integrated | All cache/save uses already pin official v6.1.0 commit 55cc834586. |

## Open PR disposition

- **#23:** closed as incorporated through another main commit. The original 43-file change was traced into the desktop/usage baseline; all remaining current-file differences preserve its recipient-bound consent, opt-out/retry and Nous connector separation.
- **#5:** closed as already covered by the v6.1.0 cache pins on main.
- **#6:** archived without applying its formatting-only diff. The proposal touches 824 files and would cause blocking code-health size findings. Runtime syntax inspection found no missing functional changes. Existing formatter configuration and required checks are unchanged; future automated proposals remain reviewable.
- **#21:** the 14-workflow, 33-line pin update is preserved with `git cherry-pick -x` in this consolidation. Close the original PR as incorporated after the consolidation passes CI and merges.

## Recovery

The archive tags are historical snapshots, not software release tags. To recover any original branch in an Aino clone:

```sh
git fetch origin 'refs/tags/archive/2026-11-10/*:refs/tags/archive/2026-11-10/*'
git switch -c restore/old-work archive/2026-11-10/<original-branch>
```

Do not merge obsolete whole trees back onto main. If a historical requirement is revisited, compare its archived behavior with the current implementation and carry only the still-relevant change onto a fresh main-based branch.

## Validation

The audit itself changes no production code. The selected action updates use full official commit pins and retain the existing workflow inputs, permissions and trigger conditions. Local workflow contract coverage passed: 44 files, 675 tests, zero failures; 59 host-specific cases were skipped locally and require the applicable CI lanes. All 14 repository static checks passed. Consolidation PR/main CI results will be recorded on the corresponding pull request.
