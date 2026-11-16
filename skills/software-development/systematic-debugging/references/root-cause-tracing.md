# Trace the First Incorrect State

Use this reference when the reported exception is downstream from the actual
defect, data crosses several processes, or timing makes the failure elusive.

## Trace backward from the symptom

1. Record the exact failing operation, inputs, error, and expected result.
2. Read the immediate caller. Identify where it obtained the bad value.
3. Continue to the first place that created or changed that value.
4. Check the owning contract at that point: who may write it, which profile
   or account owns it, and what lifecycle makes it valid or stale.
5. Reproduce that transition through the real public boundary.

A stack trace often ends at a database, renderer, or filesystem call that
correctly rejects invalid state. Changing the last frame can hide the original
mistake while leaving every other consumer exposed.

## Observe each boundary once

For a request crossing UI → IPC → service → storage, capture at each seam:

| Observation | Useful evidence |
| --- | --- |
| Target identity | Session/profile/tab/request identifier |
| Input | Relevant data shape and validated value |
| Ownership | Which process, account, scope, or lifecycle owns it |
| Transition | When and why state changed |
| Output | Success, error, cancellation, and returned identifier |

Use narrow temporary instrumentation with redacted data. Never log raw
credentials, complete secrets, or user content merely to correlate events.
A request identifier and the fields relevant to the hypothesis are usually
enough. Remove probes once they stop answering a useful question.

## Compare a working sibling

Find the closest path that does work. Read its full setup and lifecycle,
not just the successful line. List meaningful differences before changing
anything: identity binding, initialization, options, timing, cleanup,
persistence, event routing, and error handling.

A copied function may rely on state established by a different owner.
Reuse its contract only when the caller can actually satisfy it.

## Investigate shared-state pollution

If a test passes alone but fails in a suite:

1. Confirm order sensitivity and preserve the failing order.
2. Reduce the preceding group while retaining the failure.
3. Inspect the transition introduced by the smallest preceding group.
4. Check files, caches, environment, current directory, registries,
   singleton state, monkeypatch lifetime, and fixture scope.
5. Repair ownership or cleanup at the responsible boundary.

Use the supported runner and isolated temporary state. Do not run exploratory
halves against real profile directories or add a universal reset that breaks
the persistence contract.

## Wait for conditions, not guesses

For asynchronous behavior, observe a meaningful condition: a request has
completed, an element has reached its expected state, a result has arrived,
or a task was cancelled. Use the test harness's bounded waiting facilities.

Choose a timeout from the operation's contract, capture the last observed
state when it expires, and ensure cancellation and failure also terminate
the wait. A fixed sleep can make a flaky test slower without making it true.

## Repair the right layer

Fix the earliest incorrect transition that the component owns. Add boundary
validation where the public contract requires it, but do not scatter
redundant checks through internal code that already guarantees an invariant.

A migration, compatibility boundary, or untrusted input may legitimately need
several protections. Explain which different risk each protection handles.
Do not replace root-cause repair with broad exception swallowing.

## Close the investigation

Demonstrate the original red scenario and final green behavior. Check sibling
paths sharing the faulty ownership pattern, not every unrelated subsystem.
Keep the report focused on the cause, changed contract, and actual evidence.
