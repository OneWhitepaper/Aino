# Aino runtime identity and offline help

Date: 2026-11-11. This extends the earlier UI branding checkpoint without renaming runtime APIs.

## Result

The existing `apps/desktop/brand.json` supplies desktop and Python product copy, creator/company,
application identity and documentation routes. `hermes_cli.product_identity` reads the source
resource or the build-generated package copy. Default persona producers, desktop/HUD/TUI hints,
live voice, auxiliary prompts, tool descriptions and desktop bridge errors use that identity.
Provider names, Nous services, SDK/module/tool IDs, credentials and license attribution retain
their actual meanings. User-provided strings and raw tool evidence are not globally replaced.

The [Aino help index](../aino/README.md) and eleven topic guides describe the current product,
including local account isolation, device identity, models/images, collaboration, panels,
settings, extensions, gateway tasks, recovery and prompt refresh. Retired cloud conversation
synchronization is explicitly excluded. The compatible `hermes-agent` help skill reads those
guides first; original upstream technical references and original authorship remain available.
The old platform guide is marked historical rather than treated as current product behavior.

## Persistence and compatibility

- Default SOUL and no-SOUL fallback share one template. Only exact known automatic old templates
  migrate; custom SOUL and configured personality overlays are preserved.
- New sessions build new prompts. Existing sessions preserve their cached bytes until an explicit
  owner-scoped `hermes sessions refresh-prompts --session ID` request takes effect next turn.
  No automatic bulk refresh or history rewrite is introduced. The request survives a restart.
- Runtime block parsing accepts both old Hermes and new Aino markers. Surface/cwd validation
  still reads stored prompts correctly.
- `MEDIA:`, `::preview`, CSS theme variables, `data-hermes-send` and `window.hermes.send` remain
  unchanged. Rooms retain `bot_room` and children retain `subagent`; Aino identity does not expand
  their renderer privileges.
- Package `build_py` carries the canonical brand and Markdown guides into `hermes_cli/data`.
  Native staging retains the brand from the selected Git revision, even while excluding frontend
  sources. Nix's Python filter retains only the necessary brand/docs paths. Docker and the general
  source assembler already include them. No new runtime dependency or service is introduced.

## Verification

Final related runs use the existing runner and the PM-managed Python 3.14.9 test environment:

| Area | Result | Evidence |
| --- | --- | --- |
| Prompt, restore, doctor, desktop tool copy, OAuth and browser contracts | 304 passed, 9 files | `aino-brand-final-regression.log` |
| User personality protection, ACP, curator, Kanban, bridge behavior | 127 passed, 11 files | `aino-brand-auxiliary.log` |
| Source-free brand/docs import and native asset staging | 21 passed, 3 files | `aino-brand-resources-pinned.log` |
| Bundled skill upgrades, user edits and skill viewing | 90 passed, 2 files | `aino-brand-skills.log` |
| Desktop brand/about behavior | 13 passed, 2 files | `aino-brand-ui.log` |
| Native ordinary/Bot/group and real delegated children | Passed | `aino-brand-native-surfaces-final.log` |
| Native inline widget/theme/draft preservation and MEDIA tabs | 2 passed | `aino-brand-native.log` |

Native identity assertions inspect requests received by loopback inference. A stored legacy prompt
is sent unchanged on resume; real CLI targeted refresh updates only the selected session, leaving a
sibling unchanged. Native widgets exercised both send bridges against the live renderer and kept
an unsent draft. Group and child assertions respect their real source policies rather than
pretending they are desktop clients. Tests use isolated homes and do not spend production credits.

The initial group journey consumed Enter in the mention input; its final test uses the explicit
Send button. Early packaging runs used an older Python interpreter and hit the PM runtime's pinned
minor-version requirement; the final pinned-environment run passes. These are not hidden successes.

