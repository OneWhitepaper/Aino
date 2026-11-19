import { useRef } from 'react'

import { useComposerScope } from '@/app/chat/composer/scope'
import { useSessionView } from '@/app/chat/session-view'
import type { ChangedFile } from '@/components/assistant-ui/thread/changed-files'
import { FileDiffPanel } from '@/components/chat/diff-lines'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DiffCount } from '@/components/ui/diff-count'
import { FadeScroll } from '@/components/ui/fade-scroll'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { revealReview } from '@/store/review'

interface ChangedFilesReviewProps {
  files: readonly ChangedFile[]
  onCloseAutoFocus: () => void
  onSelectPath: (path: null | string) => void
  selectedPath: null | string
}

/** Recorded tool edits remain reviewable even outside Git or after files change. */
export function ChangedFilesReview({ files, onCloseAutoFocus, onSelectPath, selectedPath }: ChangedFilesReviewProps) {
  const { t } = useI18n()
  const copy = t.assistant.thread
  const view = useSessionView()
  const composerScope = useComposerScope()
  const selected = files.find(file => file.path === selectedPath)
  const interactedOutside = useRef(false)

  return (
    <Sheet modal={false} onOpenChange={open => !open && onSelectPath(null)} open={Boolean(selected)}>
      <SheetContent
        className="w-full gap-0 sm:max-w-2xl data-[state=closed]:duration-150 data-[state=open]:duration-200 motion-reduce:animate-none"
        onCloseAutoFocus={event => {
          event.preventDefault()

          if (!interactedOutside.current) {
            onCloseAutoFocus()
          }
        }}
        onInteractOutside={() => {
          interactedOutside.current = true
        }}
        onOpenAutoFocus={() => {
          interactedOutside.current = false
        }}
      >
        <SheetHeader className="border-b border-(--ui-stroke-tertiary) px-4 py-4 pr-14">
          <SheetTitle>{copy.filesChanged(files.length)}</SheetTitle>
          <SheetDescription>{copy.recordedFileChanges}</SheetDescription>
        </SheetHeader>
        <FadeScroll className="shrink-0 border-b border-(--ui-stroke-tertiary) p-2" maxHeight="10rem">
          {files.map(file => (
            <Tip key={file.path} label={displayPath(file.path)}>
              <Button
                aria-label={displayPath(file.path)}
                aria-pressed={file.path === selectedPath}
                className="flex w-full justify-start font-normal aria-pressed:bg-(--ui-bg-quaternary)"
                onClick={() => onSelectPath(file.path)}
                size="sm"
                variant="ghost"
              >
                <FileTypeIcon path={file.path} size="0.875rem" />
                <span className="min-w-0 flex-1 truncate text-left">{file.name}</span>
                <DiffCount added={file.added} removed={file.removed} />
              </Button>
            </Tip>
          ))}
        </FadeScroll>
        {selected && (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" key={selected.path}>
            <p className="mb-3 break-all text-[length:var(--aino-text-caption)] text-(--ui-text-secondary)">
              {displayPath(selected.path)}
            </p>
            <div className="flex flex-col gap-4">
              {selected.diffs.map((diff, index) => (
                <section key={index}>
                  {selected.diffs.length > 1 && (
                    <h3 className="mb-1.5 text-[length:var(--aino-text-caption)] font-medium text-(--ui-text-secondary)">
                      {copy.recordedFileEdit(index + 1)}
                    </h3>
                  )}
                  <div style={{ height: Math.min(384, Math.max(80, diff.split('\n').length * 20)) }}>
                    <FileDiffPanel
                      className="mx-0 mb-0 h-full max-h-none rounded-lg border border-(--ui-stroke-tertiary)"
                      diff={diff}
                      path={selected.path}
                      virtualized
                    />
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
        <div className="flex shrink-0 justify-end border-t border-(--ui-stroke-tertiary) px-4 py-3">
          <Button
            onClick={() => {
              revealReview(view.kind === 'primary' ? null : view.$cwd.get() || null, composerScope.target)
              onSelectPath(null)
            }}
            size="sm"
            variant="outline"
          >
            <Codicon name="git-compare" size="0.875rem" />
            {copy.reviewRepositoryChanges}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
