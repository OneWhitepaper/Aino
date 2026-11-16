# Named-member group redesign: verification

Date: 2026-11-09. Worktree: `agent-hub-bot-repair/Aino`; branch: `codex/bot-creation-context-repair`.

## Result

Replaced the group page presentation and related group creation/legacy flows. Names and portraits lead member interactions. Exact frozen handles remain in drafts and send payloads; display names never resolve a recipient. The information pane separates Members, Files and Manage. History/search display names, error rows disclose details, and group progress remains server-driven.

## Automated checks

- 213 related test files, 1637 tests passed: `/tmp/aino-human-group-regression-complete.log`.
- Full desktop `npm run typecheck`, exit 0: `/tmp/aino-human-group-typecheck-release.log`.
- Development `HERMES_DESKTOP_BUILD_FLAVOR=development npm run build`, exit 0: `/tmp/aino-human-group-build-complete.log`.
- Targeted ESLint: 0 errors; 4 existing no-restricted-globals warnings in `group-chat-view.inline-code.test.tsx` and `group-chat-view.wrap.test.tsx`: `/tmp/aino-human-group-lint-complete.log`.
- Impeccable detector: `[]`, `/tmp/aino-human-group-detector-complete.json`.
- `git diff --check` passed.

The tests cover exact same-name/renamed recipients, copy/cut/paste, removed members, foreign source/room metadata rejection, malformed clipboard data, IME and selection, punctuation/colon address parsing, plain-text paste, attachments, Enter/form validation, and exact journaled retries. Legacy scope includes durable room, owner connection/profile and source-qualified member routes.

## Observed desktop behavior

Refreshed the current idle development renderer from its freshly built dist; did not restart the gateway. In the actual native desktop, opened the existing group, searched Chinese names with @, selected 创建修复验证, copied the selected mention, cleared and pasted, and observed the original named recipient in the footer. An unknown @name showed recovery copy and disabled Send. The test-only input was cleared. No group was created and no real model message was sent.

Earlier CUA checks also inspected group creation and cancelled it, the member/file/manage tabs, narrow dialogs, Escape/focus return and dark mode. Source fixtures exercise shipping components with explicitly labeled synthetic data and block live runtime calls. Fixture replies are simulated and do not prove backend execution.

## Screenshot provenance

Screenshots are in `/Users/zizimutou/.codex/visualizations/2026/11/09/aino-group-human-redesign/`. `provenance.json` records each file, whether it is native or synthetic, and its SHA-256. Native final captures are `desktop-actual-final.png`, `desktop-selected-name-final.png` and `desktop-unresolved-final.png`.

## Limits and handoff

The UI-only acceptance originally excluded the runtime service failure. The subsequent runtime repair and real-member acceptance below supersede that limitation. Historical failure rows remain as history.

No commit, push, deployment or installer was produced. Existing unrelated dirty changes were preserved. The group design contract is scoped in `docs-local/group-human-redesign/DESIGN.md` and linked from the desktop Group conversations section; shared desktop and gateway owners remain unchanged.

## Independent finish verdict

Ship, limited to this group UI scope. The independent reviewer marked all three original material findings resolved: clipboard recipient identity, duplicate-name counts, and canonical routing-summary grammar. Final native screenshots and production-source tests close the UI acceptance. Runtime acceptance was completed separately below.

## Runtime repair and real-member acceptance, 2026-11-09

The group producer created an invalid empty-model receipt when a profile relied on the desktop's Aino account default. Ordinary Bot Chats already resolved and bound that default, but hosted member sessions bypassed the native managed-model handshake. Private owner RPC errors then masked the invalid receipt as `runtime_draining`.

Hosted sessions now follow their profile with a valid unset model. A narrowly checked recovery repairs only the original hosted empty-model receipt, retaining the deterministic session ID and frozen request. `groups.prepare_model` delegates an independent session ticket under the current room owner, local membership and runtime epoch. Desktop resolves each local member's default and uses the existing native device-key binding before group sends. Retry prepares only its member; approval keeps its frozen task. Returning to an external provider restores profile following without borrowing the Aino account's credential. The original Bot Chat binding remains separate.

Automated evidence:

- Backend: 14 files, 157 tests passed; final added retired-member guards and follow-model checks: 30 tests passed. `/tmp/aino-group-backend-tests.log`, `/tmp/aino-group-backend-final-targeted.log`.
- Desktop: 23 files, 263 tests passed. `/tmp/aino-group-runtime-desktop-tests.log`.
- Full desktop typecheck, build and targeted ESLint passed. `/tmp/aino-group-runtime-typecheck-release.log`, `/tmp/aino-group-runtime-build-release.log`, `/tmp/aino-group-runtime-client-lint-release.log`.
- Backend Ruff, generated gateway contracts and diff checks passed. Backend changes have no code-health findings. Whole-worktree health still lists earlier, unrelated desktop changes; this runtime repair does not claim those are cleared.

