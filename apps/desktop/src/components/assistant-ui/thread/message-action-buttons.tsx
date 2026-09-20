import type { ReactNode } from 'react'

import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import { CopyButton } from '@/components/ui/copy-button'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { GitForkIcon, RefreshCwIcon } from '@/lib/icons'

export interface MessageActionButtonsProps {
  getMessageText: () => string | Promise<string>
  onBranch?: () => void
  onRegenerate?: () => void
  disabled?: boolean
  readAloud?: ReactNode
  reloadWrapper?: (button: ReactNode) => ReactNode
}

/** The original message verbs; transport and assistant-ui runtime wrappers stay with the owner. */
export function MessageActionButtons({
  getMessageText,
  onBranch,
  onRegenerate,
  disabled,
  readAloud,
  reloadWrapper
}: MessageActionButtonsProps) {
  const copy = useI18n().t.assistant.thread

  const reload = (
    <TooltipIconButton
      disabled={disabled}
      onClick={() => {
        triggerHaptic('submit')
        onRegenerate?.()
      }}
      tooltip={copy.refresh}
    >
      <RefreshCwIcon className="size-3.5" />
    </TooltipIconButton>
  )

  return (
    <>
      {onBranch && (
        <TooltipIconButton
          disabled={disabled}
          onClick={() => {
            triggerHaptic('selection')
            onBranch()
          }}
          tooltip={copy.branchNewChat}
        >
          <GitForkIcon className="size-3.5" />
        </TooltipIconButton>
      )}
      <CopyButton appearance="icon" buttonSize="icon" label={copy.copy} text={getMessageText} />
      {readAloud}
      {reloadWrapper ? reloadWrapper(reload) : onRegenerate ? reload : null}
    </>
  )
}
