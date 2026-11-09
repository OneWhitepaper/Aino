import {
  Button,
  Codicon,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@hermes/plugin-sdk'
import { type ReactNode, useState } from 'react'

import { type CanonicalDriverActivity, type CanonicalMemberPhase, canonicalMemberStatus } from './canonical-group-activity'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { CanonicalGroupAvatarStack, CanonicalMemberAvatar, useCanonicalMembers } from './canonical-group-members'
import type { CanonicalGroupBinding, CanonicalRoom, CanonicalRoomMember } from './canonical-groups'

interface CanonicalGroupHeaderProps {
  /** The host already names a main conversation; its content header is a compact toolbar. */
  mainTab?: boolean
  available?: boolean
  binding?: CanonicalGroupBinding
  busy: boolean
  canStop: boolean
  infoOpen?: boolean
  infoPanelId?: string
  onBack?: () => void
  onDisband: () => Promise<void>
  onInfoOpenChange?: (open: boolean) => void
  onMention?: (member: CanonicalRoomMember) => void
  onRename: (name: string) => void
  onSearch?: () => void
  onStop: () => void
  phases: Map<string, CanonicalMemberPhase>
  room?: CanonicalRoom
}

/** The message surface keeps only navigation and observation in its header.
 * Group management lives beside the conversation in CanonicalGroupInfo. */
export function CanonicalGroupHeader({
  available = true,
  binding,
  busy,
  canStop,
  infoOpen = false,
  infoPanelId = 'aino-group-info-title-panel',
  mainTab = false,
  onBack,
  onInfoOpenChange,
  onMention,
  onSearch,
  room
}: CanonicalGroupHeaderProps) {
  const labels = useCanonicalGroupLabels()
  const { nameFor } = useCanonicalMembers(binding)
  const members = room?.members ?? []

  const state = room?.disbanded_at
    ? labels.roomDisbanded
    : !available
      ? labels.serviceUnavailable
      : canStop
        ? labels.groupWorking
        : labels.ready

  return (
    <header className="aino-group-header" data-main-tab={mainTab || undefined}>
      {onBack && (
        <Button aria-label={labels.back} onClick={onBack} size="icon-sm" variant="ghost">
          <Codicon name="arrow-left" />
        </Button>
      )}
      <div className="aino-group-heading">
        {!mainTab && <h2>{room?.name || labels.loadingGroup}</h2>}
        <div className="aino-group-participants">
          {members.slice(0, 3).map(member => (
            <Button
              aria-label={`${labels.reply} ${nameFor(member)}`}
              className="aino-group-participant"
              disabled={!onMention || !!room?.disbanded_at}
              key={member.member_id}
              onClick={() => onMention?.(member)}
              size="sm"
              variant="ghost"
            >
              <CanonicalMemberAvatar binding={binding} member={member} size={24} />
              <span>{nameFor(member)}</span>
            </Button>
          ))}
          {members.length > 3 && (
            <Button aria-label={labels.members} onClick={() => onInfoOpenChange?.(true)} size="sm" variant="ghost">
              +{members.length - 3}
            </Button>
          )}
          <p aria-live="polite" className="aino-group-presence">
            <span className="sr-only">
              {members.length} {labels.members}
              <span aria-hidden="true"> · </span>
            </span>
            {state}
          </p>
        </div>
      </div>
      <div className="aino-group-header-actions">
        {onSearch && (
          <Button aria-label={labels.searchMessages} onClick={onSearch} size="icon-sm" variant="ghost">
            <Codicon name="search" />
          </Button>
        )}
        {onInfoOpenChange && (
          <Button
            aria-controls={infoPanelId}
            aria-expanded={infoOpen}
            className="aino-group-info-toggle"
            disabled={busy && !room}
            onClick={() => onInfoOpenChange(!infoOpen)}
            variant="ghost"
          >
            <Codicon name="organization" />
            <span>{labels.groupInfo}</span>
          </Button>
        )}
      </div>
    </header>
  )
}

interface CanonicalGroupInfoProps {
  available?: boolean
  visible?: boolean
  binding?: CanonicalGroupBinding
  busy: boolean
  files?: ReactNode
  id?: string
  onClose: () => void
  onDisband: () => Promise<void>
  onMention?: (member: CanonicalRoomMember) => void
  onRename: (name: string) => void
  phases: Map<string, CanonicalMemberPhase>
  driver?: CanonicalDriverActivity
  renderPane?: (content: ReactNode, managing: boolean) => ReactNode
  room?: CanonicalRoom
}

/** In a narrow conversation the workspace places this same content in the
 * shared Dialog primitive, so Escape, focus trapping and focus return stay native. */
export function CanonicalGroupInfo({
  available = true,
  visible = true,
  binding,
  busy,
  driver,
  files,
  id = 'aino-group-info-title',
  onClose,
  onDisband,
  onMention,
  onRename,
  phases,
  renderPane,
  room
}: CanonicalGroupInfoProps) {
  const labels = useCanonicalGroupLabels()
  const { nameFor } = useCanonicalMembers(binding)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)
  const [section, setSection] = useState('members')
  const members = room?.members ?? []

  const rename = (name: string) => {
    setRenaming(null)

    if (name) {
      onRename(name)
    }
  }

  const pane = (
    <aside aria-labelledby={id} className="aino-group-info" id={`${id}-panel`}>
      <header className="aino-group-info-heading">
        <h2 id={id}>{labels.groupInfo}</h2>
        <Button aria-label={labels.close} onClick={onClose} size="icon-sm" variant="ghost">
          <Codicon name="close" />
        </Button>
      </header>
      <div className="aino-group-info-scroll">
        <div className="aino-group-info-name">
          <CanonicalGroupAvatarStack binding={binding} members={members} />
          <div>
            <h3>{room?.name || labels.loadingGroup}</h3>
            <p>
              {members.length} {labels.members}
            </p>
          </div>
        </div>
        <Tabs className="aino-group-info-tabs" onValueChange={setSection} value={section}>
          <TabsList aria-label={labels.groupInfo} className="aino-group-info-tab-list" size="navigation">
            <TabsTrigger size="navigation" value="members">
              {labels.members}
            </TabsTrigger>
            <TabsTrigger size="navigation" value="files">
              {labels.groupFiles}
            </TabsTrigger>
            <TabsTrigger size="navigation" value="manage">
              {labels.manageGroup}
            </TabsTrigger>
          </TabsList>
          <TabsContent forceMount hidden={section !== 'members'} value="members">
            <section className="aino-group-info-section">
              <div className="aino-group-info-section-heading">
                <h3>{labels.members}</h3>
                <span>{members.length}</span>
              </div>
              <ul aria-label={labels.members} className="aino-group-member-list">
                {members.map(member => {
                  const phase = phases.get(member.member_id)
                  const status = canonicalMemberStatus(member.member_id, phase, driver, labels)
                  const name = nameFor(member)

                  return (
                    <li className="aino-group-info-member" data-phase={status?.phase || 'idle'} key={member.member_id}>
                      <CanonicalMemberAvatar binding={binding} member={member} />
                      <div className="aino-group-member-copy">
                        <span className="aino-group-member-name">{name}</span>
                        <span className="aino-group-member-phase">
                          {status?.label ?? (available ? labels.ready : labels.memberUnavailable)}
                        </span>
                      </div>
                      {onMention && (
                        <Button
                          aria-label={`${labels.reply} ${name}`}
                          disabled={!room || !!room.disbanded_at}
                          onClick={() => onMention(member)}
                          size="sm"
                          variant="ghost"
                        >
                          <Codicon name="mention" />
                          <span>{labels.reply}</span>
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
              <p className="aino-group-info-tip">{labels.modelsHint}</p>
            </section>
          </TabsContent>
          <TabsContent forceMount hidden={section !== 'files'} value="files">
            <section className="aino-group-info-section">
              <h3 className="aino-group-info-section-title">{labels.groupFiles}</h3>
              {files || (
                <div className="aino-group-files-empty">
                  <Codicon name="files" />
                  <p>{labels.noFiles}</p>
                </div>
              )}
            </section>
          </TabsContent>
          <TabsContent forceMount hidden={section !== 'manage'} value="manage">
            <section className="aino-group-info-section">
              <Button
                className="aino-group-info-action"
                disabled={busy || !room || !!room.disbanded_at}
                onClick={() => setRenaming(room?.name ?? '')}
                variant="ghost"
              >
                <Codicon name="edit" />
                <span>{labels.rename}</span>
                <Codicon name="chevron-right" />
              </Button>
              <details className="aino-group-info-details">
                <summary>
                  <Codicon name="info" />
                  <span>{labels.technicalDetails}</span>
                  <Codicon name="chevron-down" />
                </summary>
                <div className="aino-group-info-detail-content">
                  <p className="aino-group-info-identifier">{binding?.roomId || room?.room_id}</p>
                  <ul>
                    {members.map(member => (
                      <li className="aino-group-info-identifier" key={member.member_id}>
                        <span>{nameFor(member)}</span>
                        <code>@{member.handle}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
              <Button
                className="aino-group-info-action aino-group-info-disband"
                disabled={busy || !room || !!room.disbanded_at}
                onClick={() => setEnding(true)}
                variant="ghost"
              >
                <Codicon name="trash" />
                <span>{labels.disband}</span>
                <Codicon name="chevron-right" />
              </Button>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  )

  return (
    <>
      {renderPane ? renderPane(pane, renaming !== null || ending) : pane}
      <Dialog
        onOpenChange={open => {
          if (!open) {
            setRenaming(null)
          }
        }}
        open={visible && renaming !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.rename}</DialogTitle>
          </DialogHeader>
          <form
            className="aino-group-rename-form"
            onSubmit={event => {
              event.preventDefault()
              rename(renaming?.trim() ?? '')
            }}
          >
            <Input
              aria-label={labels.renameLabel}
              autoFocus
              onChange={event => setRenaming(event.target.value)}
              value={renaming ?? ''}
            />
            <div className="aino-group-dialog-actions">
              <Button onClick={() => setRenaming(null)} type="button" variant="ghost">
                {labels.cancel}
              </Button>
              <Button disabled={busy || !renaming?.trim()} type="submit">
                {labels.save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {ending && (
        <ConfirmDialog
          busyLabel={labels.disbanding}
          confirmLabel={labels.disband}
          description={
            <span>
              {labels.disbandDescPrefix}
              <span className="font-medium text-foreground">{room?.name}</span>
              {labels.disbandDescSuffix(members.length)}
            </span>
          }
          destructive
          doneLabel={labels.disbandDone}
          onClose={() => setEnding(false)}
          onConfirm={onDisband}
          open={visible}
          title={labels.disbandTitle}
        />
      )}
    </>
  )
}
