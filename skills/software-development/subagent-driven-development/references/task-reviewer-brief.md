# Task Reviewer Brief

The controller supplies the task's specification, exact checkout, changed
files or revision range, global constraints, and check evidence.
The review is read-only and bounded to this deliverable plus necessary
adjacent consumers.

## Specification compliance

Inspect the actual code against each acceptance condition:

- The requested behavior exists through the intended public path.
- Inputs and outputs match the agreed producer/consumer interfaces.
- Required compatibility and data-preservation behavior remain intact.
- No requested feature was disabled to make the test pass.
- The implementer did not add unrelated scope or a second implementation
  where an existing extension point should have been used.

## Code quality and behavior

Assess the actual change's ownership, lifecycle, error, cancellation,
concurrency, persistence, and platform behavior where relevant.
Check focused tests for realistic behavior rather than mocks or source
assertions that bypass the reported defect.

Read enough neighboring code to verify the contract. Distinguish actual
defects from preferences and pre-existing unrelated issues. A finding
needs a concrete location, trigger, violated expectation, and evidence
or a falsifiable explanation.

Do not edit files, commit, publish, or dispatch another reviewer. The
controller owns repair and any broad whole-change review.

## Return

- Specification gaps, or none found within the reviewed scope.
- Material quality findings ordered by impact.
- Exact paths and locations, trigger, expected/actual behavior, and evidence.
- Checks actually executed, separate from supplied implementer evidence.
- Remaining limits and whether they prevent accepting this deliverable.

For a re-review, inspect the repair and its affected contract. Do not
silently expand into an unrelated audit. If a new material defect appears,
report it with the same evidence standard.
