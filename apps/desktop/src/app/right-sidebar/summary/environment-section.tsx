import { useStore } from '@nanostores/react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import type { Translations } from '@/i18n/types'
import { $projectTree, projectIdForCwd } from '@/store/projects'
import { $connection, $gatewayState } from '@/store/session'
import { $toolSessionBranch, $toolSessionModel, $toolSessionProvider } from '@/store/tool-session'

import { ChangesSection } from './changes-section'
import { GitSection } from './git-section'
import { formatSummaryPath, summaryEnvironmentState } from './summary-data'
import { SummarySection, SummaryValue } from './summary-section'
import { type SummarySession, summarySessionIsCurrent } from './use-summary-session'

function connectionLabel(state: string, copy: Translations['shell']['statusbar']): string {
  if (state === 'open') {
    return copy.gatewayReady
  }

  if (state === 'connecting') {
    return copy.gatewayConnecting
  }

  if (state === 'checking') {
    return copy.gatewayChecking
  }

  if (state === 'reconnecting' || state === 'restarting') {
    return copy.gatewayRestarting
  }

  if (state === 'idle') {
    return copy.gatewayOffline
  }

  return copy.gatewayUnavailable
}

export function EnvironmentSection({ session }: { session: SummarySession }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const connection = useStore($connection)
  const { cwd, storedId: selectedSession } = session
  const model = useStore($toolSessionModel).trim()
  const provider = useStore($toolSessionProvider).trim()
  const branch = useStore($toolSessionBranch).trim()
  const gatewayState = useStore($gatewayState)
  const projects = useStore($projectTree)
  const projectId = projectIdForCwd(cwd, projects)
  const projectName = projects.find(project => project.id === projectId && !project.isNoProject)?.label ?? null
  const state = summaryEnvironmentState({ cwd, cwdOwner: selectedSession, projectName, selectedSession })
  const current = summarySessionIsCurrent(session)
  const copy = t.summary.environment

  if (state.kind !== 'ready') {
    return null
  }

  return (
    <SummarySection headingHidden title={copy.title}>
      <div className="grid gap-1.5">
        <Button
          aria-controls={detailsId}
          aria-expanded={expanded}
          aria-label={`${copy.title} · ${state.projectName}`}
          className="min-w-0 justify-start text-left"
          data-slot="summary-resource-row"
          onClick={() => setExpanded(value => !value)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="folder" />
          <span className="min-w-0 flex-1 truncate">
            {copy.title} · <span>{state.projectName}</span>
          </span>
          <Codicon aria-hidden name={expanded ? 'chevron-down' : 'chevron-right'} size="0.75rem" />
        </Button>
        {expanded && (
          <div id={detailsId}>
            <SummaryValue label={copy.workingDirectory} value={formatSummaryPath(state.cwd)} />
            <SummaryValue label={copy.profile} value={session.scope.profile} />
            {current && (
              <>
                <SummaryValue label={copy.model} value={model || t.shell.statusbar.noModel} />
                <SummaryValue label={copy.provider} value={provider || t.shell.statusbar.modelNone} />
                {branch && <SummaryValue label={copy.branch} value={branch} />}
                <SummaryValue
                  label={copy.connection}
                  value={`${connection?.mode === 'remote' ? copy.remote : copy.local} · ${connectionLabel(gatewayState, t.shell.statusbar)}`}
                />
              </>
            )}
            <GitSection embedded session={session} />
            <ChangesSection embedded session={session} />
          </div>
        )}
      </div>
    </SummarySection>
  )
}
