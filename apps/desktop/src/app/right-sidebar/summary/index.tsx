import { useStore } from '@nanostores/react'

import { requestComposerFocus } from '@/app/chat/composer/focus'
import { $workspaceMode, $workspaceOwnerLabels, workspaceOwnerTitle } from '@/components/pane-shell/workspace-scope'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { useStoresSelector } from '@/lib/use-session-slice'
import { $botChatScopes } from '@/store/bot-chat-scope'
import { $sessions, sessionMatchesStoredId } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'
import { $summaryOpen } from '@/store/summary'

import { AgentsSection } from './agents-section'
import { BackgroundSection } from './background-section'
import { EnvironmentSection } from './environment-section'
import { OutputsSection } from './outputs-section'
import { PlanSection } from './plan-section'
import { SourcesSection } from './sources-section'
import { useSummaryContent } from './use-summary-content'
import { useSummarySession } from './use-summary-session'

/** Live summary sections inside the window's persistent summary rail. */
export function SummaryPane() {
  const { t } = useI18n()
  const session = useSummarySession()
  const content = useSummaryContent(session)
  const botWorkspace = useStore($workspaceMode) === 'bots'

  const title = useStoresSelector([$sessions, $sessionTiles, $botChatScopes, $workspaceOwnerLabels], () => {
    const storedId = session.storedId
    const row = $sessions.get().find(candidate => storedId && sessionMatchesStoredId(candidate, storedId))

    const scope = storedId
      ? ($sessionTiles.get().find(tile => tile.storedSessionId === storedId) ?? $botChatScopes.get()[storedId])
      : undefined

    return workspaceOwnerTitle(row?.title?.trim() || scope?.workspaceTabTitle || '', scope)
  })

  const copy = t.summary

  return (
    <aside aria-label={copy.aria} className="min-w-0 p-4" data-slot="summary-pane">
      <header data-slot="summary-pane-heading">
        <h1>{copy.title}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={t.common.actions} size="icon-xs" type="button" variant="ghost">
              <Codicon name="ellipsis" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => requestComposerFocus(session.target, { typeChar: '@' })}>
              <Codicon name="add" />
              {copy.sources.add}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => $summaryOpen.set(false)}>{copy.close}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {title && <p data-slot="summary-pane-topic">{title}</p>}
      {botWorkspace && <p data-slot="summary-pane-description">{copy.description}</p>}

      <div
        data-summary-session={session.storedId ?? 'none'}
        key={`${session.scope.connectionId}:${session.scope.profile}:${session.storedId}`}
      >
        <OutputsSection
          error={content.error}
          items={content.outputs}
          loading={content.loading}
          onRetry={() => void content.refetch()}
          session={session}
          showEmpty
          structuredEmpty={botWorkspace}
        />
        <PlanSection history={content.todos} session={session} />
        <AgentsSection history={content.delegations} session={session} />
        <BackgroundSection session={session} />
        <SourcesSection items={content.sources} session={session} showEmpty={botWorkspace} />
        <EnvironmentSection session={session} />
      </div>
      <footer data-slot="summary-pane-footer">{copy.currentSession}</footer>
    </aside>
  )
}
