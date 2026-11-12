import { useId, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { SubagentAvatar } from '@/components/ui/subagent-avatar'
import { useI18n } from '@/i18n'
import { collaborationCopy } from '@/i18n/collaboration-capsule'
import { AlertCircle, Check, ChevronDown, Square } from '@/lib/icons'
import type { CollaborationGroup, CollaborationTask } from '@/store/collaboration-capsule'

import { collaborationActivity, taskRunning } from './collaboration-presentation'
import { CollaborationTaskDetail } from './collaboration-task-detail'

export function CollaborationAvatar({ task, className }: { task: CollaborationTask; className?: string }) {
  return (
    <SubagentAvatar className={className} parentSessionId={task.storedSessionId || task.parentRuntimeId} task={task} />
  )
}

export function CollaborationTaskRow({
  task,
  group,
  now
}: {
  task: CollaborationTask
  group: CollaborationGroup
  now: number
}) {
  const { t, locale } = useI18n()
  const copy = collaborationCopy(locale)
  const detailId = useId()
  const [expanded, setExpanded] = useState(false)
  const running = taskRunning(task)

  const status = {
    running: t.agents.running,
    queued: t.agents.queued,
    completed: t.agents.done,
    failed: copy.needsAttention,
    interrupted: copy.taskStopped
  }[task.status]

  const activity = collaborationActivity(task, copy.thinking, t.agents.queued)

  return (
    <article className={`cc-task${expanded ? ' expanded' : ''}`} data-collaboration-task={task.id}>
      <button
        aria-controls={detailId}
        aria-expanded={expanded}
        className="cc-task-button"
        onClick={() => setExpanded(value => !value)}
        type="button"
      >
        <CollaborationAvatar className="cc-task-avatar" task={task} />
        <span className="cc-task-copy">
          <span className="cc-task-name">{task.displayName}</span>
          <span className="cc-task-action">
            {running ? (
              <Codicon className="cc-icon" name={activity.icon} />
            ) : task.status === 'failed' ? (
              <AlertCircle className="cc-icon" />
            ) : task.status === 'interrupted' ? (
              <Square className="cc-icon" />
            ) : (
              <Check className="cc-icon" />
            )}
            <span>{running ? activity.text : task.summary || status}</span>
          </span>
        </span>
        <span className="cc-task-right" data-state={task.status}>
          {task.status === 'completed' && <Check className="cc-icon" />}
          {status}
          <ChevronDown className="cc-icon cc-chevron" />
        </span>
      </button>
      <CollaborationTaskDetail detailId={detailId} expanded={expanded} group={group} now={now} task={task} />
    </article>
  )
}
