import type { GroupActivityEntry } from './group-activity'

/** A later settled event cannot hide an unresolved member failure. */
export function legacyGroupActivitySummary(activityEvents: GroupActivityEntry[], running: boolean) {
  const latestActivity = activityEvents.length ? activityEvents[activityEvents.length - 1] : null
  // A later "settled" event must not hide a member that failed to answer.
  // Successful completion for that member clears its unresolved warning.
  const unresolvedFailures = new Map<string, GroupActivityEntry>()

  for (const event of activityEvents) {
    const key = event.member || ''

    if (event.kind === 'failed' || event.kind === 'timed-out') {
      unresolvedFailures.delete(key)
      unresolvedFailures.set(key, event)
    } else if (event.kind === 'replied' || event.kind === 'passed' || event.kind === 'delivered') {
      unresolvedFailures.delete(key)
    }
  }

  const summaryActivity =
    !running && unresolvedFailures.size ? [...unresolvedFailures.values()].at(-1)! : latestActivity

  return { latestActivity, summaryActivity }
}
