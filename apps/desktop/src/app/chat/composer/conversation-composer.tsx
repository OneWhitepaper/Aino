import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { hermesApi } from '@/api/client'
import { audioTranscribeRequestTimeoutMs } from '@/api/system'
import { blobToDataUrl } from '@/app/session/hooks/use-prompt-actions/utils'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { isSubmitEnter } from '@/lib/ime'
import { $conversationAttachments, uploadConversationAttachment } from '@/store/conversation-attachments'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, setConversationDraft } from '@/store/conversations'
import { $autoSpeakReplies } from '@/store/voice-prefs'

import { createConversationActions } from '../conversation-actions'
import type { ConversationModelSelection } from '../conversation-configuration-actions'

import { DictationButton } from './controls'
import { ConversationPill } from './controls'
import { ConversationApprovalMode } from './conversation-approval-mode'
import { ConversationAttachments } from './conversation-attachments'
import { ConversationModelMenu } from './conversation-model-menu'
import { ConversationSlashSuggestions } from './conversation-slash-suggestions'
import { ConversationVoiceOwner } from './conversation-voice-owner'
import { type ConversationComposerContext, selectConversationExpert } from './expert-selection'
import { ExpertSelector } from './expert-selector'
import { useComposerVoice } from './hooks/use-composer-voice'
import { ComposerContent, ComposerInputSurface, ComposerSurface } from './input-surface'
import { useOwnedVoice } from './owned-voice-context'
import { StartVoiceButton } from './start-voice-button'
import { ProjectContextRow } from './status-stack/coding-row'
import { ComposerSubmitButton } from './submit-button'
import { VoiceActivity } from './voice-activity'
import { VoiceMenu } from './voice-menu'

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

export function ConversationComposer(props: ConversationComposerProps) {
  const key = conversationOwnerKey(props.owner)

  const state = useStore(
    useMemo(
      () =>
        computed([$conversationRuntime, $conversationDrafts], (runtimes, drafts) => ({
          runtime: runtimes[key],
          draft: drafts[key]
        })),
      [key]
    )
  )

  const selected = props.participants.find(item => item.id === state.draft?.selectedParticipantId)

  const generation =
    state.runtime?.snapshot?.participants.find(item => item.participant.participant_id === selected?.id)
      ?.session_generation ?? 1

  return (
    <ConversationVoiceOwner
      generation={generation}
      owner={props.owner}
      participantId={selected?.id ?? ''}
      profile={selected?.sourceLabel ?? 'default'}
    >
      <ConversationComposerBody {...props} />
    </ConversationVoiceOwner>
  )
}

