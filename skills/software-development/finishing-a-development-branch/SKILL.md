---
name: finishing-a-development-branch
description: Integrate verified branch work and preserve user data.
version: 1.0.0
author: Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [git, integration, pull-requests, cleanup]
    category: software-development
    related_skills: [verification-before-completion, requesting-code-review, using-git-worktrees]
---

# Finishing a Development Branch Skill

Finish verified work through the integration action the user requested.
Confirm the final repository or PR state and preserve anything still
needed for feedback, recovery, or unrelated development.

## When to Use

- A feature or fix is implemented and ready for requested integration.
- The user asks to commit, push, create a PR, merge, or clean up finished work.
- A completed task needs an accurate handoff or branch status.

## Prerequisites

- The authorized final action and the actual task scope.
- Repository instructions, branch policy, and relevant test evidence.
- `terminal` with Git; the repository's PR CLI or connector when needed.
- Access to the correct repository, branch, remotes, and worktree inventory.

## How to Run

1. Verify the current diff, branch, base, and required checks.
2. Complete the requested commit/PR/merge workflow.
3. Verify the integrated result and remote state.
4. Preserve or archive worktrees only when appropriate and authorized.

## Quick Reference

| Requested result | Finish condition |
| --- | --- |
| Commit | Only intended files committed; commit identity recorded |
| Push | Correct remote branch contains the intended commit |
| PR | Correct head/base and reviewable description; required checks tracked |
| Merge | Required checks passed and target contains the final change |
| Keep for review | Branch and worktree retained with a clear status |
| Discard | Explicit user instruction and recovery needs addressed first |

## Procedure

### Confirm what is being finished

Inspect repository root, branch, remotes, status, staged diff, unstaged diff,
and worktree registrations. Resolve the actual target base from instructions
or repository configuration; do not assume it is named main.

Separate this task's edits from unrelated work. Stage explicit paths or
hunks when committing. Do not use a blanket add, stash, reset, or cleanup
command that could capture or destroy someone else's work.

Check that the branch contains the intended changes rather than an earlier
iteration. For a large task, inspect the combined diff and commit history.

### Verify readiness

Run the required checks against the current revision using
`verification-before-completion`. Use independent review when the change's
scope warrants it.

If a required check fails, investigate and repair within scope. A baseline
failure is not automatically permission to bypass a required gate; report
its effect and follow the repository's actual integration policy.

Before merging, synchronize with the target according to repository policy.
Where a rebase is required, do it before the merge, resolve conflicts while
preserving both intended behaviors, and rerun affected checks.

### Perform the authorized action

Use the user's existing instruction; do not ask again merely because this
workflow reached its final stage. If only implementation was requested,
prepare the concrete reviewable result before seeking any needed decision
about publication or integration.

For commits, inspect the staged diff and use a message describing the final
change. For a PR, use the repository template, correct head/base, a concise
problem-and-behavior description, and actual validation.

For a requested merge, respect required checks and repository merge policy.
Do not use an admin bypass, force push, or branch deletion to avoid a normal
failure. Never infer permission to publish a release from permission to merge.

### Verify the outcome

Read the resulting commit, remote branch, PR, or merge state. Confirm the
target contains the intended final patch and any conflict resolutions.
Run the final checks required after integration.

A command that queued a merge or CI job is not proof it completed. Continue
tracking the required job in the current task and report a real blocker if
external state prevents progress.

### Preserve useful work

Keep a PR worktree when feedback or follow-up still needs it. Before cleanup,
check local changes, unpushed commits, non-ignored and needed ignored files,
submodules, and embedded repositories.

Use a host-native archive action when available so recovery and attachments
remain consistent. With plain Git, remove only the exact known worktree
whose contents are preserved and no longer needed. Do not force removal.

Delete a branch or discard work only within explicit authorization and
repository policy. A merged PR alone does not prove every local file is safe
to delete.

## Pitfalls

- Merging a stale branch in a way that reverts newer target changes.
- Committing unrelated user edits or altering their staging.
- Reporting queued CI or merge as complete.
- Assuming a successful push published a release.
- Removing a checkout based only on its directory name.
- Treating cleanup as more important than recovery.

## Verification

Report the concrete commit/PR/merge result, check status, and any retained
worktree. Identify unfinished required steps plainly; do not claim all work
landed until the target and remote state establish that it did.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/finishing-a-development-branch).
The upstream MIT notice is included in `LICENSE`.
