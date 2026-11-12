import { toolMeta } from '@/components/assistant-ui/tool/fallback-model'
import type { Translations } from '@/i18n'
import type { collaborationCopy } from '@/i18n/collaboration-capsule'
import { AlertCircle, CheckCircle2, Network, Square } from '@/lib/icons'
import type { CollaborationGroup, CollaborationTask } from '@/store/collaboration-capsule'

export const taskRunning = (task: CollaborationTask) => task.status === 'running' || task.status === 'queued'

export function collaborationActivity(task: CollaborationTask, thinking: string, queued: string) {
  const last = task.stream.at(-1)

  if (task.status === 'queued') {
    return { text: queued, icon: 'clock' }
  }

  if (last?.kind === 'thinking') {
    return { text: thinking, icon: 'brain' }
  }

  if (task.currentTool) {
    const meta = toolMeta(task.currentTool)

    return { text: meta.pending, icon: meta.icon || 'tools' }
  }

  return { text: last?.text || thinking, icon: last?.kind === 'tool' ? 'tools' : 'brain' }
}

export function collaborationTaskMeta(task: CollaborationTask, now: number, a: Translations['agents']) {
  const running = taskRunning(task)

  const seconds = Math.max(
    0,
    Math.floor(
      running ? (now - task.startedAt) / 1000 : (task.durationSeconds ?? (task.updatedAt - task.startedAt) / 1000)
    )
  )

  const elapsed =
    seconds >= 60 ? a.durationMinutes(Math.floor(seconds / 60), seconds % 60) : a.durationSeconds(String(seconds))

  return [
    task.model,
    elapsed,
    task.toolCount ? a.toolsCount(task.toolCount) : '',
    task.inputTokens || task.outputTokens ? a.tokens(String((task.inputTokens ?? 0) + (task.outputTokens ?? 0))) : '',
    task.costUsd ? `$${task.costUsd.toFixed(3)}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

export function collaborationSummary(
  groups: CollaborationGroup[],
  copy: ReturnType<typeof collaborationCopy>,
  a: Translations['agents']
) {
  const tasks = groups.flatMap(group => group.tasks)
  const live = tasks.filter(taskRunning)
  const failed = tasks.filter(task => task.status === 'failed')
  const stopped = tasks.filter(task => task.status === 'interrupted')
  const liveSources = new Set([...live, ...failed].map(task => task.sourceKey)).size

  const terminalTitle = !tasks.length
    ? copy.title
    : !stopped.length
      ? copy.completed
      : stopped.length === tasks.length
        ? copy.stopped
        : copy.ended

  const title = failed.length
    ? copy.attention(failed.length)
    : live.length
      ? copy.collaborating(live.length)
      : terminalTitle

  const terminalSubtitle = stopped.length ? copy.stoppedHint : tasks.length ? copy.returned : a.emptyDesc

  const liveSubtitle =
    liveSources > 1
      ? copy.sources(liveSources)
      : live[0]
        ? collaborationActivity(live[0], copy.thinking, a.queued).text
        : ''

  const subtitle = failed.length
    ? live.length
      ? copy.otherRunning
      : copy.inspect
    : live.length
      ? liveSubtitle
      : terminalSubtitle

  const Indicator = failed.length ? AlertCircle : live.length ? Network : stopped.length ? Square : CheckCircle2

  return { tasks, live, failed, stopped, title, subtitle, Indicator }
}
