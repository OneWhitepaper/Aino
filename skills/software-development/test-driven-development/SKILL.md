---
name: test-driven-development
description: Build behavior with a verified red-green-refactor loop.
version: 1.2.0
author: Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [testing, tdd, regression, behavior-contracts]
    category: software-development
    related_skills: [systematic-debugging, verification-before-completion]
---

# Test-Driven Development Skill

Write a focused behavior test, observe its intended failure, and implement
only enough to make it pass. Specify externally meaningful behavior rather
than preserve the current shape of the code.

## When to Use

- Adding a behavior, fixing a reproducible bug, or changing a contract.
- Refactoring logic whose behavior needs protection.
- Repairing a boundary involving state, configuration, security, or I/O.

Choose verification proportional to the change. A reversible visual tweak
or prose edit may need direct inspection instead of a fabricated unit test;
follow the user's and repository's explicit testing requirements.

## Prerequisites

- A clear acceptance condition and the code path responsible for it.
- The project-managed runtime, fixtures, and required test command.
- Native `read_file`, `search_files`, `patch`, and `terminal` tools.
- Temporary state that cannot touch real accounts or user data.

## How to Run

1. Select one observable behavior and write its smallest useful test.
2. Run it and confirm failure for the intended missing or broken behavior.
3. Implement the minimal coherent fix and rerun the test.
4. Refactor with the tests green, then run relevant integration checks.

Read [references/testing-patterns.md](references/testing-patterns.md) when
choosing mocks, regression seams, or asynchronous assertions.

## Quick Reference

| Stage | Question | Exit condition |
| --- | --- | --- |
| Red | Does the check detect the required behavior? | Expected failure observed |
| Green | What is the smallest correct implementation? | Focused test passes |
| Refactor | Can structure improve without changing behavior? | Checks still pass |
| Integrate | Does the surrounding product still work? | Integration evidence |

## Procedure

### Red: specify the behavior

Choose a name describing the input or transition and expected result.
Arrange realistic state, call the public boundary, and assert the outcome
a caller or user depends on. Keep unrelated setup in existing fixtures.

For a bug, reproduce the actual failing sequence. A regression that starts
after the broken transition cannot prove the transition was repaired.

Use real code inside the boundary under test. Mock only dependencies that
are nondeterministic, expensive, unsafe, or outside the contract. Avoid
asserting private calls merely because the implementation uses them.

Run the specific test through the supported runner. Read the failure and
exit status. Syntax errors, missing packages, broken fixtures, and an
unrelated exception do not establish the intended red state.

If the new test passes immediately, check whether the behavior already
exists, the assertions are meaningful, or setup bypassed the failing path.
Do not change an expectation merely to obtain a failure.

### Green: implement one contract

Apply the smallest change that satisfies the behavior and preserves the
public contract. Prefer extending a shared implementation to creating an
alternate path that only the test reaches.

Run the focused test. If it fails, use its evidence to correct the
implementation. Do not weaken the expected behavior or add production
branches that detect test inputs.

Add edge cases when they define distinct requirements: empty input,
ownership, cancellation, retries, recovery, or concurrent transitions.
Keep each assertion connected to the requested behavior.

If production work already exists, preserve user changes. Where feasible,
demonstrate red in an isolated baseline checkout or by temporarily
reverting only your own patch, then restore it exactly. Never delete
unrelated work to perform the exercise.

### Refactor: improve structure with coverage

Once green, remove duplication, improve names, and clarify responsibilities.
Rerun focused tests after each meaningful change.

Test helpers should simplify setup without concealing behavior.
Production abstractions need real consumers; a test is not justification
for an otherwise unused manager or wrapper.

### Integrate: cover the real boundary

Run the relevant suite and project-required checks. Configuration,
persistence, identity, and I/O changes often need real imports and a
temporary isolated data directory beyond mocked unit tests.

For UI behavior, verify interactions in the real renderer or supported
harness, including affected loading, empty, error, and recovery states.
Static assertions cannot prove geometry or responsiveness.

## Pitfalls

- A test added afterward without showing it catches the original bug.
- Testing the mock, source text, or implementation structure.
- Catching every exception and asserting that none escaped.
- Depending on real user storage, live credentials, or wall-clock sleeps.
- Adding redundant tests instead of one strong behavior contract.
- Treating all failures as new without checking the baseline.

## Verification

Keep evidence of the intended red result and final green result. State
which behavior each test protects and which integration checks passed.
A test that was not executed is a proposed check, not evidence.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/test-driven-development).
The upstream MIT notice is included in `LICENSE`.
