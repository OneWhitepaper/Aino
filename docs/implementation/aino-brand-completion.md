# Aino product-brand completion

Date: 2026-10-23. Branch: `codex/aino-brand-completion`. Base: `3d375c1c767df53618cbd5eebde9673b85310af1`.

Follow-up, 2026-10-24: [Aino private diagnostics](aino-private-diagnostics.md) replaces the desktop upload recipient with Aino. The scope and verification below describe the earlier branding-only commit; the private ingestion service is a subsequent change and is not yet deployed.

## Result and scope

The Aino desktop and public repository entry points now use Aino-owned product names and actual Aino destinations. GitHub remains public. This is product branding on the existing Hermes runtime; it is not a runtime fork rewrite or removal of upstream authorship.

The existing `apps/desktop/brand.json`, renderer identity helpers and Electron product identity provide the canonical website, download, guide, repository, release and feedback routes. Existing components consume them; no manager, upload service, catalog mirror, runtime API or dependency was added.

| Area | Change |
| --- | --- |
| Desktop updates | Release-note API requests, commit/release links and manual installer guidance use the Aino repository and download page; existing parsing, caching and fallback behavior remain |
| Help and recovery | General help uses the existing Aino guide; detailed provider and state-recovery references link to actual files in the Aino fork |
| Native and renderer copy | Startup, connection errors, windows, tray, default notifications, quick entry and update/restart progress use Aino labels at their existing producers |
| Agent Hub and boards | Default agent labels, compatibility notices, existing locale fallbacks and board archive picker labels use Aino; configured names and profile identities remain |
| Remote installation advice | The missing-install message selects the Aino installer script and existing `HERMES_INSTALL_REPOSITORY_URL` override; the message does not execute an installer |
| Repository | Four root READMEs, contribution entry points, package descriptions and issue templates describe Aino's actual installation and feedback flow |

An existing translation bug also changed an interpolated custom name such as `Hermes Studio` into `Aino Studio`. The existing brand helper now protects caller-supplied string arguments while branding surrounding UI copy. The shared runtime translator passes those arguments through the same boundary. Translation functions still receive their original values; conversation bodies and raw diagnostic evidence are not globally filtered.

## Compatibility and service boundaries

- `LICENSE`, `NOTICE.md`, upstream history and real author attribution are unchanged.
- App IDs, signed identities, homes, stored sessions, credentials, schemas, protocols, IPC/RPC, `HERMES_*`, the `hermes` executable, package/module/SDK names and update feeds are unchanged.
- System prompts, conversation history, model/provider identities, custom names, third-party libraries and actual external service endpoints are retained.
- Nous Cloud recovery, the explicitly named legacy `diagnostics.share_nous` RPC and CLI `--nous` upload remain Nous services. At the branding-only checkpoint the desktop also used that flow; the subsequent private-diagnostics change routes the desktop to Aino. Generic product feedback goes to Aino Issues; Aino maintainers do not acquire access to Nous-private bundles.
- The existing hosted plugin catalog and Skills Hub remain available at their real origins. No nonexistent Aino substitute was introduced.
- Inherited developer/runtime documentation can retain Hermes terminology where it describes real interfaces. See [the full boundary](../aino-brand-boundary.md).

## Verification

Tests run from `apps/desktop` with `HERMES_PYTHON=/private/tmp/aino-v0222-test-venv/bin/python`, using the existing Vitest UI and Electron projects. The final covering run includes affected branding, updates, recovery, startup, connection, SDK, Agent Hub, translation and updater tests:

- **262 test files passed, 4 skipped; 2,885 tests passed, 13 skipped; 0 failed.** Platform-conditional cases retain their host gates.
- Desktop TypeScript typecheck: passed.
- ESLint for all changed TypeScript/TSX files: passed without errors or warnings.
- `python scripts/check --staged`: **12 checks passed**, code health **0 blocking / 0 advisory** against the recorded base.
- `npm run build --workspace apps/desktop`: passed. The bundler reports that `profile-ops.ts` has both static and dynamic imports; the build completed without error.
- Documentation targets and local links checked; website/download/guide and repository/issues/releases returned HTTP 200. GitHub API reports repository visibility `PUBLIC`.
- `git diff --check` passed; original `LICENSE` and `NOTICE.md` have no diff.

Meaningful regressions were observed failing before their fixes: update/release destinations pointed upstream, remote missing-install advice selected the upstream distribution, and the shared translation boundary changed `Hermes Studio` to `Aino Studio`. They pass in the final covering run. Old-brand assertions were updated only for copy produced by this patch; custom titles, paths, runtime markers, model families, raw errors and external-service fixtures remain intact.

The existing stalled-bootstrap test previously waited five real minutes. Its test clock now advances the same production timeout with fake timers; production timing and timeout behavior are unchanged.

## Review decisions and limitations

1. Generic Aino feedback uses Aino Issues. At this checkpoint there was no Aino ingestion service, so relabeling the Nous upload would have misstated its recipient. The follow-up adds the actual Aino service before changing the desktop label.
2. Nous-specific recovery, catalog and Skills Hub retain real services. Inventing Aino hostnames would break those features.
3. Product branding stops at the documented runtime, user-content and licensing boundaries. A global rename would risk compatibility and attribution.
4. Implementation delegation returned an empty task payload twice; a separate final review attempt also returned an empty task payload. These attempts performed no implementation or review and are **not counted as independent approval**. Work continued in the parent with behavioral regressions, static checks and self-review; independent approval is still absent.
5. Plugin imports remain fenced to the existing SDK. Agent Hub's fallback copy was updated in its existing locale/label producers instead of adding a branding API solely for this change. Registered translations continue through the existing host translator.

Validation was performed on macOS. This run does not certify native Windows/Linux user flows, signed installers, notarization, published update feeds or live third-party uploads. No paid model call, website deployment, installer publication or daily desktop restart was performed for this change. Merging source and publishing installers remain separate release steps.
