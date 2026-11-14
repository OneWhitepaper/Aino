import type { PlatformAccountWindowOwner } from './platform-contract'

/** Native inspection exposes counts only; no foreign account's message content crosses IPC. */
export interface LegacyHistoryInspection {
  planId: string
  owned: number
  unowned: number
  foreign: number
  conflicts: number
  profiles: number
  pending: number
  reminderKey: string
  showReminder: boolean
  snoozedUntil: number | null
}

export interface LegacyHistoryReminderInput {
  expectedOwner: PlatformAccountWindowOwner
  planId: string
  choice: 'later' | 'ignore'
}

export interface LegacyHistoryReminderResult {
  ok: true
  reminderKey: string
  showReminder: boolean
  snoozedUntil: number | null
}

export interface LegacyHistoryRestoreInput {
  expectedOwner: PlatformAccountWindowOwner
  planId: string
  includeUnowned: boolean
}

export interface LegacyHistoryResult {
  imported: number
  skipped: number
  conflicts: number
  profiles: number
  backupPath?: string
}

export interface LegacyHistoryBridge {
  inspect(expectedOwner: PlatformAccountWindowOwner): Promise<LegacyHistoryInspection>
  restore(input: LegacyHistoryRestoreInput): Promise<LegacyHistoryResult>
  remind(input: LegacyHistoryReminderInput): Promise<LegacyHistoryReminderResult>
}
