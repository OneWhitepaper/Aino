---
name: using-git-worktrees
description: Isolate branch work without disturbing existing edits.
version: 1.0.0
author: Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [git, worktrees, isolation, branches]
    category: software-development
    related_skills: [executing-plans, finishing-a-development-branch]
---

# Using Git Worktrees Skill

Create or reuse an isolated checkout when the task needs branch separation.
Inspect Git's actual repository relationships first, and preserve the user's
files, staged changes, and existing worktrees.

## When to Use

- New work would conflict with unrelated changes in the current checkout.
- The user requests an independent branch or worktree.
- A baseline comparison or parallel implementation needs a separate checkout.

A suitable existing linked checkout usually needs verification, not another
worktree. Directory naming alone does not prove ownership or isolation.

## Prerequisites

- The requested starting revision and repository/worktree conventions.
- `terminal` with Git and native file tools.
- A supported host worktree integration, if the environment provides one.
- The project's documented runtime and dependency setup instructions.

## How to Run

1. Identify the current repository, checkout, submodule, and worktree state.
2. Reuse a suitable checkout or choose a safe explicit destination.
3. Create the worktree from the correct revision using the supported host
   integration or `git worktree add`.
4. Establish the relevant baseline and use the returned path for all work.

## Quick Reference

Run these Git commands individually through `terminal` as needed:

| Question | Command |
| --- | --- |
| Actual repository root | `git rev-parse --show-toplevel` |
| Checkout metadata | `git rev-parse --git-dir` |
| Shared Git metadata | `git rev-parse --git-common-dir` |
| Parent superproject | `git rev-parse --show-superproject-working-tree` |
| Registered checkouts | `git worktree list --porcelain` |
| Existing user edits | `git status --short --branch` |
| Candidate inside-repo path ignored | `git check-ignore <candidate-path>` |
| Local ref exists | `git rev-parse --verify <ref>^{commit}` |

## Procedure

### Inspect identity and existing state

Read root and relevant area instructions. Confirm the actual root and
whether this is a linked worktree, primary checkout, or submodule.

Use the registered worktree list and current branch to decide whether this
checkout already satisfies the task. Verify local changes and active branch
ownership. A folder named “worktrees” is not proof it is safe to remove.

If the task concerns a submodule, choose the intended repository explicitly.
Do not create a checkout from the superproject merely because its metadata
is nearby. Preserve initialized submodules and embedded repositories.

### Choose a destination and starting point

Follow the user's path and base revision. Otherwise use the repository's
established worktree location and branch convention. Prefer available
host-native worktree support so attachments and paths remain consistent.

For a worktree directory inside the repository, check that its contents will
not be accidentally tracked. If an ignore rule is needed, use a scoped
existing local convention; do not commit an unrelated ignore edit.

Resolve the requested revision before creation. If freshness matters,
fetch the relevant remote ref using existing authorization and compare it.
Do not invent a base branch or assume the current HEAD includes only this
task's changes.

Creating a worktree does not copy uncommitted changes. If the user requested
moving edits, identify the exact hunks and new files first. Transfer only
that work, verify it in the destination, and preserve unrelated changes
and their staging. If edits cannot be separated safely, leave the source
intact and explain the limit.

### Create or reuse the checkout

Use the host's available tool with the explicit source repository and ref.
Otherwise run the appropriate `git worktree add` command through `terminal`
with real destination and branch names.

Do not check out a branch already used by another checkout, force an
operation, or remove metadata to bypass a conflict. Reuse that checkout
when suitable, or choose an independent branch for the authorized task.

On success, confirm the new root, branch, revision, and status. Use the
returned absolute path explicitly in subsequent commands.

### Establish the baseline

Read environment setup instructions in the new checkout. Reuse supported
project-managed dependency commands. Do not install packages, rewrite lock
files, or mutate a shared runtime merely because a generic language file
exists.

Run the relevant baseline checks required for the task. Record actual
failures so later results can distinguish an introduced regression.
Continue independent preparation if unavailable infrastructure limits a check.

## Pitfalls

- Creating a worktree without checking whether one already exists.
- Assuming `git worktree add` carried over uncommitted files.
- Stashing, resetting, or committing user edits to clear the checkout.
- Using a source HEAD that includes unrelated commits as the new base.
- Deleting a checkout because its directory looks temporary.
- Running commands from the old working directory after creation.

## Verification

Confirm the exact source repository, starting revision, branch, and path.
Check that requested edits are present, unrelated work is preserved, and
the relevant baseline is known. Worktree cleanup belongs to the authorized
completion stage after needed contents are safely preserved.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/using-git-worktrees).
The upstream MIT notice is included in `LICENSE`.
