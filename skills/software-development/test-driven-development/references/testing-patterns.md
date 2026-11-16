# Behavior Tests That Survive Refactoring

Read this when a proposed test seems to depend on mocks, private calls,
asynchronous timing, or the implementation's exact shape.

## Test a contract

A strong test names a meaningful input or transition and an observable
result. It continues to pass if the implementation is reorganized without
changing that behavior.

| Weak signal | Stronger signal |
| --- | --- |
| A helper was called | The caller received the required result |
| Source contains a particular token | The public operation enforces the contract |
| An exception was swallowed | The documented error or recovery result occurred |
| An internal list has a particular order | Visible/output order satisfies the requirement |
| Mock returned a canned value | Real code transformed realistic input correctly |

Private invariants can be valid unit-test seams when they are the actual
contract of a focused unit. Do not choose them only because they are easy
to assert.

## Mock the external boundary

Use real code inside the boundary under test. Replace a remote service,
clock, platform API, or unsafe I/O only at its real seam.

- Patch the symbol production actually reads, including late facade imports.
- Give the fake realistic success, error, cancellation, and partial-result
  shapes for the behavior being tested.
- Do not duplicate all production logic inside the fake.
- Assert interactions only when the interaction itself is contractual, such
  as one authorized write or no request after cancellation.

A unit test with a stubbed service may need a separate integration test that
proves the real configuration, import, serialization, and ownership path.

## Keep setup honest

Use existing fixtures for unrelated setup and make important state visible
in the test. Temporary profiles and files should be unique to the test and
cleaned by the harness.

Never use real user storage, production credentials, or a process-global
profile mutation that leaks into other tests. For host-dependent behavior,
run on the actual supported host rather than pretending another OS exists.

## Demonstrate the regression

First run the new test against the broken behavior. Confirm it fails for
the intended reason, not because an import or dependency is missing.

When a patch already exists, use an isolated baseline or carefully remove
only your own change and restore it. Preserve user files and staging.
If baseline execution is impossible, state that limitation rather than
claiming the regression was proven red.

A useful regression tests the complete triggering transition. For example,
a pause/resume bug needs both pause and resume, not just a final render
constructed from an already-correct state.

## Asynchronous and UI assertions

Use bounded condition-based waiting provided by the test harness. Observe
the required stable condition, not a fixed delay. Verify failure and
cancellation release waits and clean up resources.

Use real renderer or device observation for geometry, animation, focus,
native windows, or frame performance. A DOM assertion can establish element
state while still missing flicker or an incorrect position.

## Choose coverage by distinct behavior

One focused regression and one meaningful integration check often protect
a fix better than many implementation assertions. Add cases for different
requirements such as ownership, retry policy, empty input, migration,
recovery, or concurrent state changes.

Do not create tests that merely prove the code was edited, count source
lines, or freeze a detail unrelated to the user-facing contract.
