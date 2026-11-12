import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { collaborationCopy } from '@/i18n/collaboration-capsule'
import { ArrowRight, RefreshCw } from '@/lib/icons'
import {
  type CollaborationGroup,
  type CollaborationTask,
  interruptCollaborationTask,
  steerCollaborationTask
} from '@/store/collaboration-capsule'
import { $collaborationCapsuleOpen } from '@/store/collaboration-capsule-view'

import { openCollaborationTask, prepareCollaborationRetry } from './collaboration-navigation'
import { collaborationTaskMeta, taskRunning } from './collaboration-presentation'
import { CollaborationTranscript } from './collaboration-transcript'

interface CollaborationTaskDetailProps {
  task: CollaborationTask
  group: CollaborationGroup
  now: number
  expanded: boolean
  detailId: string
}

export function CollaborationTaskDetail({ task, group, now, expanded, detailId }: CollaborationTaskDetailProps) {
  const { t, locale } = useI18n()
  const copy = collaborationCopy(locale)
  const navigate = useNavigate()
  const [instructing, setInstructing] = useState(false)
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [failed, setFailed] = useState(false)
  const running = taskRunning(task)
  const meta = collaborationTaskMeta(task, now, t.agents)

  const act = async (action: 'stop' | 'steer' | 'retry') => {
    setPending(true)
    setFeedback('')
    setFailed(false)

    try {
      if (action === 'retry') {
        if (!(await prepareCollaborationRetry(task, navigate))) {
          throw new Error('unavailable')
        }

        setFeedback(copy.retryPrepared)
      } else if (action === 'stop') {
        await interruptCollaborationTask(task)
        setFeedback(t.agents.stopRequested)
      } else {
        await steerCollaborationTask(task, text)
        setText('')
        setInstructing(false)
        setFeedback(t.agents.steerQueued)
      }
    } catch {
      setFailed(true)
      setFeedback(action === 'retry' ? copy.unavailable : t.agents.requestRejected)
    } finally {
      setPending(false)
    }
  }

  const openSession = async () => {
    if (pending) {
      return
    }

    setPending(true)
    setFeedback('')
    setFailed(false)

    try {
      if (!(await openCollaborationTask(task))) {
        throw new Error('unavailable')
      }

      $collaborationCapsuleOpen.set(false)
    } catch {
      setFailed(true)
      setFeedback(copy.unavailable)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="cc-task-detail" hidden={!expanded} id={detailId}>
      <p className="cc-task-goal">{task.goal}</p>
      <ol className="cc-event-list">
        {task.stream.slice(-10).map((entry, index) => (
          <li key={`${entry.at}:${entry.kind}:${index}`}>
            <time>{new Date(entry.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
      {task.status === 'failed' && task.summary && <p className="cc-error-message">{task.summary}</p>}
      {Boolean(task.filesRead.length || task.filesWritten.length) && (
        <div className="cc-file-list">
          {[...task.filesWritten, ...task.filesRead].map(file => (
            <p key={file}>{file}</p>
          ))}
        </div>
      )}
      <div className="cc-detail-meta">{meta}</div>
      <div className="cc-detail-actions">
        <Button
          className="cc-small-button"
          disabled={pending}
          onClick={() => void openSession()}
          size="xs"
          variant="secondary"
        >
          {copy.openSession}
          <ArrowRight className="cc-icon" />
        </Button>
        {task.status === 'failed' && !group.roomBinding ? (
          <Button
            className="cc-small-button"
            disabled={pending}
            onClick={() => void act('retry')}
            size="xs"
            variant="secondary"
          >
            <RefreshCw className="cc-icon" />
            {copy.retry}
          </Button>
        ) : running && task.canControl ? (
          <Button
            className="cc-text-button cc-danger-button"
            disabled={pending}
            onClick={() => void act('stop')}
            size="inline"
            variant="text"
          >
            {copy.stop}
          </Button>
        ) : null}
      </div>
      {running && task.canControl && (
        <Button
          className="cc-text-button cc-instruction-toggle"
          onClick={() => setInstructing(value => !value)}
          size="inline"
          variant="text"
        >
          {copy.addInstruction}
        </Button>
      )}
      {running && !task.canControl && <p className="cc-detail-meta">{copy.readOnly}</p>}
      {running && instructing && (
        <form
          className="cc-steer-form"
          onSubmit={event => {
            event.preventDefault()

            if (text.trim()) {
              void act('steer')
            }
          }}
        >
          <Input
            aria-label={t.agents.steerPlaceholder}
            disabled={pending}
            onChange={event => setText(event.target.value)}
            placeholder={t.agents.steerPlaceholder}
            value={text}
          />
          <Button disabled={pending || !text.trim()} size="xs" type="submit" variant="secondary">
            {t.agents.steer}
          </Button>
        </form>
      )}
      {feedback && (
        <p className={failed ? 'cc-error-message' : 'cc-detail-meta'} role={failed ? 'alert' : 'status'}>
          {feedback}
        </p>
      )}
      <CollaborationTranscript expanded={expanded} task={task} />
    </div>
  )
}
