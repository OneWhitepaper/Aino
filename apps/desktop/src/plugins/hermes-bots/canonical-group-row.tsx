import {
  Button,
  Codicon,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { useCanonicalGroupLabels } from './canonical-group-labels'
import { CanonicalMemberAvatar } from './canonical-group-members'
import type { CanonicalGroupBinding, CanonicalRoomMember } from './canonical-groups'
import { useBots } from './i18n'

interface CanonicalGroupRowProps {
  active?: boolean
  binding?: CanonicalGroupBinding
  members?: CanonicalRoomMember[]
  memberCount: number
  name: string
  /** Rejects with the gateway's refusal so the confirm stays open and shows it. */
  onDelete: () => Promise<void>
  onOpen: () => void
}

/** One gateway Group Chat in the roster list, with the same right-click Open /
 *  Delete a Desktop-local group row has (#143571). */
export function CanonicalGroupRow({
  active = false,
  binding,
  members,
  memberCount,
  name,
  onDelete,
  onOpen
}: CanonicalGroupRowProps) {
  const labels = useCanonicalGroupLabels()
  const { group } = useBots()
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            aria-current={active || undefined}
            aria-description={`${memberCount} ${labels.members}`}
            aria-label={name}
            className="aino-group-roster-row"
            onClick={onOpen}
            variant="ghost"
          >
            {members?.length ? (
              <span aria-hidden="true" className="aino-roster-group-avatar">
                {members.slice(0, 4).map(member => (
                  <CanonicalMemberAvatar binding={binding} key={member.member_id} member={member} size={12} />
                ))}
              </span>
            ) : (
              <span className="aino-group-roster-icon">
                <Codicon name="organization" />
              </span>
            )}
            <span className="aino-roster-group-copy">
              <span className="aino-group-roster-name">{name}</span>
              <span className="aino-roster-group-preview">{group.memberCount(memberCount)}</span>
            </span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onOpen}>{labels.openGroup}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setConfirming(true)} variant="destructive">
            {group.deleteAction}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {confirming && (
        <ConfirmDialog
          busyLabel={labels.disbanding}
          confirmLabel={labels.disband}
          description={
            <span>
              {labels.disbandDescPrefix}
              <span className="font-medium text-foreground">{name}</span>
              {labels.disbandDescSuffix(memberCount)}
            </span>
          }
          destructive
          doneLabel={labels.disbandDone}
          onClose={() => setConfirming(false)}
          onConfirm={onDelete}
          open
          title={labels.disbandTitle}
        />
      )}
    </>
  )
}
