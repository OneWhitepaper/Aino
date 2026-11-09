import { Alert, AlertDescription, Button, Codicon } from '@hermes/plugin-sdk'
import { type ClipboardEvent, type DragEvent, type RefObject, useRef, useState } from 'react'

import { CanonicalGroupNotices, CanonicalGroupWorkingLine, canonicalMemberPhases } from './canonical-group-activity'
import { CanonicalGroupAttachments, type CanonicalGroupUploader } from './canonical-group-attachments'
import { offersGroupMethod, offersGroupSafetyMethod } from './canonical-group-capabilities'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { CanonicalMemberAvatar, useCanonicalMembers } from './canonical-group-members'
import { CanonicalGroupPendingActions } from './canonical-group-pending-actions'
import type { CanonicalGroupSurfaceProps } from './canonical-group-surface'
import type { CanonicalRoomMember } from './canonical-groups'
import { unresolvedGroupMentions } from './group-chat-mentions'
import { GroupMentionInput, type GroupMentionInputHandle } from './group-chat-parts'
import { canonicalMentionRecipients } from './group-mention-recipients'
import { fill, RoomReplyChip } from './group-room-ui'

interface CanonicalGroupComposerProps extends Pick<
  CanonicalGroupSurfaceProps,
  | 'onAbandonRetry' | 'sending' | 'methods' | 'stopping' | 'journalError' | 'notice' | 'sendHint' | 'reply' | 'onCancelReply' | 'onJournalReload'
  | 'binding'
  | 'state'
  | 'events'
  | 'draft'
  | 'attachments'
  | 'restored'
  | 'pending'
  | 'restoredPending'
  | 'busy'
  | 'uploading'
  | 'visible'
  | 'error'
  | 'readError'
  | 'onDraftChange'
  | 'onAttachmentsChange'
  | 'onUploadingChange'
  | 'onAction'
  | 'onRefresh'
  | 'onSend'
  | 'onStop'
> {
  inputRef: RefObject<GroupMentionInputHandle | null>
}

function composerRecipients(draft: string, members: CanonicalRoomMember[], nameFor: (member: CanonicalRoomMember) => string,
  labels: ReturnType<typeof useCanonicalGroupLabels>, pending: boolean, invalidPaste: boolean) {
  const identities = [
    ...members.map(member => ({ handle: member.handle, label: nameFor(member) })),
    { handle: 'everyone', label: labels.allMembers },
    { handle: 'all', label: labels.allMembers }
  ]

  const unresolved = unresolvedGroupMentions(draft, identities)
  const recipients = canonicalMentionRecipients(draft, identities.slice(0, members.length))
  const nameCounts = new Map<string, number>()

  for (const handle of recipients.handles) {
    const label = identities.find(identity => identity.handle === handle)?.label ?? labels.memberGeneric
    nameCounts.set(label, (nameCounts.get(label) ?? 0) + 1)
  }

  const recipientSummary = unresolved.length
    ? labels.pickerLabel
    : recipients.all
      ? `${labels.recipients} ${labels.allMembers}`
      : `${labels.mentionedMembers} ${[...nameCounts].map(([label, count]) => count > 1 ? `${label} ×${count}` : label).join(', ')}`

  const mentionWarning = !pending && unresolved.length
    ? invalidPaste ? labels.pastedMentionReset : labels.unresolvedMention
    : ''

  return { unresolved, recipientSummary, mentionWarning }
}

function canSubmitGroup({ restored, busy, stopping, uploading, state, pending, draft, attachments }: CanonicalGroupComposerProps, unresolved: ReturnType<typeof unresolvedGroupMentions>) {
  return restored &&
    !busy &&
    !stopping &&
    !uploading &&
    !!state?.driver_status &&
    !state?.room.disbanded_at &&
    (pending || (!unresolved.length && (!!draft.trim() || attachments.length > 0)))

}