The related final Python runs total 542 passing tests. Desktop typecheck/build and all 14 checks
in `scripts/check` pass (`aino-brand-typecheck.log`, `aino-brand-build.log`,
`aino-brand-check.log`). All 12 product guides and 63 relative links resolve. Independent
read-only review covered resource packaging,
legacy marker consumers, custom identity preservation and the help-routing boundary. Docker path
inclusion was checked with the actual Moby matcher; complete Docker/Nix builds, paid external
services, website deployment and signed installers are outside this validation.

No production history was bulk-refreshed, no online documentation was published, and no installer
was released by this change.


## Complete help migration

The complete built-in help resource collection is now part of `docs/aino/handbook/`:
original skill body, nineteen technical chapters, three executable/example templates, and the
current Aino help instructions and routing. No original chapter is replaced by a summary.
`migration-manifest.json` maps all 25 source resources to their document locations with hashes,
line counts and adaptations. The original 23-resource help corpus contains 2,926 source lines.

The original operating guide is retained in full beneath a current Aino applicability table.
Technical chapters retain all original body content and add Aino scope and product-guide links.
Desktop fixed themes, CLI/desktop stop semantics, account paths and billing, old pane layouts,
third-party Portal authorization, retired cloud sync and legacy webhook configuration examples
are explicitly distinguished. External whole-site content is not claimed as copied offline.
Plugin and clock templates are byte-identical; the Aino skin changes only its scope comment and
default display name, with the complete original also included for provenance.

The active help skill reads the installed Aino handbook before source or upstream references.
The existing build copies the complete nested documentation tree, including templates and the
manifest, into source-free Python builds; its resource test verifies the complete file inventory
and reads the installed handbook without a source checkout. Product recovery and the technical
troubleshooting chapter remain separate routes despite sharing a basename.

Follow-up validation uses the local logs `aino-help-migration-tests.log` and
`aino-help-migration-check.log`. It covers resource packaging, bundled-skill updates, skill viewing,
authoring standards, complete source/resource correspondence and offline relative links.
Final follow-up results: 1,394 tests passed, all 14 static checks passed; all 25 source resources
are accounted for, all original bodies are preserved, and 149 local links across 35 Markdown
documents resolve. Source-free package imports include the handbook and all template assets.

## Normal-use impact follow-up

The follow-up found and repaired one real help regression: `read_file` follows the selected
terminal backend, so SSH/Docker/sandbox users could not read documentation installed on the
runtime host. The existing `skill_view` file-serving path now supports the built-in help's
`aino-docs/` namespace, bounded to the installed documentation root with the same traversal
and resolved-symlink checks. Skill lookup, platform and disabled guards run first. A real
`aino-docs` directory or symlink within a user skill retains the original file-serving behavior;
custom content is not replaced by the product manual. No terminal filesystem permission changes,
new tool, documentation copy, or conversation prompt refresh is introduced.

The regression test first failed for three remote chapter/template reads, then all twelve
remote, containment and user-content cases passed after the fix. A real-resource probe also
read all forty installed help assets through `skill_view` without executing another terminal
command. Fresh regression covers skill synchronization, discovery, viewing, authoring standards,
prompt restoration, provider-bound cached prefixes, custom personas and source-free packaging.
All twenty-five source resources remain accounted for and all 149 local links resolve.

Native ordinary/Bot/group/child, MEDIA tabs and inline widget/theme/draft journeys pass again
(three cases). Initial native attempts used a release-built Electron main that deliberately
rejects the legacy-development account adapter; they did not reach inference. The fixture now
checks the actual adapter before login and closes a mismatched build rather than issuing an
account request. The final run uses the existing source-test development bundle, isolated
runtime state and loopback inference. Login locators also accept the initial English UI before
the saved Chinese language arrives. Test windows and runtime processes were cleaned up.

Independent packaging review additionally built a real wheel and imported its identity and
offline handbook outside the source checkout. Native/Nix filters and the official Docker ignore
matcher retain the resources. This does not claim a full signed installer, Docker/Nix build,
paid-provider production acceptance or an online documentation deployment.
