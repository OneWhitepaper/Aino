import { useStore } from '@nanostores/react'
import { useReducedMotion } from 'motion/react'
import { useMemo, useRef } from 'react'

import { useTranscriptWindow } from '@/components/assistant-ui/thread/transcript-window'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { AnimatedInt } from '@/components/ui/diff-count'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { sessionApprovalRequest } from '@/store/prompts'
import {
  $threadJumpButtonVisibleBySession,
  $threadMessagesBelowBySession,
  requestScrollToBottom
} from '@/store/thread-scroll'

import { useComposerSurfaceId } from './composer/scope'

// Attribute-safe selector fragment. jsdom (vitest) does not ship `CSS.escape`.
const cssEscape = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }

  return value.replace(/[^a-zA-Z0-9_:-]/g, ch => `\\${ch}`)
}

// The pending-approval stack renders once per pane, tagged with the owning
// session so a split view can't jump one pane's arrow into a sibling's
// approval. `nearest` keeps this a minimal scroll within the transcript's own
// scroll container instead of an unqualified scrollIntoView, which would also
// nudge any overflow-hidden ancestor's programmatic scroll offset.
function findSessionApprovalStack(sessionId: string | null): HTMLElement | null {
  if (!sessionId) {
    return null
  }

  return document.querySelector<HTMLElement>(`[data-approval-stack][data-session-id="${cssEscape(sessionId)}"]`)
}

interface JumpButtonContentProps {
  count: number
  countLabel: string
  label: string
  sessionId: string | null
  visible: boolean
  visibleApproval: boolean
}

function JumpButtonContent({ count, countLabel, label, sessionId, visible, visibleApproval }: JumpButtonContentProps) {
  const reducedMotion = useReducedMotion()
  const [beforeCount, afterCount] = countLabel ? countLabel.split(String(count)) : ['', '']

  if (visibleApproval || count <= 0) {
    return <span className={visibleApproval ? 'min-w-0 truncate' : 'sr-only'}>{label}</span>
  }

  return (
    <span aria-hidden className="min-w-0 truncate tabular-nums">
      {beforeCount}
      {!visible || reducedMotion ? count : <AnimatedInt key={sessionId} value={count} />}
      {afterCount}
    </span>
  )
}

/**
 * Floating "jump to bottom" control. Sits centered just above the composer,
 * inside the remaining transcript space. The in-flow conversation dock already
 * reduces that space; only overlay composers need measured-height clearance.
 * Visible only while the user has scrolled meaningfully
 * away from the bottom, with an animated count of messages below the viewport.
 * Clicking re-arms sticky-bottom and pins the viewport.
 *
 * While an approval is pending, relabel this control and, instead of jumping
 * to the transcript's true bottom (which can overshoot a mid-transcript
 * approval once newer content lands below it), scroll directly to the
 * session's own approval stack.
 *
 * Enter/exit motion lives in styles.css under `.thread-jump-button`.
 * `idle` (never-shown) stays silent so it can't flash on mount;
 * `in`/`out` only swap once it has actually appeared.
 */
export function ScrollToBottomButton({ sessionId }: { sessionId: string | null }) {
  const { t } = useI18n()
  const surfaceId = useComposerSurfaceId()
  const scrollSessionId = sessionId ?? surfaceId
  const { isHistorical } = useTranscriptWindow()

  const scrollVisible = useStoreSelector($threadJumpButtonVisibleBySession, map =>
    Boolean(scrollSessionId && map[scrollSessionId])
  )

  const count = useStoreSelector($threadMessagesBelowBySession, map =>
    scrollSessionId ? (map[scrollSessionId] ?? 0) : 0
  )

  const visible = isHistorical || scrollVisible
  const request = useStore(useMemo(() => sessionApprovalRequest(sessionId), [sessionId]))
  // Scrolled away while an approval is pending → the inline Run/Reject bar is
  // below the fold. Relabel so the user knows the session needs them, not just
  // that there's more to read.
  const visibleApproval = Boolean(request)
  const hasShownRef = useRef(false)

  if (visible) {
    hasShownRef.current = true
  }

  const state = visible ? 'in' : hasShownRef.current ? 'out' : 'idle'
  const countLabel = count > 0 ? t.sidebar.messageCount(count) : ''

  const label = visibleApproval
    ? t.assistant.approval.jumpToApproval
    : countLabel
      ? `${t.assistant.thread.scrollToBottom} · ${countLabel}`
      : t.assistant.thread.scrollToBottom

  return (
    <Tip label={label}>
      <Button
        aria-hidden={!visible}
        aria-label={label}
        className={cn(
          'thread-jump-button absolute left-1/2 z-20 max-w-[calc(100%_-_1.5rem)] rounded-full text-[length:var(--aino-text-caption)]',
          (visibleApproval || count > 0) && 'px-3',
          visibleApproval && 'text-primary',
          !visible && 'pointer-events-none'
        )}
        data-slot="thread-jump-button"
        data-state={state}
        onClick={() => {
          triggerHaptic('selection')

          const approvalStack = visibleApproval ? findSessionApprovalStack(request?.sessionId ?? null) : null

          if (approvalStack) {
            approvalStack.scrollIntoView({ block: 'nearest' })

            return
          }

          requestScrollToBottom(scrollSessionId)
        }}
        size={visibleApproval || count > 0 ? 'sm' : 'icon-sm'}
        tabIndex={visible ? 0 : -1}
        type="button"
        variant="floating"
      >
        <Codicon name="arrow-down" size="0.875rem" />
        <JumpButtonContent
          count={count}
          countLabel={countLabel}
          label={label}
          sessionId={sessionId}
          visible={visible}
          visibleApproval={visibleApproval}
        />
      </Button>
    </Tip>
  )
}