function ConversationComposerBody({
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
  const input = useRef<HTMLDivElement>(null)
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
    const current = $conversationDrafts.get()[key]

    if (current) {
      setConversationDraft(owner, { ...current, text })
    }
  }

  useLayoutEffect(() => {
    const element = input.current

    if (!element) {
      return
    }

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

    if (!home || !surface || !element) {
      return
    }

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
  const ownedVoice = useOwnedVoice()!
  const autoSpeak = useStore($autoSpeakReplies)

  const voice = useComposerVoice({
    busy,
    disabled: unavailable || submitting || !selected,
    sessionId: ownedVoice.key,
    target: `conversation:${ownedVoice.key}`,
    clearDraft: () => {},
    insertText: text => {
      if (!ownedVoice.isCurrent()) {
        return
      }

      const current = $conversationDrafts.get()[key]

      if (current) {
        setConversationDraft(owner, { ...current, text: `${current.text}${current.text ? ' ' : ''}${text}` })
      }
    },
    onInterrupt: async () => {
      const current = $conversationRuntime.get()[key]?.snapshot?.active_turn

      if (current && ownedVoice.isCurrent()) {
        await createConversationActions(owner).stop(current)
      }
    },
    onSubmit: async (text, options) => {
      if (!ownedVoice.isCurrent()) {
        return false
      }

      const current = $conversationDrafts.get()[key]

      if (!current || current.selectedParticipantId !== selected?.id) {
        return false
      }

      setConversationDraft(owner, { ...current, text })
      await createConversationActions(owner).submit(
        options?.voiceContext
          ? { surface: 'voice-live', voice_context: options.voiceContext.slice(0, 6000) }
          : undefined
      )

      return true
    },
    maxRecordingSeconds: 300,
    focusInput: () => input.current?.focus(),
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
        data-home-layout={home ? '' : undefined}
        data-slot="composer-root"
        onDragOver={event => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
          }
        }}
        onDrop={event => {
          if (event.dataTransfer.files.length && !unavailable && !submitting) {
            event.preventDefault()

            for (const file of Array.from(event.dataTransfer.files)) {
              void uploadConversationAttachment(owner, file)
            }
          }
        }}
        onSubmit={event => {
          event.preventDefault()

          if (busy && onStop) {
            onStop()
          } else if (!disabled) {
            onSubmit()
          }
        }}
      >
        {selected && draft && (
          <ConversationSlashSuggestions
            generation={
              runtime?.snapshot?.participants.find(item => item.participant.participant_id === selected.id)
                ?.session_generation ?? 1
            }
            input={input}
            key={JSON.stringify([
              owner,
              selected.id,
              runtime?.snapshot?.participants.find(item => item.participant.participant_id === selected.id)
                ?.session_generation ?? 1
            ])}
            onChange={updateText}
            owner={owner}
            profile={selected.sourceLabel}
            text={draft.text}
          />
        )}
        <ComposerSurface>
          {project && <ProjectContextRow>{project}</ProjectContextRow>}
          <ComposerContent>
            <VoiceActivity state={voice.voiceActivityState} />
            <div ref={attachmentArea}>
              {Boolean(uploads?.length) && (
                <ConversationAttachments disabled={unavailable || submitting} owner={owner} presentation="list" />
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
                  disabled={!draft || unavailable || submitting}
                  onInsertText={text => updateText(`${draft?.text ?? ''}${text}`)}
                  owner={owner}
                  presentation="controls"
                />
                {selected && (
                  <ConversationApprovalMode
                    disabled={busy || submitting || unavailable}
                    key={selected.id}
                    onRefresh={onRefresh}
                    owner={owner}
                    participantId={selected.id}
                    profile={selected.sourceLabel}
                  />
                )}
                <ExpertSelector disabled={voice.voiceConversationActive} owner={owner} participants={participants} />
                <Button
                  aria-label={t.composer.conversation.mention}
                  disabled={voice.voiceConversationActive}
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
                  aria-multiline
                  contentEditable={Boolean(draft)}
                  data-placeholder={t.composer.message}
                  data-slot="composer-rich-input"
                  kind="rich"
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      setMentions(false)
                    }

                    if (isSubmitEnter(event) && !event.shiftKey) {
                      event.preventDefault()

                      if (!disabled) {
                        onSubmit()
                      }
                    }
                  }}
                  onPaste={event => {
                    const files = Array.from(event.clipboardData.files)

                    if (files.length && !unavailable && !submitting) {
                      event.preventDefault()

                      for (const file of files) {
                        void uploadConversationAttachment(owner, file)
                      }
                    }
                  }}
                  ref={input}
                  style={home ? { height: '100%', maxHeight: '100%' } : undefined}
                  suppressContentEditableWarning
                />
              </div>
              <div
                className="flex min-w-0 items-center justify-end gap-(--composer-control-gap) [grid-area:controls]"
                data-slot="composer-trailing-controls"
              >
                {selected && (
                  <ConversationModelMenu
                    disabled={busy || submitting || unavailable}
                    generation={
                      runtime?.snapshot?.participants.find(item => item.participant.participant_id === selected.id)
                        ?.session_generation ?? 1
                    }
                    key={selected.id}
                    model={model ?? undefined}
                    onRefresh={onRefresh}
                    owner={owner}
                    participantId={selected.id}
                    profile={selected.sourceLabel}
                  />
                )}
                {voice.voiceConversationActive ? (
                  <ConversationPill
                    active
                    disabled={false}
                    level={voice.conversation.level}
                    muted={voice.conversation.muted}
                    onEnd={voice.endConversation}
                    onStart={voice.startConversation}
                    onStopTurn={voice.conversation.stopTurn}
                    onToggleMute={voice.conversation.toggleMute}
                    status={voice.conversation.status}
                  />
                ) : (
                  <>
                    <DictationButton
                      disabled={unavailable || submitting}
                      onToggle={voice.dictate}
                      state={voiceState.voice}
                      status={voice.voiceStatus}
                    />
                    <VoiceMenu
                      autoSpeak={autoSpeak}
                      disabled={unavailable}
                      includeDictation={false}
                      onDictate={voice.dictate}
                      onStartConversation={voice.startConversation}
                      onToggleAutoSpeak={voice.handleToggleAutoSpeak}
                      state={voiceState}
                      voiceStatus={voice.voiceStatus}
                    />
                    <StartVoiceButton
                      disabled={unavailable || submitting || busy}
                      label={t.composer.startVoice}
                      onStart={voice.startConversation}
                    />
                  </>
                )}
                {configuration}
                <ComposerSubmitButton disabled={busy ? !onStop : disabled} showStop={busy} />
              </div>
            </div>
            {selected?.unavailableReason && <p role="alert">{selected.unavailableReason}</p>}
          </ComposerContent>
        </ComposerSurface>
      </form>
    </div>
  )
}
