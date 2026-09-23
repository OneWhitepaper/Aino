import { useStore } from '@nanostores/react'

import { useI18n } from '@/i18n'
import { $projectTree, projectIdForCwd } from '@/store/projects'

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
  const projects = useStore($projectTree)
  const projectId = projectIdForCwd(session.cwd, projects)

  const hasProject = Boolean(
    session.storedId && projects.some(project => project.id === projectId && !project.isNoProject)
  )

  const copy = t.summary

  return (
    <aside aria-label={copy.aria} className="min-w-0 p-4" data-slot="summary-pane">
      <h1 className="sr-only">{copy.title}</h1>

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
          showEmpty={!hasProject}
        />
        <PlanSection history={content.todos} session={session} />
        <AgentsSection history={content.delegations} session={session} />
        <BackgroundSection session={session} />
        <SourcesSection items={content.sources} session={session} />
        <EnvironmentSection session={session} />
      </div>
    </aside>
  )
}
