import type { ConversationContentRef } from '@hermes/shared/gateway-events'
import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import type { ChatMessage } from '@/lib/chat-messages'
import { markAssistantIdSpoken } from '@/lib/spoken-reply'
import { fetchVoiceLiveStatus, type VoiceChatMode, type VoiceLiveStatus } from '@/lib/voice-live'
import { stopVoicePlayback } from '@/lib/voice-playback'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime, $foregroundConversationOwner } from '@/store/conversation-runtime'
import { requestGatewayForAgent } from '@/store/gateway'
import { createWakeWordController } from '@/store/wake-word'

import { readConversationContent } from '../conversation-content'

import { type OwnedVoiceContext, OwnedVoiceProvider } from './owned-voice-context'

export function ConversationVoiceOwner({
  owner,
  participantId,
  profile,
  generation,
  children
}: {
  owner: ConversationOwner
  participantId: string
  profile: string
  generation: number
  children: ReactNode
}) {
  const ownerKey = conversationOwnerKey(owner)
  const key = JSON.stringify([ownerKey, participantId, generation])
  const scope = useMemo(() => ({ connectionId: owner.connectionId, profile }), [owner.connectionId, profile])
  const live = useRef(true)
  const currentKey = useRef(key)
  currentKey.current = key

  const isCurrent = () =>
    live.current &&
    currentKey.current === key &&
    Boolean($foregroundConversationOwner.get()) &&
    conversationOwnerKey($foregroundConversationOwner.get()!) === ownerKey

  const request = useMemo(
    () =>
      <T,>(method: string, params?: Record<string, unknown>) =>
        requestGatewayForAgent<T>(owner.connectionId, 'default', method, { ...params, profile }),
    [owner.connectionId, profile]
  )

  const wakeController = useMemo(() => createWakeWordController(request), [request, key])
  const wake = useStore(wakeController.state)
  const [status, setStatus] = useState<VoiceLiveStatus | null>(null)
  const [settings, setSettings] = useState<{ stopPhrases?: string[]; thinkingSound: boolean }>({ thinkingSound: true })
  const $messages = useMemo(() => atom<ChatMessage[]>([]), [key])
  useEffect(() => {
    let cancelled = false
    let baselined = false
    const texts = new Map<string, string>()
    const loading = new Set<string>()

    const project = () => {
      if (cancelled) {
        return
      }
      const state = $conversationRuntime.get()[ownerKey]

      const events = (state?.events ?? []).filter(event =>
        ['conversation.input', 'conversation.response'].includes(event.kind)
      )

      const messages: ChatMessage[] = events.map(event => {
        const reference = event.payload.content_ref as ConversationContentRef | undefined

        if (
          event.payload.content_status === 'referenced' &&
          reference &&
          !texts.has(event.event_id) &&
          !loading.has(event.event_id)
        ) {
          loading.add(event.event_id)
          void readConversationContent(owner, reference)
            .then(bytes => {
              texts.set(event.event_id, new TextDecoder().decode(bytes))
              project()
            })
            .catch(() => undefined)
        }

        const text =
          event.payload.content_status === 'referenced'
            ? (texts.get(event.event_id) ?? '')
            : String(event.payload.text ?? '')

        return {
          id: `${ownerKey}:${event.event_id}`,
          role: event.kind === 'conversation.input' ? 'user' : 'assistant',
          parts: [{ type: 'text', text }],
          timestamp: event.created_at,
          pending: event.payload.status === 'streaming'
        }
      })

      if (!baselined && state?.historyLoaded) {
        const last = messages.findLast(message => message.role === 'assistant')

        if (last) {
          markAssistantIdSpoken(key, messages, last.id)
        }
        baselined = true
      }

      if (state?.historyLoaded) {
        $messages.set(messages)
      }
    }

    const off = $conversationRuntime.subscribe(project)

    return () => {
      cancelled = true
      off()
    }
  }, [ownerKey, $messages])

  const refreshStatus = async () => {
    const next = await fetchVoiceLiveStatus(scope)

    if (isCurrent()) {
      setStatus(next)
    }

    return next
  }

  // eslint-disable-next-line no-restricted-syntax -- lifecycle cancellation flag, not a mirrored reactive value
  useEffect(() => {
    live.current = true
    void refreshStatus().catch(() => undefined)
    void request<{ config?: { voice?: { stop_phrases?: string[]; thinking_sound?: boolean } } }>('config.get', {
      key: 'full'
    })
      .then(result => {
        if (isCurrent()) {
          setSettings({
            stopPhrases: result.config?.voice?.stop_phrases,
            thinkingSound: result.config?.voice?.thinking_sound !== false
          })
        }
      })
      .catch(() => undefined)
    void wakeController.arm()

    return () => {
      live.current = false
      stopVoicePlayback()
      void wakeController.dispose()
    }
  }, [key, wakeController])

  const context: OwnedVoiceContext = {
    key,
    scope,
    playbackScope: messageId => {
      const state = $conversationRuntime.get()[ownerKey]
      const event = state?.events.find(item => `${ownerKey}:${item.event_id}` === messageId)

      const participant = state?.snapshot?.participants.find(
        item => item.participant.participant_id === event?.actor.id
      )?.participant

      if (!participant) {
        throw new Error('Public response author is unavailable')
      }

      return { connectionId: owner.connectionId, profile: participant.profile }
    },
    $messages,
    status,
    refreshStatus,
    setMode: async (mode: VoiceChatMode) => {
      await request('config.set', { key: 'voice.voice_chat_mode', value: mode })
      await refreshStatus()
    },
    wake,
    toggleWake: wakeController.toggle,
    pauseWake: wakeController.pause,
    resumeWake: async () => {
      if (isCurrent()) {
        await wakeController.resume()
      }
    },
    stopPhrase: settings.stopPhrases === undefined ? 'stop' : (settings.stopPhrases[0] ?? null),
    stopPhrases: settings.stopPhrases,
    thinkingSound: settings.thinkingSound,
    isCurrent
  }

  return <OwnedVoiceProvider value={context}>{children}</OwnedVoiceProvider>
}
