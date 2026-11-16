# Agent Hub creation repair — acceptance

Historical acceptance record: `$TMPDIR/...` references below identify evidence from the original machine's temporary directory. They describe that run, are not commands to execute, and do not imply the raw logs are included in this checkout or still available. Committed screenshots retain their existing links.

Branch: `codex/bot-creation-context-repair`, based on `97299a64d9`.
Worktree: `/Users/zizimutou/.codex/worktrees/agent-hub-bot-repair/Aino`.

## Behavior

- New robots inherit the explicitly selected clone source's saved Aino model preference.
- Aino device identity remains usable when account-management refresh is offline.
- Model readiness waits for the exact gateway's managed-model handshake.
- The canonical Bot Chat retains its owning connection through creation/binding/opening/intro.
- Creation uses the same source-qualified roster transaction as opening an existing robot.
- Ordinary workspace selection is preserved, and stale creation cannot take focus back from settings.
- An explicitly selected clone source's empty runtime model is not replaced by the launch workspace's third-party model.
- Canonical identity remains `(profile, title = Bot Chat)`; no stored session-id pin was introduced.

## Real desktop acceptance

Used the already running isolated Electron development instance connected to Aino API.

1. Saved the user-authorized `GLM-5.3-Flash` as the default workspace's default main model.
2. Created `默认模型验收` using the normal Agent Hub dialog and a one-sentence, no-tools role.
3. No provider/API Key setup was requested. The exact new robot opened and replied using GLM-5.3-Flash.
4. Opening another robot and returning retained the same intro, without sending it again.
5. The ordinary workspace remained the one selected before creation; then restored `default` to undo the older bug's selection.
6. Existing `素材脚本助手` was retained. After a full renderer reload, explicitly selecting GLM-5.3-Flash succeeded and the minimal connection test received `连接正常`.
7. Read-only database inspection confirmed that original Bot Chat identity was unchanged, remained hidden, and now held the two test messages. No replacement chat was created.
8. Reloaded the final build, switched between both robots, and left the original robot's successful reply visible.

The old empty-chat selection initially did not repaint in the long-running renderer. A temporary credential-free diagnostic showed a valid tile runtime after reload and successful selection. No speculative new resume framework was added; the diagnostic was removed from source and final output.

## Verification

- Desktop affected regression: 126 files, 1096 tests passed (`$TMPDIR/aino-bot-fix-regression-final2.log`).
- A final test-fixture type correction was followed by 71 routing/canonical tests passing (`$TMPDIR/aino-bot-fix-routing-final.log`).
- Python integration/identity/profile regression: 7 files, 59 tests passed (`$TMPDIR/aino-bot-python-final.log`).
- Full desktop typecheck passed (`$TMPDIR/aino-bot-fix-typecheck-final3.log`).
- Final development build passed (`$TMPDIR/aino-bot-fix-build-final3.log`).
- ESLint for changed TypeScript files and `git diff --check` passed.

These are affected-area checks, not a claim that the entire repository test suite ran.
No commit, push, API deployment, installer publication, or main merge was performed for this follow-up repair.

## Follow-up: model-unavailable recovery

The screenshot robot `创建修复验证` had no canonical session and no saved Aino default from an earlier failed creation. Its structured `model_unavailable` error was displayed as a generic gateway failure because the recovery classification relied on English message text.

- Recovery now recognizes the structured error and opens this robot's own Model settings, retaining its source and profile scope.
- Saving the user-authorized `GLM-5.3-Flash` in that scoped page and reopening the robot succeeded in the real desktop. Exactly one hidden `Bot Chat` was created, with zero messages.
- Another earlier test robot, `创建流程验收`, already had an empty canonical chat. Explicitly opening it now completes foreground hydration and applies its own saved default through the existing managed model switch and device binding path.
- Read-only database verification confirmed its original canonical ID is unchanged, its model is now `g9-glm-5.3-flash`, and its message count remains zero. No duplicate chat or intro was created.
- The user's `素材脚本助手` retained its original canonical ID, two existing messages and successful `连接正常` response. Switching between robots preserved the model and history.
- Background roster activity remains a background refresh; it does not perform foreground model recovery.

Final verification after the foreground-open repair and post-navigation cancellation guard:

- Affected desktop regression: 125 files / 1159 tests passed (`$TMPDIR/aino-bot-recovery-cancel-tests.log`).
- Final development build passed (`$TMPDIR/aino-bot-recovery-cancel-build.log`).
- Navigation agent ran the full desktop typecheck, affected ESLint and a separate 180-test regression successfully.
- Independent read-only review confirmed that navigation cancellation cleans up listeners, never retries into a page the user left, and does not mark a cancelled session as failed.
- Force-reloaded the real desktop with the final build and reopened both early test robots. Both displayed `Aino 内置模型: GLM-5.3-Flash` with no error; the screenshot robot is left visible.