The isolated development home also lacked its original on-disk installation identity. A fresh canonical start minted a different identity and correctly refused the historical room. A read-only audit proved one current-user-owned, all-local room, one original identity, no transfers or peer/replica resources, and no persisted references to the newly minted identity. The new file was backed up, then the original installation identity was restored atomically between canonical idle stop and ensure. No database, room authority or owner was manually edited; no authority takeover or permission bypass was added. This was a one-time repair to the isolated development environment, not an automatic adoption policy.

Real native-desktop acceptance used the existing room `35b28be9-f1e9-4fcb-aba5-209e89a186fc` and GLM-5.3-Flash. One addressed member replied “群聊已连接”; all three members then separately replied “已就绪”, without tools. The exact pending send survived the restart and was retried once. Independent read-only checks confirmed all three original session IDs remained, all policies restored successfully, four new member messages and four settled turns, no new failed turn, and an idle, unblocked runtime. Old events 1–23 remain; no pre-repair content fingerprint existed, so no byte-for-byte history claim is made.

Live evidence: `/tmp/aino-group-runtime-status-final.json`, `/tmp/aino-group-runtime-verification-final.json`, `/tmp/aino-group-install-identity-repair-result.json`. Current development gateway PID at acceptance: 1761. No commit, push, deployment or installer was produced.

## Current robot names in historical replies, 2026-11-09

The user chose to show each seated robot's current name for historical replies as well. Canonical history previously preferred the saved actor display label, which could itself be an encoded profile ID, and bypassed the live roster resolver. Message headings, status notices and message search now share the source-qualified current-name resolver. Sidebar search reacts to current names. Legacy approval, clarification, compression and attachment-error labels use readable names from the same source. Meaningful historical names remain for departed members; an opaque missing-member ID falls back to a generic label. Human labels remain separate from robot identities. Routing identifiers and historical events were not rewritten.

Checks passed:

- Related UI regression: 26 files, 268 tests. `/tmp/aino-group-names-tests-final.log`.
- Full desktop typecheck, development build and changed-file ESLint. `/tmp/aino-group-names-typecheck-final.log`, `/tmp/aino-group-names-build.log`, `/tmp/aino-group-names-lint.log`.
- Impeccable detector returned `[]`. `/tmp/aino-group-names-detector.json`.
- `git diff --check` passed.

Reloaded the idle native desktop from the final development build, opened the existing group and inspected historical replies. All three robot headings display 测试, 创建修复验证 and 默认模型验收 in place of internal IDs. Native evidence: `desktop-readable-author-names.png` in the screenshot directory above. No model message was sent, gateway restarted or model configuration changed during this name-display acceptance. No commit, push, deployment or installer was produced.

## Conversation-scoped model switching, 2026-11-09

The existing desktop picker supported Aino models, but the agent-facing model inventory and self-help instructions did not expose the account catalog. The agent consequently wrote an Alibaba/DeepSeek route into its profile default. Hosted group preparation followed that default on subsequent sends, bypassing the native Aino binding. This was a discovery and conversation-selection gap, not an inability to infer with Aino built-ins.

The existing `hermes model` command now supports noninteractive `--list --json` and `--set <listed-id> --provider <listed-provider> --json` through `model.session`. It discovers an existing conversation owner, asks its desktop for actual account and authenticated provider models, and records an owner-scoped desired selection. Matching Aino models take priority; multiple matches return candidates. The native preflight applies the selected route on the next message using the existing mutation and device-key binding. Direct model-route `config set/unset` commands in desktop turns are rejected with the conversation command guidance. Skill instructions explain this flow. Session/profile, room/member, renderer peer, account and authority-generation checks preserve the existing ownership boundaries. The active turn is unchanged. Matching selection stays retryable on binding failure; a newer different picker selection supersedes it. Compression retains the same conversation's choice, while independent conversations and profile defaults do not inherit it.

Automated verification passed:

- Backend and contract regression: 15 files, 159 tests, `/tmp/aino-conversation-model-regression-final.log`.
- Desktop regression: 6 files, 81 tests, `/tmp/aino-conversation-model-ui-final.log`; subsequent final SDK and hidden-workspace coverage: 12 and 23 tests. Signed-out provider SDK coverage: 48 tests.
- Owner request, model binding and group-follow suites: 52 tests; the selected-conversation group suite is included in the backend regression.
- Full desktop typecheck and final development build: `/tmp/aino-conversation-model-typecheck-final.log`, `/tmp/aino-conversation-model-build-final.log`.
- Changed-file ESLint, Ruff and generated contracts passed. The SDK preparation helper has CC 16. Independent frozen review found no remaining functional blocker.
- Whole dirty-worktree health still reports 20 earlier unrelated UI findings, `/tmp/aino-conversation-model-health-release.log`; this task does not claim those cleared. New model-switch sources have no health findings.

