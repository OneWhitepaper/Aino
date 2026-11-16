# Implementation Plan Template

Use the repository's preferred document location and format. This is a
structure to fill with inspected project facts, not a requirement to create
a document for every small edit.

## Suggested plan structure

```markdown
# Feature implementation plan

## Goal
State the observable outcome and link the accepted design/request.

## Current behavior
Describe the inspected path and the gap this change addresses.

## Constraints
Record exact compatibility, platform, data, permission, dependency,
visual-style, and API requirements relevant to this work.

## Architecture and file ownership
List existing extension points, exact file paths, and each responsibility.
Explain any new unit and why existing code cannot own the behavior.

## Task dependency map
List which task produces each consumed interface.
Mark disjoint work that can run concurrently and shared resources that
must remain sequential.

## Task 1: A reviewable deliverable
- Files: actual create/modify/test paths and existing symbols.
- Consumes: exact input contract, producer, types, and invariants.
- Produces: exact return/event/state contract and later consumers.
- Behavior: concrete success, error, cancellation, and recovery semantics.
- Verification: specific meaningful test or direct check.
- Implementation: concrete approach and critical code where useful.
- Command: the supported project runner and actual target.
- Expected result: observable behavior and pass condition.
- Completion: artifact plus required evidence.

## Integration and acceptance
Map each requirement to an actual task and final check.
Describe migration order, compatibility, data preservation, and recovery
where affected. Distinguish unavailable external/platform checks.

## Execution state
Record current branch/worktree, task status, evidence, and material
decisions in the project's established progress record.

## Final action
State the authorized commit, PR, merge, deploy, release, or handoff scope.
```

## Before handing it over

- Every path is real or explicitly created by a task.
- Every consumed interface has an exact definition and producer.
- No task contradicts the specification or another task.
- Setup and documentation travel with the deliverable that needs them.
- Tests exercise behavior rather than the source text.
- Commands use the project's managed runtime and runner.
- No executable task contains an unresolved placeholder.
- Missing decisions are explicit and block only dependent work.
- Integration checks cover interactions beyond individual task checks.

Continue execution if the user already requested implementation. The
template does not require an extra approval, commit, worktree, or dependency.
