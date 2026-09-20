import { ProjectContextRow } from './status-stack/coding-row'
import { ConversationApprovalMode } from './conversation-approval-mode'
import { hermesApi } from '@/api/client'
import { audioTranscribeRequestTimeoutMs } from '@/api/system'
import { blobToDataUrl } from '@/app/session/hooks/use-prompt-actions/utils'
import { DictationButton } from './controls'
import { VoiceMenu } from './voice-menu'
import { useVoiceRecorder } from './hooks/use-voice-recorder'
import { VoiceActivity } from './voice-activity'
import { ConversationModelMenu } from './conversation-model-menu'
import type { ConversationModelSelection } from '../conversation-configuration-actions'
import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { isSubmitEnter } from '@/lib/ime'
import { $conversationAttachments, uploadConversationAttachment } from '@/store/conversation-attachments'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, setConversationDraft } from '@/store/conversations'

import { ConversationAttachments } from './conversation-attachments'
import { type ConversationComposerContext, selectConversationExpert } from './expert-selection'
import { ExpertSelector } from './expert-selector'
import { ComposerContent, ComposerInputSurface, ComposerSurface } from './input-surface'
import { ComposerSubmitButton } from './submit-button'

export interface ConversationComposerProps extends ConversationComposerContext {
  busy: boolean
  submitting: boolean
  unavailable: boolean
  onSubmit: () => void
  onStop?: () => void
  onRefresh: (participantId: string, generation: number, selection?: ConversationModelSelection) => Promise<unknown>
  project?: ReactNode
  configuration?: ReactNode
  notices?: ReactNode
  home?: boolean
}

