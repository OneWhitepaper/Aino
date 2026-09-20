import './files/styles.css'

import { useStore } from '@nanostores/react'
import type { ComponentProps } from 'react'

import { TreeSkeleton } from '@/components/chat/skeletons'
import { ErrorBoundary } from '@/components/error-boundary'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useDelayedTrue } from '@/hooks/use-delayed-true'
import { useI18n } from '@/i18n'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { openPreview } from '@/store/preview'
import { $toolSession, $toolWorkspaceCwd, toolSessionIsCurrent } from '@/store/tool-session'

import { SidebarPanelLabel } from '../shell/sidebar-label'

import { ProjectTree } from './files/tree'
import { useProjectTree } from './files/use-project-tree'

interface RightSidebarPaneProps {
  onActivateFile?: (path: string) => void
  onActivateFolder?: (path: string) => void
}

export function RightSidebarPane({ onActivateFile, onActivateFolder }: RightSidebarPaneProps = {}) {
  const { t } = useI18n()
  const r = t.rightSidebar
  const session = useStore($toolSession)
  const currentCwd = useStore($toolWorkspaceCwd)
  const hasWorkspace = Boolean(currentCwd)

  const {
    collapseAll,
    collapseNonce,
    data,
    effectiveCwd,
    loadChildren,
    openState,
    refreshRoot,
    rootError,
    rootLoading,
    setNodeOpen
  } = useProjectTree(hasWorkspace ? currentCwd : '')

  const cwdName =
    effectiveCwd
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? effectiveCwd

  const canCollapse = Object.values(openState).some(Boolean)

  const previewFile = async (path: string) => {
    if (!toolSessionIsCurrent(session)) {
      return
    }

    try {
      const preview = await normalizeOrLocalPreviewTarget(path, effectiveCwd || undefined)

      if (!toolSessionIsCurrent(session)) {
        return
      }

      if (!preview) {
        throw new Error(r.couldNotPreview(path))
      }

      openPreview(preview, 'file-browser')
    } catch (error) {
      if (toolSessionIsCurrent(session)) {
        notifyError(error, r.previewUnavailable)
      }
    }
  }

  return (
    <aside
      aria-label={r.aria}
      className="relative flex h-full w-full min-w-0 flex-col overflow-hidden pt-(--titlebar-height)"
      data-file-browser=""
    >
      <FilesystemTab
        canCollapse={canCollapse}
        collapseNonce={collapseNonce}
        cwd={effectiveCwd}
        cwdName={cwdName}
        data={data}
        error={rootError}
        hasWorkspace={hasWorkspace}
        loading={rootLoading}
        onActivateFile={onActivateFile ?? previewFile}
        onActivateFolder={onActivateFolder ?? previewFile}
        onCollapseAll={collapseAll}
        onLoadChildren={loadChildren}
        onNodeOpenChange={setNodeOpen}
        onPreviewFile={previewFile}
        onRefresh={() => void refreshRoot()}
        openState={openState}
      />
    </aside>
  )
}

interface FilesystemTabProps extends FileTreeBodyProps {
  canCollapse: boolean
  cwdName: string
  hasWorkspace: boolean
  onCollapseAll: () => void
  onRefresh: () => void
}

function FilesystemTab({
  canCollapse,
  collapseNonce,
  cwd,
  cwdName,
  data,
  error,
  hasWorkspace,
  loading,
  onActivateFile,
  onActivateFolder,
  onCollapseAll,
  onLoadChildren,
  onNodeOpenChange,
  onPreviewFile,
  onRefresh,
  openState
}: FilesystemTabProps) {
  const { t } = useI18n()
  const r = t.rightSidebar

  // No working directory (a bare/detached chat) → no tree, just a terse hint.
  // Switching workspace is a project/worktree action, never a raw folder picker.
  if (!hasWorkspace) {
    return <PaneEmptyState label={r.noProjectOpen} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RightSidebarSectionHeader data-file-browser-header="">
        <div className="flex min-w-0 flex-1">
          <Tip label={cwd}>
            <SidebarPanelLabel tone="neutral">{cwdName}</SidebarPanelLabel>
          </Tip>
        </div>
        <Tip label={r.refreshTree}>
          <Button aria-label={r.refreshTree} disabled={loading} onClick={onRefresh} size="icon-xs" variant="ghost">
            <Codicon name="refresh" size="0.875rem" spinning={loading} />
          </Button>
        </Tip>
        <Tip label={r.collapseAll}>
          <Button
            aria-label={r.collapseAll}
            disabled={!canCollapse}
            onClick={onCollapseAll}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="collapse-all" size="0.875rem" />
          </Button>
        </Tip>
      </RightSidebarSectionHeader>
      <FileTreeBody
        collapseNonce={collapseNonce}
        cwd={cwd}
        data={data}
        error={error}
        loading={loading}
        onActivateFile={onActivateFile}
        onActivateFolder={onActivateFolder}
        onLoadChildren={onLoadChildren}
        onNodeOpenChange={onNodeOpenChange}
        onPreviewFile={onPreviewFile}
        onRetry={onRefresh}
        openState={openState}
      />
    </div>
  )
}

