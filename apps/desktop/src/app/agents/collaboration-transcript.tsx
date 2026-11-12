import { useState } from 'react'

import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { useI18n } from '@/i18n'
import type { CollaborationTask } from '@/store/collaboration-capsule'

import { SubagentTranscript } from '../chat/composer/status-stack/subagent-transcript'

/** The existing tail reader stays opt-in and never polls a collapsed capsule. */
export function CollaborationTranscript({ task, expanded }: { task: CollaborationTask; expanded: boolean }) {
  const { t } = useI18n()
  const visible = usePaneVisible()
  const [open, setOpen] = useState(false)

  if (!task.canControl) {
    return null
  }

  return (
    <details className="cc-transcript" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cc-text-button">{t.agents.extendedTranscript}</summary>
      {open && expanded && visible && <SubagentTranscript sessionId={task.parentRuntimeId} subagentId={task.id} />}
    </details>
  )
}
