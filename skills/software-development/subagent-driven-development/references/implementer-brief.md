# Implementer Brief

The controller fills this brief with actual task details. The child should
not need unrelated conversation history or infer neighboring interfaces.

## Controller supplies

- **Goal:** one bounded deliverable and its acceptance condition.
- **Location:** exact repository/worktree path and expected branch.
- **Requirements:** relevant user decisions and specification.
- **Ownership:** exact files/resources this child may edit.
- **Dependencies:** completed producer tasks and exact consumed interfaces.
- **Contracts:** outputs, types, state ownership, errors, cancellation,
  compatibility, migration, and data-preservation rules that apply.
- **Evidence:** reproduction, relevant source paths, current test results.
- **Verification:** supported commands and meaningful behavior checks.
- **Limits:** no unrelated cleanup, publication, or external side effects.

Use these facts in a native `delegate_task` task's `goal` and `context`.
Only use fields advertised by the current schema.

## Implementer's work

1. Read repository and area instructions before editing.
2. Inspect the specified files and required adjacent consumers.
3. Check that the expected interfaces and baseline actually exist.
4. Report a material contradiction before widening the task.
5. For a behavior change, demonstrate a focused regression when appropriate.
6. Extend the existing implementation at its correct seam.
7. Verify the requested behavior and relevant surrounding contracts.
8. Inspect your own diff for unrelated changes and incomplete consumers.
9. Return a factual report with paths and evidence.

Do not overwrite concurrent edits, change another child's ownership,
reconfigure a global profile, or introduce a separate subagent manager.
Use Aino's native child lifecycle. Keep configured model defaults unless
the controller's authorized task explicitly requires a supported override.

Do not commit, push, merge, publish, or delete artifacts just because this
brief describes development work. Follow the controller's actual scope.
If a requested action could include unrelated files or irreversible effects,
complete safe preparation and report the exact dependency.

## Required result

- Status: complete, partial, or blocked by a specific missing dependency.
- What changed and why it satisfies the assigned requirement.
- Exact changed files and any public interface differences.
- Commands actually run, their results, and intended red/green evidence.
- Remaining risks, unresolved decisions, or unavailable acceptance checks.
- Unexpected modifications or partial work that the controller must inspect.

A finished child report is input to review and integration, not a claim
that the entire feature is complete.