export function RightSidebarSectionHeader({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('group/project-header flex h-7 shrink-0 items-center px-2.5', className)} {...props}>
      {children}
    </div>
  )
}

interface FileTreeBodyProps {
  collapseNonce: number
  cwd: string
  data: ReturnType<typeof useProjectTree>['data']
  error: string | null
  loading: boolean
  onActivateFile: (path: string) => void
  onActivateFolder: (path: string) => void
  onLoadChildren: (id: string) => void | Promise<void>
  onNodeOpenChange: (id: string, open: boolean) => void
  onPreviewFile?: (path: string) => void
  /** Force-reload the root. The hook also auto-retries while errored, so this
   *  is the impatient-user path. */
  onRetry?: () => void
  openState: ReturnType<typeof useProjectTree>['openState']
}

function FileTreeBody({
  collapseNonce,
  cwd,
  data,
  error,
  loading,
  onActivateFile,
  onActivateFolder,
  onLoadChildren,
  onNodeOpenChange,
  onPreviewFile,
  onRetry,
  openState
}: FileTreeBodyProps) {
  const { t } = useI18n()
  const r = t.rightSidebar
  // Stay blank for a beat, then skeleton — so a fast project switch doesn't
  // flash a jarring loading state.
  const showSkeleton = useDelayedTrue(loading && data.length === 0)

  if (!cwd) {
    return <EmptyState body={r.noProjectBody} title={r.noProjectTitle} />
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <EmptyState body={r.unreadableBody(error)} title={r.unreadableTitle} />
        {onRetry && (
          <Button onClick={onRetry} size="inline" type="button" variant="text">
            {r.tryAgain}
          </Button>
        )}
      </div>
    )
  }

  if (loading && data.length === 0) {
    return showSkeleton ? <FileTreeLoadingState /> : <div className="min-h-0 flex-1" />
  }

  if (data.length === 0) {
    return <EmptyState body={r.emptyBody} title={r.emptyTitle} />
  }

  return (
    <ErrorBoundary
      fallback={({ reset }) => (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <EmptyState body={r.treeErrorBody} title={r.treeErrorTitle} />
          <Button onClick={reset} size="inline" type="button" variant="text">
            {r.tryAgain}
          </Button>
        </div>
      )}
      key={cwd}
      label="file-tree"
    >
      <ProjectTree
        collapseNonce={collapseNonce}
        cwd={cwd}
        data={data}
        onActivateFile={onActivateFile}
        onActivateFolder={onActivateFolder}
        onLoadChildren={onLoadChildren}
        onNodeOpenChange={onNodeOpenChange}
        onPreviewFile={onPreviewFile}
        openState={openState}
      />
    </ErrorBoundary>
  )
}

function FileTreeLoadingState() {
  const { t } = useI18n()

  return (
    <div aria-label={t.rightSidebar.loadingTree} className="min-h-0 flex-1" role="status">
      <TreeSkeleton />
    </div>
  )
}

// File and review empty states share the same quiet section-label treatment.
export function PaneEmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4">
      <SidebarPanelLabel tone="neutral">{label}</SidebarPanelLabel>
    </div>
  )
}

// Richer empty/error state (title + body) for the file tree's read failures.
export function EmptyState({ body, title }: { body: string; title?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
      {title && <div className="text-[length:var(--aino-text-ui)] font-medium text-(--ui-text-primary)">{title}</div>}
      <div className="text-[length:var(--aino-text-caption)] leading-relaxed text-(--ui-text-secondary)">{body}</div>
    </div>
  )
}
