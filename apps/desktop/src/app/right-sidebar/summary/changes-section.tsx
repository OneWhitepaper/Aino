import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DiffCount } from '@/components/ui/diff-count'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { desktopGit } from '@/lib/desktop-git'
import { Code } from '@/lib/icons'
import { notifyError } from '@/store/notifications'
import { $projectTree, projectIdForCwd } from '@/store/projects'
import {
  requestRevert,
  revealReview,
  reviewFilesForCwd,
  selectReviewFile,
  stageReviewFile,
  unstageReviewFile
} from '@/store/review'
import { $workspaceChangeTick } from '@/store/workspace-events'

import { summarizeReviewFiles } from './git-summary'
import { SummarySection } from './summary-section'
import { type SummarySession, summarySessionIsCurrent } from './use-summary-session'

export function ChangesSection({ embedded = false, session }: { embedded?: boolean; session: SummarySession }) {
  const { t } = useI18n()
  const cwd = session.cwd.trim()
  const selectedSessionId = session.storedId
  const { connectionId: connection, profile } = session.scope
  const projects = useStore($projectTree)
  const workspaceTick = useStore($workspaceChangeTick)
  const [mutationBusy, setMutationBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const copy = t.summary.changes
  const projectId = projectIdForCwd(cwd, projects)
  const hasProject = projects.some(project => project.id === projectId && !project.isNoProject)
  const ownsWorkspace = Boolean(cwd && selectedSessionId && hasProject && summarySessionIsCurrent(session))

  const changesQuery = useQuery({
    enabled: ownsWorkspace,
    queryKey: ['summary-changes', connection, profile, selectedSessionId, cwd, workspaceTick],
    queryFn: async () => {
      if (!summarySessionIsCurrent(session)) {
        throw new Error('Workspace changed')
      }

      const git = desktopGit()

      if (!git?.repoStatus) {
        throw new Error('Git is unavailable')
      }

      const status = await git.repoStatus(cwd)

      if (!summarySessionIsCurrent(session)) {
        throw new Error('Workspace changed')
      }

      return status ? { files: await reviewFilesForCwd(cwd, git.review), isRepo: true } : { files: [], isRepo: false }
    },
    retry: false
  })

  const runMutation = async (action: () => Promise<void>, label: string) => {
    if (!summarySessionIsCurrent(session)) {
      return
    }

    setMutationBusy(true)

    try {
      await action()
    } catch (error) {
      notifyError(error, label)
    } finally {
      setMutationBusy(false)
    }
  }

  if (!ownsWorkspace) {
    return null
  }

  if (changesQuery.isPending) {
    return <SummarySection embedded={embedded} icon={Code} state="loading" title={copy.title} />
  }

  if (changesQuery.error) {
    return (
      <SummarySection
        embedded={embedded}
        error={copy.unavailable}
        icon={Code}
        onRetry={() => void changesQuery.refetch()}
        state="error"
        title={copy.title}
      />
    )
  }

  if (!changesQuery.data.isRepo) {
    return null
  }

  const files = changesQuery.data.files

  if (files.length === 0) {
    return (
      <SummarySection
        embedded={embedded}
        emptyMessage={copy.noChanges}
        icon={Code}
        state="empty"
        title={copy.title}
      />
    )
  }

  const totals = summarizeReviewFiles(files)
  const busy = mutationBusy || changesQuery.isFetching

  return (
    <SummarySection embedded={embedded} title={copy.title}>
      <div className="grid gap-2">
        {!embedded && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{copy.files(totals.files)}</span>
            <DiffCount added={totals.added} removed={totals.removed} />
          </div>
        )}
        {totals.staged > 0 && (
          <p className="text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
            {copy.staged(totals.staged)}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button
            className="min-w-0 justify-start"
            disabled={busy}
            onClick={() => {
              if (!summarySessionIsCurrent(session)) {
                return
              }

              revealReview(cwd, session.target)
            }}
            size="inline"
            type="button"
            variant="text"
          >
            <Codicon name="diff" size="0.8rem" />
            <span className="truncate">{copy.viewDiff}</span>
          </Button>
          {embedded && <DiffCount added={totals.added} removed={totals.removed} />}
          <Tip label={copy.refresh}>
            <Button
              aria-label={copy.refresh}
              disabled={busy}
              onClick={() => void changesQuery.refetch()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Codicon name="refresh" size="0.8rem" spinning={changesQuery.isFetching} />
            </Button>
          </Tip>
        </div>
        <Button
          aria-expanded={expanded}
          className="justify-start"
          onClick={() => setExpanded(value => !value)}
          size="inline"
          type="button"
          variant="text"
        >
          {expanded ? t.summary.state.showLess : t.summary.state.showAll(files.length)}
          <Codicon name={expanded ? 'chevron-down' : 'chevron-right'} />
        </Button>
        {expanded && (
          <div className="grid gap-0.5">
            {files.map(file => (
              <div className="flex min-w-0 items-center gap-1" key={file.path}>
                <Tip label={file.path}>
                  <Button
                    className="min-w-0 flex-1 justify-start truncate"
                    onClick={() => {
                      if (!summarySessionIsCurrent(session)) {
                        return
                      }

                      revealReview(cwd, session.target)
                      void selectReviewFile(file)
                    }}
                    size="inline"
                    type="button"
                    variant="text"
                  >
                    {file.path}
                  </Button>
                </Tip>
                <DiffCount
                  added={file.added}
                  className="text-[length:var(--aino-text-caption)]"
                  removed={file.removed}
                />
                <Tip label={file.staged ? copy.unstage : copy.stage}>
                  <Button
                    aria-label={`${file.staged ? copy.unstage : copy.stage}: ${file.path}`}
                    disabled={busy}
                    onClick={() =>
                      void runMutation(
                        () => (file.staged ? unstageReviewFile(file.path, cwd) : stageReviewFile(file.path, cwd)),
                        file.staged ? copy.unstage : copy.stage
                      )
                    }
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Codicon name={file.staged ? 'remove' : 'add'} size="0.75rem" />
                  </Button>
                </Tip>
                <Tip label={copy.revert}>
                  <Button
                    aria-label={`${copy.revert}: ${file.path}`}
                    disabled={busy}
                    onClick={() => {
                      if (summarySessionIsCurrent(session)) {
                        requestRevert(file.path, cwd)
                      }
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Codicon name="discard" size="0.75rem" />
                  </Button>
                </Tip>
              </div>
            ))}
          </div>
        )}
      </div>
    </SummarySection>
  )
}
