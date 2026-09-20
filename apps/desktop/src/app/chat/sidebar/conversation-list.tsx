import type { ConversationProjectRef, ConversationRecord, ConversationResult } from '@hermes/shared/gateway-events'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { cacheConversation } from '@/store/conversations'
import { requestGatewayForAgent } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { sessionOwnerRouteFromRow } from '@/store/session-request-router'

import { exportConversation } from '../conversation-export'

import { SidebarRowBody, SidebarRowLabel, SidebarRowShell } from './chrome'
import { SessionActionsMenu } from './session-actions-menu'

export interface ConversationListRow {
  kind: 'conversation'
  owner: ConversationOwner
  record: ConversationRecord
}
export interface LegacySessionListRow {
  kind: 'legacy_session'
  connectionId: string
  profile: string
  session: SessionInfo
}
export type OrdinaryChatRow = ConversationListRow | LegacySessionListRow

export function ordinaryRowKey(row: OrdinaryChatRow): string {
  return row.kind === 'conversation'
    ? `conversation:${conversationOwnerKey(row.owner)}`
    : JSON.stringify(['legacy_session', row.connectionId, row.profile, row.session.id])
}

export function legacyOrdinaryRow(session: SessionInfo): LegacySessionListRow | null {
  const owner = sessionOwnerRouteFromRow(session)

  return owner ? { kind: 'legacy_session', ...owner, session } : null
}

export function openOrdinaryRow(
  row: OrdinaryChatRow,
  actions: {
    conversation: (owner: ConversationOwner) => void
    legacy: (session: SessionInfo) => void
  }
): void {
  if (row.kind === 'conversation') {
    actions.conversation(row.owner)
  } else {
    actions.legacy(row.session)
  }
}

/** Conversation rows share the original sidebar primitives; legacy rows retain their complete existing actions. */
export function ConversationList({
  rows,
  selected,
  onOpen,
  onRefresh
}: {
  rows: ConversationListRow[]
  selected: ConversationOwner | null
  onOpen: (owner: ConversationOwner) => void
  onRefresh?: () => void
}) {
  return (
    <>
      {rows.map(row => (
        <SidebarRowShell key={ordinaryRowKey(row)}>
          <SidebarRowBody
            aria-current={
              selected && conversationOwnerKey(selected) === conversationOwnerKey(row.owner) ? 'page' : undefined
            }
            onClick={() => onOpen(row.owner)}
            title={`${row.record.title} · ${row.owner.connectionId}`}
          >
            <SidebarRowLabel>{row.record.title}</SidebarRowLabel>
            <span className="truncate text-xs text-(--ui-text-tertiary)">{row.owner.connectionId}</span>
          </SidebarRowBody>
          <ConversationMetadataMenu onRefresh={onRefresh} row={row} />
        </SidebarRowShell>
      ))}
    </>
  )
}

export function conversationForLegacy(
  rows: readonly ConversationListRow[],
  session: SessionInfo
): ConversationListRow | undefined {
  const source = legacyOrdinaryRow(session)

  if (!source) {
    return undefined
  }

  return rows.find(row => {
    const receipt = row.record.migration

    return (
      row.owner.connectionId === source.connectionId &&
      receipt?.status === 'complete' &&
      receipt.source_profile === source.profile &&
      [receipt.source_lineage_id, ...(receipt.source_session_ids ?? [])].includes(session.id)
    )
  })
}

export function conversationMatchesProject(
  row: ConversationListRow,
  project: {
    connectionId: string
    source: ConversationProjectRef
    project?: { sources: ConversationProjectRef[] }
  } | null
): boolean {
  if (!project) {
    return true
  }
  const current = row.record.project

  return (
    row.owner.connectionId === project.connectionId &&
    current !== null &&
    (project.project?.sources ?? [project.source]).some(
      source =>
        current.install_id === source.install_id &&
        current.project_id === source.project_id &&
        current.registration_profile === source.registration_profile &&
        current.execution_environment_id === source.execution_environment_id
    )
  )
}

/** Captures the row owner and revision; rejected writes never retarget or silently retry. */
function ConversationMetadataMenu({ row, onRefresh }: { row: ConversationListRow; onRefresh?: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)

  async function mutate(method: 'conversations.rename' | 'conversations.archive', title?: string) {
    setBusy(true)

    try {
      const result = await requestGatewayForAgent<ConversationResult>(row.owner.connectionId, 'default', method, {
        conversation_id: row.owner.conversationId,
        expected_revision: row.record.revision,
        ...(title === undefined ? {} : { title })
      })

      cacheConversation(row.owner, result.conversation)
    } finally {
      setBusy(false)
      onRefresh?.()
    }
  }

  return (
    <SessionActionsMenu
      metadata={{
        rename: title => mutate('conversations.rename', title),
        export: () => {
          void exportConversation(row.owner).catch(error => notifyError(error, t.errors.genericFailure))
        },
        disabled: busy || row.record.archived
      }}
      onArchive={
        row.record.archived
          ? undefined
          : () => {
              void mutate('conversations.archive').catch(error => notifyError(error, t.desktop.archiveFailed))
            }
      }
      sessionId={row.owner.conversationId}
      title={row.record.title}
    >
      <Button aria-label={t.sidebar.row.sessionActions} className="size-5 shrink-0" size="icon" variant="ghost">
        <Codicon name="kebab-vertical" size="0.875rem" />
      </Button>
    </SessionActionsMenu>
  )
}
