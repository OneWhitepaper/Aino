import { useStore } from '@nanostores/react'
import { useId, useState } from 'react'

import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
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
  const botWorkspace = useStore($workspaceMode) === 'bots'
  const [expanded, setExpanded] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const currentId = useId()
  const historyId = useId()
  const live = useSessionSlice($todosBySession, session.runtimeId)
  const goal = useStoreSelector($goalsBySession, goals => (session.runtimeId ? goals[session.runtimeId] : undefined))
  const todos = live.length ? live : history
  const tree = todoTree(todos)
  const currentTree = tree.filter(([todo]) => todo.status === 'pending' || todo.status === 'in_progress')
  const historyTree = tree.filter(([todo]) => todo.status === 'completed' || todo.status === 'cancelled')
  const visibleTree = botWorkspace ? tree : currentTree
  const completed = todos.filter(todo => todo.status === 'completed').length
  const total = todos.filter(todo => todo.status !== 'cancelled').length

  if (!todos.length && !goal) {
    return null
  }

  const renderRows = (items: typeof tree) =>
    items.map(([todo, depth]) => (
      <div
        className="flex min-w-0 items-start gap-2"
        data-slot="summary-plan-row"
        data-status={todo.status}
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
    ))

  return (
    <SummarySection
      action={
        todos.length > 0 && (
          <span aria-label={t.summary.plan.progress(completed, total)} data-slot="summary-plan-progress">
            {completed} / {total}
          </span>
        )
      }
      title={t.summary.plan.title}
    >
      {goal && <p className="mb-2 break-words">{goal.title}</p>}
      {todos.length > 0 && (
        <>
          {!botWorkspace && !live.length && currentTree.length > 0 && (
            <p className="mb-2 text-(--ui-text-tertiary)" data-slot="summary-row-status">
              {t.summary.plan.recorded}
            </p>
          )}
          <div className="grid gap-2" id={currentId}>
            {renderRows(expanded ? visibleTree : visibleTree.slice(0, 4))}
          </div>
          {visibleTree.length > 4 && (
            <Button
              aria-controls={currentId}
              aria-expanded={expanded}
              className="mt-2"
              onClick={() => setExpanded(value => !value)}
              size="inline"
              type="button"
              variant="text"
            >
              {expanded ? t.summary.state.showLess : t.summary.state.showAll(visibleTree.length)}
            </Button>
          )}
          {!botWorkspace && historyTree.length > 0 && (
            <div data-slot="summary-history">
              <Button
                aria-controls={historyId}
                aria-expanded={historyExpanded}
                className="w-full justify-start"
                data-slot="summary-disclosure"
                onClick={() => setHistoryExpanded(value => !value)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Codicon aria-hidden name={historyExpanded ? 'chevron-down' : 'chevron-right'} />
                {t.summary.plan.history(historyTree.length)}
              </Button>
              {historyExpanded && (
                <div className="grid gap-2" id={historyId}>
                  {renderRows(historyTree)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </SummarySection>
  )
}
