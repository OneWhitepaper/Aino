# Aino v0.23.0 native acceptance — 2026-11-10

Historical acceptance record: `$TMPDIR/...` references below identify evidence from the original machine's temporary directory. They describe that run, are not commands to execute, and do not imply the raw logs are included in this checkout or still available. Committed screenshots retain their existing links.

Local evidence only. Do not add this directory or its screenshots to a public commit.

## Execution

- Worktree: `/Users/zizimutou/.codex/worktrees/agent-hub-bot-repair/Aino`.
- All UI interactions and screenshots used CUA native app APIs; no CDP, injected renderer JavaScript, AppleScript, or hidden renderer-state access.
- The old temporary Canary bundle was listed by macOS but rejected by CUA as `Invalid app`, including after restoring its files and restarting it.
- Restarted with the official repository-installed Electron executable, preserving the original process environment, user-data directory, isolated backend Python wrapper, and account workspace. Current Electron PID at handoff: `61898`.
- App path: `/Users/zizimutou/.codex/worktrees/agent-hub-bot-repair/Aino/node_modules/electron/dist/Electron.app`.
- Renderer: current repository `apps/desktop/dist/index.html`.
- User data: `/private/var/folders/d8/tb_9ybdj5xzg_l5451f5209c0000gn/T/aino-device-prod.hifobp6z/electron-user-data`.
- Existing gateway was restarted through the application's model settings only when its explicit stale-code warning appeared after a new commit. No competing gateway process was started manually.

## Observed acceptance results

| Area | Actual observation |
| --- | --- |
| Ordinary conversation | Created **普通会话验收**, selected `gpt-5.6-sol` for this conversation only, sent a minimal no-tool prompt, and received **普通会话验收通过**. UI displayed 7 seconds and 0.0097857 USD. |
| Modes and panels | Switched between Aino ordinary conversations and Agent Hub. Opened the right panel, switched Terminal and Files tabs, and opened/closed Conversation resources. Existing conversation and group views remained usable. |
| Names and group UI | Header mention buttons, member list, roster, message authors and mention composer showed current Chinese display names. Group information exposed Members, Files and Manage. |
| Upstream group settings | Manage → Group settings displayed purpose, shared notes, routing choice and scheduled-message room destination. Cancelled without changing the original group. |
| QA defaults | For newly created `aino-v0230-qa-a` / **升级验收甲** and `aino-v0230-qa-b` / **升级验收乙**, applied Aino `gpt-5.6-sol` in each bot's own model settings. Both displayed **已应用**. Leaving and reopening the first bot's settings retained that default. Global/default workspace settings were not changed. |
| Group default use and replies | Created **v0.23 升级验收 QA** from only those two bots. Without a group model override, both replied **群聊验收通过**. Progress showed the remaining member replying and one completed reply, then **本轮回复已结束** and both members ready. |
| Live tool status | Addressed only QA bot A and requested a harmless `sleep 20`. CUA AX and screenshot showed **升级验收甲 · 正在运行命令**, completed-reply count, working roster status and Stop this round. It then replied **20秒工具验收完成** and returned to ready. |
| Group stop semantics | During a separate `sleep 30`, clicked **停止本轮**. Actual result: **群组已停止**, **回合已取消**, **已请求停止**. No Continue action appeared. This is cancellation; it is not reported as pause/continue success. |
| Ordinary pause/continue | In the retained ordinary QA conversation, started a harmless `sleep 30`. Clicked the composer Stop button while running. UI showed **已暂停，当前进展已保留。** and **继续**. Clicked Continue without adding another user message. The same conversation resumed and replied **普通会话接续完成**. |
| Image generation | Read the existing default-workspace image configuration: **Aino built-in Nano Banana 2**, quality **自动**. Did not change it. Requested one simple white-background blue-circle image in the ordinary QA conversation. UI showed rendering, then displayed the actual image, actual/requested size **1024 × 1024 px**, and total turn cost **0.14949206 USD**. |

## Recovery and limitations

