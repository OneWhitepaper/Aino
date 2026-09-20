import { Button, SearchField, useI18n } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { CreateAgentDialog } from './create-dialog'
import { annotateBotSource, botRosterKey, botSourceStatus, useRoster } from './data'
import { EditProfileDialog } from './edit-profile-dialog'
import { displayName, rosterConnectionLabel } from './labels'
import type { RosterRow } from './types'

/** Configuration consumes the same source-owned editors as the roster menu. */
export function AgentHubConfiguration() {
  const { t } = useI18n()
  const { data, error, isLoading, refetch } = useRoster()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<RosterRow | null>(null)
  const [creating, setCreating] = useState(false)
  const roster = (data?.profiles ?? []).map(row => annotateBotSource(row, data?.sources ?? []))

  return (
    <>
      <div className="flex items-center gap-2">
        <SearchField onChange={setQuery} placeholder={t.profiles.search} value={query} />
        <Button onClick={() => setCreating(true)}>{t.profiles.newProfile}</Button>
      </div>
      {error && <Button onClick={() => void refetch()}>{t.common.retry}</Button>}
      {isLoading && <p role="status">{t.profiles.loading}</p>}
      <div className="mt-4 flex flex-col gap-1">
        {roster
          .filter(row =>
            `${displayName(row)} ${row.name} ${rosterConnectionLabel(row)}`.toLowerCase().includes(query.toLowerCase())
          )
          .map(row => (
            <Button
              className="justify-between"
              disabled={!botSourceStatus(row).available}
              key={botRosterKey(row)}
              onClick={() => setEditing(row)}
              variant="ghost"
            >
              <span>{displayName(row)}</span>
              <span className="text-xs text-(--ui-text-secondary)">
                {rosterConnectionLabel(row)} · {row.targetProfile || row.name}
              </span>
            </Button>
          ))}
      </div>
      <EditProfileDialog
        bot={editing}
        onClose={() => {
          setEditing(null)
          void refetch()
        }}
        open={Boolean(editing)}
      />
      <CreateAgentDialog
        onClose={() => {
          setCreating(false)
          void refetch()
        }}
        open={creating}
        roster={roster}
      />
    </>
  )
}
