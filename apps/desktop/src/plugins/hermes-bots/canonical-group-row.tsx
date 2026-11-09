import {
  Button,
  Codicon,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  GlyphSpinner,
  haptic,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { $canonicalRoomLive, canonicalRoomLiveKey } from './canonical-group-details'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { CanonicalMemberAvatar } from './canonical-group-members'
import { disbandGatewayGroupRoom, type GatewayGroupRoom } from './canonical-group-registry'
import { useBots } from './i18n'
import { rowAge } from './row-age'

interface CanonicalGroupRowProps {
  active: boolean
  onOpen: () => void
  room: GatewayGroupRoom
}

/** One gateway Group Chat in the Bots roster. Same shape as a Desktop group
 *  row (tile, name, age, member line) so the two kinds read as one list; the
 *  live state is whatever an open view of the room last published. */
export function CanonicalGroupRow({ active, onOpen, room }: CanonicalGroupRowProps) {
  const { t } = useI18n()
  const labels = useCanonicalGroupLabels()
  const { group } = useBots()
  const [confirming, setConfirming] = useState(false)
  const live = useValue($canonicalRoomLive)[canonicalRoomLiveKey(room.binding, room.binding.roomId)]
  const state = live?.needsYou ? 'needsYou' : live?.failed ? 'failed' : live?.working ? 'working' : null
  const memberCount = group.memberCount(room.members.length)

  const open = () => {
    haptic('tap')
    onOpen()
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            aria-current={active || undefined}
            aria-description={memberCount}
            aria-label={room.name}
            className="aino-group-roster-row"
            onClick={open}
            variant="ghost"
          >
            {room.members.length ? (
              <span aria-hidden="true" className="aino-roster-group-avatar">
                {room.members.slice(0, 4).map(member => (
                  <CanonicalMemberAvatar binding={room.binding} key={member.member_id} member={member} size={12} />
                ))}
              </span>
            ) : (
              <span className="aino-group-roster-icon">
                <Codicon name="organization" />
              </span>
            )}
            <span className="aino-roster-group-copy">
              <span className="aino-group-roster-name">{room.name}</span>
              <span className="aino-roster-group-preview">{memberCount}</span>
              {state ? (
                <span
                  className="inline-flex shrink-0 items-center self-center text-[0.6875rem]"
                  data-room-state={state}
                >
                  {state === 'working' ? (
                    <span aria-hidden="true" className="text-(--ui-accent)">
                      <GlyphSpinner />
                    </span>
                  ) : (
                    <Codicon
                      className={state === 'failed' ? 'text-destructive' : 'text-(--ui-accent)'}
                      name={state === 'failed' ? 'error' : 'bell-dot'}
                    />
                  )}
                  <span className="sr-only">
                    {state === 'working'
                      ? labels.rowWorking
                      : state === 'failed'
                        ? labels.rowFailed
                        : labels.rowNeedsYou}
                  </span>
                </span>
              ) : null}
              {room.updatedAt ? (
                <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">
                  {rowAge(room.updatedAt, t.sidebar.row)}
                </span>
              ) : null}
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
              <span className="font-medium text-foreground">{room.name}</span>
              {labels.disbandDescSuffix(room.members.length)}
            </span>
          }
          destructive
          doneLabel={labels.disbandDone}
          onClose={() => setConfirming(false)}
          onConfirm={() => disbandGatewayGroupRoom(room, labels.disbanded(room.name))}
          open
          title={labels.disbandTitle}
        />
      )}
    </>
  )
}