The isolated acceptance launcher originally resolved the old editable CLI checkout even though its native gateway used this worktree. An initial test was stopped through the desktop. Only the temporary harness launcher/PATH was corrected to use the current checkout, with its previous wrapper backed up. The packaged app already prioritizes its own launcher; no production resolver or system CLI was changed. The original erroneous Alibaba/default/name triple on profile 测试 was separately backed up and restored to blank inheritance before final acceptance. Other configuration was preserved.

Real acceptance used the final built native desktop and canonically restarted idle gateway (PID 54313). An addressed message to 测试 queried six actual Aino models, selected `g3-deepseek-v4.1-flash`, and received `scheduled / next_message`. A second addressed message received “DeepSeek 群聊验收通过”. Read-only database checks confirmed actual `deepseek-v4.1-flash` usage with `billing_provider=aino`, one call, 52,210 input and 8 output tokens. This verifies the route independently of the robot's self-report. The selected route is stored only for that room/member conversation. The other two group sessions retain GLM, no selection, and zero new calls; all profile default fields match the pre-next-message snapshot. The final reply called no tools. Existing failures and the interrupted harness test remain in history.

Live evidence: `/tmp/aino-model-route-baseline.json`, `/tmp/aino-model-route-final.json`, `/tmp/aino-model-route-acceptance-summary.json`, `/tmp/aino-conversation-model-runtime-restart-final.json`. Native screenshot: `desktop-group-deepseek-selection.png` in the screenshot directory above. This acceptance did not exercise a second live room or private chat inference; isolation for those paths is covered by the owner/scope tests and unchanged defaults. No API change, commit, push, deployment or installer was produced.

## Real task activity in the group status line, 2026-11-09

The source `groups.state.driver_status.member_activity` previously published only queued/running/stopping, and the renderer mapped every running member to Replying. It could not distinguish a model wait from a tool call. `SessionEvents` now maintains a sanitized enum projection of its existing generation-fenced execution stream. The projection is not an observer or delivery consumer and does not change text delivery, final-response fallback or reasoning disclosure. It tracks overlapping tools by their call IDs, ignores superseded claims, and retires on completion, release or epoch change. No tool arguments, commands, paths or private reasoning are stored in that projection.

The existing hosted `info` read exposes activity only for the exact running admission and canonical execution generation. The existing group driver polls it and associates it with the exact room/member/task/hosted-generation. Live member rows retain their attempt identity even when no activity is available. Pending approvals are filtered to a matching live attempt, preventing a prior approval from masking new work. The frontend shares one resolver between its status strip and member information. Queue/stop/approval take priority; unknown or missing categories remain Working. Thinking, reading, editing, searching, commands, browsing, image generation and reply generation reuse existing translated desktop copy. Visible active rooms poll every 750ms, idle/hidden rooms every 2s; an unchanged room log sequence skips transcript reloading while status still updates.

Verification passed:

- Final desktop regression: 8 files, 95 tests, `/tmp/aino-group-live-ui-final.log`, including 16 new live-activity cases and the faster poll/history-cache behavior.
- Final backend regression: 14 files, 127 tests, 1 Linux-only skip on macOS, `/tmp/aino-group-live-backend-final.log`. The approval fixtures were subsequently moved to a focused file to meet file-size limits; both service/approval files passed all 39 tests, `/tmp/aino-room-approval-service-final.log`.
- Full desktop typecheck, development build and changed-file ESLint: `/tmp/aino-group-live-typecheck.log`, `/tmp/aino-group-live-build.log`, `/tmp/aino-group-live-lint-final.log`.
- Ruff, generated gateway contracts and `git diff --check` passed. Independent review found no remaining blocker. Whole-worktree health still lists unrelated earlier UI changes; this task's new/changed activity code has no findings.

Real native acceptance used the final built renderer and idle canonical gateway restart to PID 68342. An addressed message asked 测试 to read and edit only `/tmp/aino-group-status-acceptance-20261109.txt`, run an eight-second command, then reply. The 250ms read-only state trace observed queued → thinking → reading → thinking → editing → thinking → running_command → thinking → idle, always on one exact member/task/generation. The temporary fixture contains the requested new line and the member replied “实时状态验收完成”. Native AX observed Thinking; the screenshot caught Running command; the completed screenshot shows the activity strip and Stop retired. Read/edit lasted under a second, so no claim is made that every short phase remained visible in the 750ms desktop sample. Browser/search/image categories are covered by automated events, not exercised with live external tools in this acceptance. Runtime ended idle, failed/cancelled counts unchanged, settled increased by one.

Evidence: `/tmp/aino-group-activity-before.json`, `/tmp/aino-group-activity-after.json`, `/tmp/aino-group-activity-live-trace.json`, `/tmp/aino-group-activity-runtime-restart.json`. Native screenshots: `desktop-group-live-command.png`, `desktop-group-live-after-command.png`, with provenance hashes in the screenshot directory. Existing history and the previous model selection remain. No commit, push, API deployment or installer was produced.
