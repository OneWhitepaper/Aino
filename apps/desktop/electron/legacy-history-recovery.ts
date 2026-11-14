import { createHash } from 'node:crypto'

import type {
  LegacyHistoryInspection,
  LegacyHistoryReminderInput,
  LegacyHistoryReminderResult,
  LegacyHistoryRestoreInput,
  LegacyHistoryResult
} from '../shared/legacy-history-recovery'
import type { PlatformAccountWindowOwner } from '../shared/platform-contract'

export interface HistoryRecoveryScope {
  sourceHome: string
  targetHome: string
  userData: string
  origin: string
  owner: PlatformAccountWindowOwner
  isCurrent(): boolean
}

interface RecoveryGroup {
  name: string
  batches: Array<Array<{ id: string; messages: unknown[] }>>
}

interface RecoveryPlan {
  planId: string
  groups: RecoveryGroup[]
  conflicts: number
  oversized?: number
  more?: boolean
  remaining?: number
}

interface RecoveryDeps {
  capture(owner: PlatformAccountWindowOwner): HistoryRecoveryScope
  run(input: Record<string, unknown>, scope: HistoryRecoveryScope): Promise<any>
  request(profile: string, path: string, body: unknown, scope: HistoryRecoveryScope): Promise<any>
}

function assertCurrent(scope: HistoryRecoveryScope): void {
  if (!scope.isCurrent()) {
    throw new Error('platform_account_changed')
  }
}

/** Only native main sees legacy payloads; all writes use the existing authenticated importer. */
export function createLegacyHistoryRecovery({ capture, run, request }: RecoveryDeps) {
  let mutating = false
  let inspection: { key: string; promise: Promise<LegacyHistoryInspection> } | null = null

  function helper(scope: HistoryRecoveryScope, action: string, input: Record<string, unknown> = {}) {
    assertCurrent(scope)

    return run(
      {
        action,
        source_home: scope.sourceHome,
        target_home: scope.targetHome,
        user_data: scope.userData,
        owner: { platform_origin: scope.origin, user_id: scope.owner.userId },
        ...input
      },
      scope
    ).then(result => {
      assertCurrent(scope)

      return result
    })
  }

  async function restore(input: LegacyHistoryRestoreInput): Promise<LegacyHistoryResult> {
    const scope = capture(input.expectedOwner)

    if (mutating) {
      throw new Error('history_recovery_busy')
    }

    if (!input.planId || typeof input.includeUnowned !== 'boolean') {
      throw new Error('invalid_platform_input')
    }

    mutating = true

    try {
      if (inspection) {
        await inspection.promise
      }
      assertCurrent(scope)
      const result: LegacyHistoryResult = { imported: 0, skipped: 0, conflicts: 0, profiles: 0 }
      const backedUp = new Set<string>()
      let more = true

      while (more) {
        const plan: RecoveryPlan = await helper(scope, 'prepare', {
          plan_id: input.planId,
          confirm_unowned: input.includeUnowned
        })

        result.conflicts = Math.max(result.conflicts, (plan.conflicts || 0) + (plan.oversized || 0))
        more = plan.more === true
        const before = result.imported + result.skipped

        for (const group of plan.groups) {
          assertCurrent(scope)

          // Create only missing profiles; existing settings, secrets and chats are never replaced.
          if (group.name !== 'default') {
            const listing = await request('default', '/api/profiles', undefined, scope)
            assertCurrent(scope)
            const exists = listing.profiles?.some((profile: { name: string }) => profile.name === group.name)

            if (!exists) {
              await request(
                'default',
                '/api/profiles',
                { name: group.name, clone_from_default: false, no_skills: true },
                scope
              )
              assertCurrent(scope)
              await helper(scope, 'metadata', { plan_id: input.planId, profile: group.name, created_profile: true })
              result.profiles++
            }
          }

          if (!backedUp.has(group.name)) {
            const backup = await helper(scope, 'backup', { profile: group.name, plan_id: input.planId })

            if (backup.backupPath) {
              result.backupPath = backup.backupPath
            }

            backedUp.add(group.name)
          }

          for (const batch of group.batches) {
            assertCurrent(scope)

            const digest = createHash('sha256')
              .update(JSON.stringify([scope.origin, scope.owner.userId, scope.sourceHome, group.name, batch]))
              .digest('hex')

            const receipt = await request(
              group.name,
              '/api/sessions/import',
              {
                profile: group.name,
                request_id: `legacy-history-${digest}`,
                expected_revision: 0,
                sessions: batch
              },
              scope
            )

            assertCurrent(scope)

            if (receipt?.ok !== true || receipt.errors?.length) {
              throw new Error('history_import_failed')
            }

            result.imported += receipt.imported || 0
            result.skipped += receipt.skipped || 0
          }
        }

        if (more && result.imported + result.skipped === before) {
          throw new Error('history_import_failed')
        }
      }

      return result
    } finally {
      mutating = false
    }
  }

  return {
    inspect(owner: PlatformAccountWindowOwner): Promise<LegacyHistoryInspection> {
      const scope = capture(owner)

      if (mutating) {
        throw new Error('history_recovery_busy')
      }

      const key = JSON.stringify(scope.owner)

      if (inspection?.key === key) {
        return inspection.promise
      }
      const previous = inspection?.promise

      const pending = (async () => {
        // Credential readiness can advance the same account's revision while a scan is in flight.
        if (previous) {
          await previous.catch(() => undefined)
        }

        return helper(scope, 'inspect')
      })().finally(() => {
        if (inspection?.promise === pending) {
          inspection = null
        }
      })

      inspection = { key, promise: pending }

      return pending
    },
    restore,
    async remind(input: LegacyHistoryReminderInput): Promise<LegacyHistoryReminderResult> {
      const scope = capture(input.expectedOwner)

      if (mutating) {
        throw new Error('history_recovery_busy')
      }

      if (typeof input.planId !== 'string' || !input.planId || !['later', 'ignore'].includes(input.choice)) {
        throw new Error('invalid_platform_input')
      }

      mutating = true

      try {
        if (inspection) {
          await inspection.promise
        }

        return await helper(scope, 'remind', { plan_id: input.planId, choice: input.choice })
      } finally {
        mutating = false
      }
    }
  }
}
