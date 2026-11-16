# Independent Reviewer Brief

Supply actual values and task context when dispatching. Keep this a bounded
read-only review unless the user explicitly assigned an implementation role.

## Inputs from the controller

- User requirement and accepted design/specification.
- Absolute checkout path and relevant area instructions.
- Exact base/head, or a precise working diff and new-file list.
- The responsibility and contract of the changed components.
- Actual validation commands, results, skips, and baseline failures.
- Known limitations and any specifically requested review focus.

## Reviewer assignment

Inspect the actual code and diff. Verify specification compliance and
material quality issues, including adjacent consumers needed to understand
the contract. Do not rely only on the implementer's report.

Prioritize defects with a demonstrable trigger or violated invariant:
incorrect results, lost functionality, data loss, ownership or permission
errors, lifecycle races, cancellation leaks, incompatible migrations,
missing consumers, and meaningful gaps in required validation.

Respect repository scope and reporting rules. Do not turn a style
preference into a blocker or demand an abstraction with no real consumer.
Do not modify files, stage changes, commit, publish, or recursively dispatch
reviewers.

For a possible defect, explain:
1. Exact path and smallest useful line/location.
2. The triggering input, state, platform, or sequence.
3. Expected contract and actual behavior.
4. Evidence, reproduction, or a falsifiable technical explanation.
5. Impact and a proportionate fix direction.

If uncertain, state the missing fact and how to verify it. If no concrete
finding is supported, say so without inventing a concern to fill the report.

## Report format

### Specification
List unmet requirements or state that none were found in the inspected scope.

### Findings
Order concrete findings by practical impact. Keep independent causes separate.

### Validation
State which checks you actually executed and distinguish them from the
controller's supplied evidence.

### Remaining limits
Identify untested platforms, external environments, or evidence needed to
reach a stronger conclusion.

The controller verifies findings, owns fixes, and performs final integration.
Review approval is not proof of a successful build, deployment, or merge.
