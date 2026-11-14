import { IntroCopy } from '@/components/onboarding/first-run/intro-copy'
import { isMainWindow } from '@/store/windows'

import { LegacyHistoryRecoveryPrompt } from '../account/legacy-history-recovery'

interface PrimaryChatPromptsProps {
  isPrimary: boolean
  setupChat: boolean
  showChatBar: boolean
}

export function PrimaryChatPrompts({ isPrimary, setupChat, showChatBar }: PrimaryChatPromptsProps) {
  if (!isPrimary || !isMainWindow()) {
    return null
  }

  return (
    <>
      <IntroCopy />
      {!setupChat && showChatBar && <LegacyHistoryRecoveryPrompt />}
    </>
  )
}