- Initial original-group send was refused before acceptance with `RECENT_AUTH_REQUIRED` at device-key binding. Read-only account/model data still worked. Matched the active account to the authorized test-account file in memory and completed normal email/password sign-in. No credentials were printed, no authentication check was bypassed, and the temporary credential file was deleted afterward.
- The original group still had two members without a configured default. Its model preflight reported **模型不可用**. Audit found the relevant paths unchanged from checkpoint and confirmed the other member's saved override alone could not supply the missing members' defaults. Existing seven bots and original-group model choices were preserved; acceptance used the separate QA group instead.
- CUA `typeText` dropped CJK in the first attempted original-group test request. Subsequent text entry used `paste`. This request is conclusively QA-authored: the original group's composer was empty on first inspection (placeholder, no value), before this run inserted the mention and attempted text. No accepted new message from this attempt appeared in its transcript. It is the draft containing `@测试` and `terminal sleep 8`.
- The original UI offered only Retry for that uncertain QA request, so cleanup initially left it intact. This exposed the preparation/admission bug documented below. After the fix in commit **74f44425f6**, the rebuilt normal UI successfully removed only this QA retry copy through **放弃重试** confirmation; no queue or database manipulation was used. See the [original blocked request](retained-qa-send.png), [new confirmation](abandon-confirmation.png), and [editable composer after cleanup](abandoned-qa-send.png).
- After backend restart, the initial pre-restart model draft was no longer applied. Re-selecting and applying after the backend became ready produced the clear persisted **已应用** state. No application-source change was made for this observation.
- Creation's advanced UI visibly offers **继承（启动工作区）** / **继承启动工作区**. The existing default workspace had no explicit default, so inheritance from a configured global default was not tested by changing that user's global preference. Actual group use of each new QA bot's configured default was verified.
- The gateway-driven paused-discussion `groups.continue` event path was not forced in a live group. Native ordinary-chat pause/continue and group cancellation were tested separately and are described accurately above.

## Cleanup

- Through normal UI, disbanded only **v0.23 升级验收 QA**.
- Through normal UI, deleted only `aino-v0230-qa-a` and `aino-v0230-qa-b`, both created for this acceptance run.
- Verified the roster again contained the original seven bots and original group.
- Preserved **普通会话验收**, including text reply, generated image, and ordinary pause/continue result, for user inspection.
- Preserved all original configurations and user content. The QA-authored unconfirmed request in the original group was removed through the repaired normal UI on **74f44425f6**; no QA send remains pending. The original seven bots, group, and transcript remain intact.
- Deleted `/var/folders/d8/tb_9ybdj5xzg_l5451f5209c0000gn/T/aino-v0230-qa-accounts-1_o2r2my.json`; cleared credential variables in CUA memory.

## Screenshots

- [Group replies completed](group-complete.png)
- [Group cancellation result](group-stopped.png)
- [Existing image settings](image-settings.png)
- [Generated image displayed](image-result.png)
- [Ordinary conversation paused](chat-paused.png)
- [Same conversation resumed and completed](chat-resumed.png)
- [Original roster after cleanup](cleaned-roster.png)
- [Original QA request with only Retry available](retained-qa-send.png)
- [Explicit abandon confirmation and warning](abandon-confirmation.png)
- [QA retry copy removed, composer editable](abandoned-qa-send.png)
- [Empty editable group composer after reload](cleaned-qa-send-after-reload.png)

## Group-send recovery fix