function CanonicalComposerNotices(props: CanonicalGroupComposerProps) {
  const { readError, error, state, onRefresh } = props
  const labels = useCanonicalGroupLabels()

  return <>
      {(readError || error || (state && !state.driver_status)) && (
        <Alert className="mb-3" variant="warning">
          <Codicon aria-hidden className="mt-0.5 text-(--ui-yellow)" name="warning" />
          <AlertDescription>
            {readError && <p>{readError}</p>}
            {error && <p>{error}</p>}
            {state && !state.driver_status && <p>{labels.driverUnavailable}</p>}
            {readError && (
              <Button className="max-w-full whitespace-normal text-left" onClick={onRefresh} size="sm" variant="ghost">
                {labels.refresh}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <CanonicalGroupNotices error="" journalError={props.journalError ?? ''} labels={labels} notice={props.notice ?? ''}
        onJournalReload={props.onJournalReload ?? onRefresh} onRefresh={onRefresh} readError="" unavailable={false} />
  </>
}

function CanonicalComposerStatus(props: CanonicalGroupComposerProps) {
  const { binding, busy, onAction, onRefresh, state, visible, events, onStop, restoredPending } = props
  const labels = useCanonicalGroupLabels()
  const members = state?.room.members ?? []
  const phases = canonicalMemberPhases(state?.driver_status)

  return <>
    <CanonicalComposerNotices {...props} />
      <CanonicalGroupPendingActions binding={binding} busy={busy} methods={props.methods} onAction={onAction} onRefresh={onRefresh} state={state} visible={visible} />
      <CanonicalGroupWorkingLine
        binding={binding}
        busy={!!props.stopping}
        driver={state?.driver_status ? { ...state.driver_status, working: state.driver_status.working || props.sending || props.stopping } : undefined}
        events={events}
        labels={labels}
        members={members}
        onStop={offersGroupSafetyMethod(props.methods, 'groups.stop') ? onStop : undefined}
        phases={phases}
      />
      {restoredPending && (
        <p className="aino-group-pending-send" role="status">
          {labels.restoredPendingSend}
        </p>
      )}
      {props.pending && props.onAbandonRetry && <Button
        disabled={busy || props.sending || props.stopping}
        onClick={props.onAbandonRetry}
        size="sm"
        type="button"
        variant="ghost"
      >{labels.abandonRetry}</Button>}
      {props.sendHint && <p aria-live="polite" className="aino-group-pending-send">{props.sendHint}</p>}
      {props.reply && <RoomReplyChip cancelLabel={labels.cancelReply} label={fill(labels.replyingTo, { name: props.reply.name })}
        onCancel={() => props.onCancelReply?.()} quote={props.reply.quote} />}
  </>
}

export function CanonicalGroupComposer(props: CanonicalGroupComposerProps) {
  const {
    binding,
    state,
    events,
    draft,
    attachments,
    restored,
    pending,
    restoredPending,
    busy,
    uploading,
    visible,
    error,
    readError,
    onDraftChange,
    onAttachmentsChange,
    onUploadingChange,
    onAction,
    onRefresh,
    onSend,
    onStop,
    inputRef
  } = props

  const labels = useCanonicalGroupLabels()
  const { nameFor } = useCanonicalMembers(binding)
  const uploader = useRef<CanonicalGroupUploader>(null)
  const [invalidPaste, setInvalidPaste] = useState(false)
  const members = state?.room.members ?? []

  const { unresolved, recipientSummary, mentionWarning } = composerRecipients(draft, members, nameFor, labels, pending, invalidPaste)

  const locked = !restored || busy || pending || !!state?.room.disbanded_at

  const canSend = canSubmitGroup(props, unresolved)

  const submit = () => {
    if (canSend) {
      onSend()
    }
  }

  const attachTransfer = (event: ClipboardEvent | DragEvent, data: DataTransfer | null) => {
    const files = [...(data?.files ?? [])]

    if (!files.length) {
      return }

    event.preventDefault()

    if (!locked && offersGroupMethod(props.methods, 'groups.attachment.upload')) {
      uploader.current?.upload(files)
    }
  }

  return (
    <div className="aino-group-composer-zone">
      <CanonicalComposerStatus {...props} />
      <form
        className="aino-group-composer"
        onDragOver={event => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
          }
        }}
        onDrop={event => attachTransfer(event, event.dataTransfer)}
        onPaste={event => attachTransfer(event, event.clipboardData)}
        onSubmit={event => {
          event.preventDefault()
          submit()
        }}
      >
        <CanonicalGroupAttachments
          attachments={attachments}
          binding={binding}
          disabled={locked}
          downloads={offersGroupMethod(props.methods, 'groups.attachment.download')}
          onChange={onAttachmentsChange}
          onUploadingChange={onUploadingChange}
          ref={uploader}
          trigger="none"
          uploads={offersGroupMethod(props.methods, 'groups.attachment.upload')}
        />
        <GroupMentionInput
          appearance="composer"
          aria-label={labels.groupMessage}
          avatarFor={member => {
            const roomMember = members.find(item => item.handle === member.handle)

            return roomMember && <CanonicalMemberAvatar binding={binding} member={roomMember} size={30} />
          }}
          disabled={locked}
          everyoneLabel={labels.allMembers}
          handleFor={member => member.handle}
          members={members.map(member => ({
            name: member.handle,
            handle: member.handle,
            display_name: nameFor(member)
          }))}
          mentionScope={JSON.stringify(['canonical', binding.connectionId, binding.profile, binding.roomId])}
          nameFor={member => member.display_name || member.name}
          onChange={text => {
            setInvalidPaste(false)
            onDraftChange(text)
          }}
          onInvalidMentionPaste={() => setInvalidPaste(true)}
          onSubmitDraft={submit}
          pickerLabel={labels.pickerLabel}
          placeholder={labels.groupPlaceholder}
          ref={inputRef}
          value={draft}
        />
        {mentionWarning && (
          <Alert className="mx-3 mb-2 w-auto" variant="warning">
            <Codicon aria-hidden className="mt-0.5 text-(--ui-yellow)" name="warning" />
            <AlertDescription>{mentionWarning}</AlertDescription>
          </Alert>
        )}
        <div className="aino-group-composer-toolbar">
          <div className="aino-group-composer-tools">
            {offersGroupMethod(props.methods, 'groups.attachment.upload') && (
            <Button
              aria-label={labels.attachFiles}
              disabled={locked || uploading || !offersGroupMethod(props.methods, 'groups.attachment.upload')}
              onClick={() => uploader.current?.pick()}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Codicon name="attach" />
            </Button>
            )}
            <Button
              aria-label={labels.reply}
              disabled={locked}
              onClick={() => inputRef.current?.openMentions()}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Codicon name="mention" />
            </Button>
            <div aria-live="polite" className="aino-group-recipients" title={recipientSummary}>
              <span>{recipientSummary}</span>
            </div>
          </div>
          <Button aria-label={pending ? labels.retry : labels.send} disabled={!canSend} size="icon-send" type="submit">
            <Codicon name={pending ? 'refresh' : 'arrow-up'} />
          </Button>
        </div>
      </form>
      <div className="aino-group-composer-caption">
        <span>{labels.enterSend}</span>
      </div>
    </div>
  )
}
