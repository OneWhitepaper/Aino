import type { ReadableAtom } from 'nanostores'
import { createContext, useContext } from 'react'

import type { ProfileScope } from '@/api/client'
import type { ChatMessage } from '@/lib/chat-messages'
import type { VoiceChatMode, VoiceLiveStatus } from '@/lib/voice-live'
import type { WakeWordState } from '@/store/wake-word'

/** Optional authority injected into the original voice engines and controls. */
export interface OwnedVoiceContext {
  key: string
  scope: ProfileScope
  playbackScope: (messageId: string) => ProfileScope
  $messages: ReadableAtom<ChatMessage[]>
  status: VoiceLiveStatus | null
  refreshStatus: () => Promise<VoiceLiveStatus | null>
  setMode: (mode: VoiceChatMode) => Promise<unknown>
  wake: WakeWordState
  toggleWake: () => Promise<void>
  pauseWake: () => Promise<void>
  resumeWake: () => Promise<void>
  stopPhrase: string | null
  stopPhrases?: readonly string[]
  thinkingSound: boolean
  isCurrent: () => boolean
}
const Context = createContext<OwnedVoiceContext | null>(null)
export const OwnedVoiceProvider = Context.Provider
export const useOwnedVoice = () => useContext(Context)
