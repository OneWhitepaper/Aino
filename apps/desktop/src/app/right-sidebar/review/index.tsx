import { useStore } from '@nanostores/react'

import { FileDiffPanel } from '@/components/chat/diff-lines'
import { DiffSkeleton, TreeSkeleton } from '@/components/chat/skeletons'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DiffCount } from '@/components/ui/diff-count'
import { Tip } from '@/components/ui/tooltip'
import { useDelayedTrue } from '@/hooks/use-delayed-true'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { notifyError } from '@/store/notifications'
import {
  $reviewDiff,
  $reviewDiffLoading,
  $reviewFiles,
  $reviewIsRepo,
  $reviewLoading,
  $reviewScope,
  $reviewSelectedPath,
  $reviewTreeMode,
  clearReviewSelection,
  closeReview,
  refreshReview,
  requestRevert,
  stageReviewFile,
  toggleReviewTreeMode,
  unstageReviewFile
} from '@/store/review'

import { PaneEmptyState } from '../index'

import { ReviewFileTree } from './file-tree'
import { ReviewScopeRow } from './scope-row'
import { ReviewShipBar } from './ship-bar'

export function ReviewPane() {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const files = useStore($reviewFiles)
  const loading = useStore($reviewLoading)
  const isRepo = useStore($reviewIsRepo)
  const selectedPath = useStore($reviewSelectedPath)
  const diff = useStore($reviewDiff)
  const diffLoading = useStore($reviewDiffLoading)
  const treeMode = useStore($reviewTreeMode)
  const scope = useStore($reviewScope)
  // Stage / unstage / revert and the ship bar act on the working tree, so they
  // only apply to the uncommitted scope; branch / last-turn are read-only.
  const isUncommitted = scope === 'uncommitted'

  const selectedFile = files.find(file => file.path === selectedPath)
  const hasFiles = files.length > 0
  // A repo (or a load that may reveal one) gets the header + scope chrome.
  const showChrome = loading || isRepo
  // Delay the skeletons so fast loads (most project switches) just blank → content
  // instead of flashing a jarring loading state.
  const showTreeSkeleton = useDelayedTrue(loading && !hasFiles)
  const showDiffSkeleton = useDelayedTrue(diffLoading)

  return (
    <aside
      aria-label={c.review}
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-(--ui-sidebar-surface-background) text-(--ui-text-secondary)"
    >
      {showChrome && (
        <div className="shrink-0 border-b border-(--ui-stroke-tertiary)" data-suppress-pane-reveal-side="">
          <ReviewScopeRow />
          <div className="flex min-h-9 min-w-0 items-center gap-0.5 px-3 pb-2">
            <span className="min-w-0 flex-1 truncate text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
              {c.changed(files.length)}
            </span>
            <Tip label={treeMode === 'tree' ? c.viewAsList : c.viewAsTree}>
              <Button
                aria-label={treeMode === 'tree' ? c.viewAsList : c.viewAsTree}
                disabled={!hasFiles}
                onClick={toggleReviewTreeMode}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name={treeMode === 'tree' ? 'list-flat' : 'list-tree'} size="0.8125rem" />
              </Button>
            </Tip>
            <Tip label={c.stageAll}>
              <Button
                aria-label={c.stageAll}
                disabled={!hasFiles || !isUncommitted}
                onClick={() => void stageReviewFile(null).catch(err => notifyError(err, c.stageAll))}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name="add" size="0.8125rem" />
              </Button>
            </Tip>
            <Tip label={c.revertAll}>
              <Button
                aria-label={c.revertAll}
                disabled={!hasFiles || !isUncommitted}
                onClick={() => requestRevert(null)}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name="discard" size="0.8125rem" />
              </Button>
            </Tip>
            <Tip label={t.rightSidebar.refreshTree}>
              <Button
                aria-label={t.rightSidebar.refreshTree}
                onClick={() => void refreshReview()}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name="refresh" size="0.8125rem" spinning={loading} />
              </Button>
            </Tip>
            <Button aria-label={c.close} onClick={closeReview} size="icon-xs" variant="ghost">
              <Codicon name="close" size="0.8125rem" />
            </Button>
          </div>
        </div>
      )}

      {showChrome ? (
        hasFiles ? (
          <ReviewFileTree />
        ) : showTreeSkeleton ? (
          <TreeSkeleton />
        ) : loading ? (
          <div className="min-h-0 flex-1" />
        ) : (
          <PaneEmptyState label={t.rightSidebar.noDiffs} />
        )
      ) : (
        <PaneEmptyState label={c.notRepo} />
      )}

      {/* Selected file's diff — reuses the shiki-highlighted FileDiffPanel. */}
      {selectedFile && (
        <div className="flex min-h-0 flex-[2] flex-col border-t border-(--ui-stroke-tertiary)">
          <div className="flex min-h-10 shrink-0 items-center gap-1.5 px-3 py-2" data-suppress-pane-reveal-side="">
            <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="diff" size="0.875rem" />
            <span
              className="min-w-0 flex-1 truncate text-[length:var(--aino-text-label)] text-(--ui-text-secondary)"
              title={displayPath(selectedFile.path)}
            >
              {displayPath(selectedFile.path)}
            </span>
            <DiffCount
              added={selectedFile.added}
              className="text-[length:var(--aino-text-caption)] leading-4"
              removed={selectedFile.removed}
            />
            {isUncommitted && (
              <Tip label={selectedFile.staged ? c.unstage : c.stage}>
                <Button
                  aria-label={selectedFile.staged ? c.unstage : c.stage}
                  onClick={() =>
                    void (
                      selectedFile.staged ? unstageReviewFile(selectedFile.path) : stageReviewFile(selectedFile.path)
                    ).catch(err => notifyError(err, c.stage))
                  }
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name={selectedFile.staged ? 'remove' : 'add'} size="0.8rem" />
                </Button>
              </Tip>
            )}
            <Button aria-label={c.close} onClick={clearReviewSelection} size="icon-xs" variant="ghost">
              <Codicon name="close" size="0.8rem" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {diffLoading ? (
              showDiffSkeleton ? (
                <DiffSkeleton />
              ) : null
            ) : diff ? (
              <FileDiffPanel className="mx-0 mb-0 h-full max-h-none" diff={diff} path={selectedFile.path} virtualized />
            ) : (
              <div className="py-6 text-center text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
                {c.noDiff}
              </div>
            )}
          </div>
        </div>
      )}

      <ReviewShipBar />
    </aside>
  )
}
