import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { type TodoItem, todoTree } from '@/lib/todos'
import { useSessionSlice, useStoreSelector } from '@/lib/use-session-slice'
import { $goalsBySession } from '@/store/goals'
import { $todosBySession } from '@/store/todos'

import { SummarySection } from './summary-section'
import type { SummarySession } from './use-summary-session'

const TODO_ICONS: Record<TodoItem['status'], string> = {
  pending: 'circle-large-outline',
  in_progress: 'circle-half',
  completed: 'check',
  cancelled: 'circle-slash'
}

export function PlanSection({ history, session }: { history: TodoItem[]; session: SummarySession }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const live = useSessionSlice($todosBySession, session.runtimeId)
  const goal = useStoreSelector($goalsBySession, goals => (session.runtimeId ? goals[session.runtimeId] : undefined))
  const todos = live.length ? live : history
  const tree = todoTree(todos)
  const completed = todos.filter(todo => todo.status === 'completed').length
  const total = todos.filter(todo => todo.status !== 'cancelled').length
  const currentStep = todos.find(todo => todo.status === 'in_progress')

  if (!todos.length && !goal) {
    return null
  }

  return (
    <SummarySection title={t.summary.plan.title}>
      {goal && <p className="mb-2 break-words">{goal.title}</p>}
      {todos.length > 0 && (
        <>
          <Button
            aria-expanded={expanded}
            className="w-full justify-start"
            onClick={() => setExpanded(value => !value)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Codicon name="checklist" />
            <span className="flex-1 text-left">{t.summary.plan.progress(completed, total)}</span>
            <Codicon name={expanded ? 'chevron-down' : 'chevron-right'} />
          </Button>
          {currentStep && (
            <div className="mt-1 grid gap-0.5">
              {!live.length && (
                <span className="text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
                  {t.summary.plan.recorded}
                </span>
              )}
              <div className="flex min-w-0 items-start gap-2 text-[length:var(--aino-text-caption)]">
                <Codicon
                  aria-hidden={false}
                  aria-label={t.summary.plan.status.in_progress}
                  className="mt-0.5 shrink-0 text-(--ui-text-tertiary)"
                  name={TODO_ICONS.in_progress}
                  role="img"
                />
                <span className="min-w-0 break-words">{currentStep.content}</span>
              </div>
            </div>
          )}
          {expanded && (
            <div className="mt-2 grid gap-2">
              {!live.length && (
                <p className="text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
                  {t.summary.plan.recorded}
                </p>
              )}
              {tree.map(([todo, depth]) => (
                <div
                  className="flex min-w-0 items-start gap-2"
                  key={todo.id}
                  style={{ paddingInlineStart: `${Math.min(depth, 3) * 0.75}rem` }}
                >
                  <Codicon
                    aria-hidden={false}
                    aria-label={t.summary.plan.status[todo.status]}
                    className="mt-0.5 shrink-0 text-(--ui-text-tertiary)"
                    name={TODO_ICONS[todo.status]}
                    role="img"
                  />
                  <span className="min-w-0 break-words">{todo.content}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SummarySection>
  )
}