- Native QA exposed a real boundary bug: local member/default/device-key preparation failed before `groups.send`, but no `admitted: false` proof reached the composer. The journal therefore treated this unsent request as potentially delivered.
- SDK preparation now annotates only failures before actual send dispatch, preserving the original code/message/data. Actual transport errors remain unchanged so lost acknowledgements keep the exact event identity.
- Legacy unknown requests remain unknown. Added explicit **放弃重试 / Abandon retry** with the existing confirmation dialog and a warning that a message may already have posted or arrive later. The action only removes the confirmed local retry copy and never sends or recalls a message.
- Confirmation captures a current whole journal snapshot. Deletion is one atomic compare-and-set; changed payload, attempt count, event ID, binding, room or account prevents a stale confirmation from deleting a newer request. The native account workspace fence also rejects an old-account sender even when another account holds identical serialized content.
- Composer cleanup preserves held/newer words and distinguishes same text replying to a different thread. It never reopens uncertain content as a fresh automatically sendable message.
- Tests were observed failing before implementation, including the independent review's same-text/different-thread regression. The final scoped SDK/group suites passed **128 tests**. Native prepared-journal/account-fence suites passed **6 tests**. Renderer/Electron TypeScript passed; scoped lint had no errors; code health against HEAD returned `[]`.
- The parent committed and built **74f44425f6**, then authorized reloading the existing app. Reload showed the new Chinese recovery copy and **放弃重试** button. No stale-backend warning appeared during this check, so no service restart was needed.
- Opened the confirmation for the exact QA payload (`@测试` / stored handle `@u6d4b-u8bd5`, `terminal sleep 8`, `v0.23`). The dialog warned that it may already have posted or arrive later and that the operation neither recalls nor resends it. **Cancel** left the same disabled pending text and Retry control unchanged.
- Reopened the same confirmation and chose **放弃重试**. Observed **已放弃重试。再次发送相同内容前，请先检查群聊记录。**, an empty editable group composer, enabled mention/attachment controls and disabled Send. No new message or work appeared in the transcript, whose latest entries remained the prior real-time-status acceptance conversation.
- Pasted `QA edit check (not sent)` into the now editable composer and observed the value and enabled Send. Cleared it without sending, reloaded the app, reopened the group and verified the composer remained empty/editable with no restored-pending notice or Retry control. This confirms durable removal through the normal UI.
- Returned the app to **普通会话验收**, with the original ordinary reply, actual generated image, and completed pause/continue result visible. The UI acceptance portion is complete.

## Automated validation owned by this agent

- Bot/group plus locale UI tests: **164 files, 1303 tests passed** — `$TMPDIR/aino-bots-merge-final-tests.log`.
- Renderer TypeScript: passed — `$TMPDIR/aino-bots-merge-final-types.log`.
- Bot/group ESLint: exit 0, 0 errors / 7 warnings — `$TMPDIR/aino-bots-merge-final-lint.log`.
- Bot/group code health: 0 findings — `$TMPDIR/aino-bots-health-final.json`.
- Electron platform full final rerun: **452 files passed / 11 skipped; 4360 tests passed / 66 skipped**, exit 0 — `$TMPDIR/aino-v0230-platforms-final2.log`.
- Remote lifecycle focused tests: **90 passed / 1 skipped** after tightening the mock's termination matcher; the real ownership gate was not weakened — `$TMPDIR/aino-v0230-remote-focused.log`.
- Portal real-Electron test: focused passed; then passed in the final full rerun without increasing timeouts or changing production code — `$TMPDIR/aino-v0230-portal-focused.log`.

The parent agent owns final repository-wide checks, CI, PR and merge status.


## Final runtime reload after core version-info fix

- After the parent’s final product commit and test-only follow-up, used only normal UI: **Settings → 运行服务 → 运行服务 status menu → 重启网关 → 全部重启**. The confirmation listed the existing seven profiles. No settings, account, user-data location or source files were changed, and no model call was initiated.
- The app showed **运行服务: 重启中…**, then its status menu reported **已连接 / 推理已就绪**. In **Command Center → System**, the actual backend reported **消息网关运行中**, **Aino 0.23.0 · 活跃会话 0**.
- UI-visible logs recorded the old gateway stopping cleanly at **05:25:23**, the new runtime starting at **05:25:26**, and WebSocket acceptance at **05:25:27**. Session storage remained the original account-workspace path under the same Electron user-data directory.
- The restart log included one refused contender (`Cannot reserve gateway profiles: Gateway runtime already owns profile`) before the successful start. The final UI showed a running, connected runtime; no persistent failure was observed. No manual competing process was launched.
- Left the System panel showing the verified running version. CUA completion summary was emitted.