export function ConversationComposer({
  owner,
  participants,
  busy,
  submitting,
  unavailable,
  onSubmit,
  onStop,
  onRefresh,
  project,
  configuration,
  notices,
  home
}: ConversationComposerProps) {
  const { t } = useI18n()
  const key = conversationOwnerKey(owner)
  const draft = useStore(useMemo(() => computed($conversationDrafts, rows => rows[key]), [key]))
  const model = useStore(
    useMemo(
      () =>
        computed(
          [$conversationRuntime, $conversationDrafts],
          (runtimes, drafts) => runtimes[key]?.runtimes[drafts[key]?.selectedParticipantId ?? '']?.model_snapshot
        ),
      [key]
    )
  )
  const runtime = useStore(useMemo(() => computed($conversationRuntime, rows => rows[key]), [key]))
  const uploads = useStore(useMemo(() => computed($conversationAttachments, rows => rows[key]), [key]))
  const [mentions, setMentions] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const attachmentArea = useRef<HTMLDivElement>(null)
  const selected = participants.find(option => option.id === draft?.selectedParticipantId)
  const disabled =
    !draft ||
    unavailable ||
    !selected ||
    Boolean(selected.unavailableReason) ||
    submitting ||
    busy ||
    Boolean(uploads?.some(item => item.status !== 'ready')) ||
    (!draft.text.trim() && draft.attachmentIds.length === 0)
  const updateText = (text: string) => {
    if (draft) setConversationDraft(owner, { ...draft, text })
  }

  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    if (home) {
      element.style.height = '100%'
      return
    }
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [draft?.text, home])
  useLayoutEffect(() => {
    const element = attachmentArea.current
    const surface = input.current?.closest<HTMLElement>('[data-chat-surface]')
    if (!home || !surface || !element) return
    const resize = () =>
      surface.style.setProperty(
        '--aino-home-composer-height',
        `calc(10.28125rem + ${element.getBoundingClientRect().height}px)`
      )
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => {
      observer.disconnect()
      surface.style.removeProperty('--aino-home-composer-height')
    }
  }, [home, uploads?.length])
  const voice = useVoiceRecorder({
    maxRecordingSeconds: 300,
    focusInput: () => input.current?.focus(),
    onTranscript: text => {
      const current = $conversationDrafts.get()[key]
      if (current) setConversationDraft(owner, { ...current, text: `${current.text}${current.text ? ' ' : ''}${text}` })
    },
    onTranscribeAudio: async audio => {
      const dataUrl = await blobToDataUrl(audio)
      const result = await hermesApi<{ transcript?: string; text?: string }>({
        connectionId: owner.connectionId,
        profile: selected?.sourceLabel,
        path: '/api/audio/transcribe',
        method: 'POST',
        body: { data_url: dataUrl, mime_type: audio.type },
        timeoutMs: audioTranscribeRequestTimeoutMs(dataUrl)
      })
      return result.text ?? result.transcript ?? ''
    }
  })
  const voiceState = {
    tools: { enabled: !unavailable, label: t.composer.attach },
    model: { model: model?.model ?? '', provider: model?.provider ?? '', canSwitch: false },
    voice: { active: voice.voiceStatus !== 'idle', enabled: !unavailable }
  }
  return (
    <div
      className="absolute bottom-0 left-1/2 z-30 flex max-w-full -translate-x-1/2 flex-col"
      data-slot="composer-dock"
    >
      {notices}
      <form
        className="group/composer relative w-full overflow-visible rounded-2xl"
        data-slot="composer-root"
        data-home-layout={home ? '' : undefined}
        onDragOver={event => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={event => {
          if (event.dataTransfer.files.length && !unavailable && !submitting) {
            event.preventDefault()
            for (const file of Array.from(event.dataTransfer.files)) void uploadConversationAttachment(owner, file)
          }
        }}
        onSubmit={event => {
          event.preventDefault()
          if (busy && onStop) onStop()
          else if (!disabled) onSubmit()
        }}
      >
        <ComposerSurface>
          {project && <ProjectContextRow>{project}</ProjectContextRow>}
          <ComposerContent>
            <VoiceActivity state={voice.voiceActivityState} />
            <div ref={attachmentArea}>
              {Boolean(uploads?.length) && (
                <ConversationAttachments presentation="list" disabled={unavailable || submitting} owner={owner} />
              )}
            </div>
            {mentions && (
              <div aria-label={t.composer.expertSelector.choose} className="max-h-48 overflow-auto" role="listbox">
                {participants.map(option => (
                  <button
                    aria-selected={option.id === draft?.selectedParticipantId}
                    className="block w-full px-3 py-2 text-left disabled:opacity-50"
                    disabled={Boolean(option.unavailableReason)}
                    key={option.id}
                    onClick={() => {
                      selectConversationExpert({ owner, participants }, option.id)
                      setMentions(false)
                    }}
                    role="option"
                    type="button"
                  >
                    {option.displayName} · {option.sourceLabel}
                  </button>
                ))}
              </div>
            )}
            <div
              className="grid w-full grid-cols-[auto_1fr] gap-(--composer-row-gap) [grid-template-areas:'input_input'_'menu_controls']"
              data-slot="composer-layout"
            >
              <div
                className="flex items-center gap-(--composer-control-gap) [grid-area:menu]"
                data-slot="composer-leading-controls"
              >
                <ConversationAttachments
                  presentation="controls"
                  disabled={!draft || unavailable || submitting}
                  owner={owner}
                  onInsertText={text => updateText(`${draft?.text ?? ''}${text}`)}
                />
                {selected && (
                  <ConversationApprovalMode
                    key={selected.id}
                    owner={owner}
                    participantId={selected.id}
                    profile={selected.sourceLabel}
                    disabled={busy || submitting || unavailable}
                    onRefresh={onRefresh}
                  />
                )}
                <ExpertSelector owner={owner} participants={participants} disabled={voice.voiceStatus !== 'idle'} />
                <Button
                  disabled={voice.voiceStatus !== 'idle'}
                  aria-label={t.composer.conversation.mention}
                  onClick={() => setMentions(value => !value)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  @
                </Button>
              </div>
              <div className="min-h-0 min-w-0 overflow-hidden [grid-area:input]" data-slot="composer-input-cell">
                <ComposerInputSurface
                  kind="plain"
                  ref={input}
                  data-slot="composer-rich-input"
                  disabled={!draft}
                  onPaste={event => {
                    const files = Array.from(event.clipboardData.files)
                    if (files.length && !unavailable && !submitting) {
                      event.preventDefault()
                      for (const file of files) void uploadConversationAttachment(owner, file)
                    }
                  }}
                  rows={2}
                  style={home ? { height: '100%', maxHeight: '100%' } : undefined}
                  placeholder={t.composer.message}
                  onChange={event => {
                    updateText(event.target.value)
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Escape') setMentions(false)
                    if (isSubmitEnter(event) && !event.shiftKey) {
                      event.preventDefault()
                      if (!disabled) onSubmit()
                    }
                  }}
                  value={draft?.text ?? ''}
                />
              </div>
              <div
                className="flex min-w-0 items-center justify-end gap-(--composer-control-gap) [grid-area:controls]"
                data-slot="composer-trailing-controls"
              >
                {selected && (
                  <ConversationModelMenu
                    key={selected.id}
                    owner={owner}
                    participantId={selected.id}
                    profile={selected.sourceLabel}
                    generation={
                      runtime?.snapshot?.participants.find(item => item.participant.participant_id === selected.id)
                        ?.session_generation ?? 1
                    }
                    model={model ?? undefined}
                    disabled={busy || submitting || unavailable}
                    onRefresh={onRefresh}
                  />
                )}
                <DictationButton
                  disabled={unavailable || submitting}
                  onToggle={voice.dictate}
                  state={voiceState.voice}
                  status={voice.voiceStatus}
                />
                <VoiceMenu
                  autoSpeak={false}
                  liveFeatures={false}
                  disabled={unavailable}
                  includeDictation={false}
                  state={voiceState}
                  voiceStatus={voice.voiceStatus}
                  onDictate={voice.dictate}
                  onStartConversation={() => {}}
                  onToggleAutoSpeak={() => {}}
                />
                {configuration}
                <ComposerSubmitButton showStop={busy} disabled={busy ? !onStop : disabled} />
              </div>
            </div>
            {selected?.unavailableReason && <p role="alert">{selected.unavailableReason}</p>}
          </ComposerContent>
        </ComposerSurface>
      </form>
    </div>
  )
}
