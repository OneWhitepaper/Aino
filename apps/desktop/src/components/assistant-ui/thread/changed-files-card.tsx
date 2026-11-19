import { useStore } from '@nanostores/react'
import { type FC, useMemo, useRef, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import {
  type ChangedFile,
  changedFileDisplayPath,
  deriveChangedFiles
} from '@/components/assistant-ui/thread/changed-files'
import { ChangedFilesReview } from '@/components/assistant-ui/thread/changed-files-review'
import { WIDGET_SHELL_CLASS } from '@/components/chat/widget-shell'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DiffCount } from '@/components/ui/diff-count'
import { FadeScroll } from '@/components/ui/fade-scroll'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { cn } from '@/lib/utils'

// ~5 rows. A turn that rewrites twenty files should still read as one card in
// the transcript, not a wall the user has to scroll past to reach the composer.
const MAX_ROWS_HEIGHT = '9.375rem'

interface ChangedFilesCardProps {
  parts: readonly unknown[]
}

/** The settled turn's edits, with a shared total and file-specific review links. */
export const ChangedFilesCard: FC<ChangedFilesCardProps> = ({ parts }) => {
  const { t } = useI18n()
  const copy = t.assistant.thread
  const files = useMemo(() => deriveChangedFiles(parts), [parts])
  const view = useSessionView()
  const viewCwd = useStore(view.$cwd)
  const [selection, setSelection] = useState<{ files: readonly ChangedFile[]; path: string } | null>(null)
  const reviewTrigger = useRef<HTMLButtonElement | null>(null)
  // Retiring or replacing this turn also retires the user's review selection.
  const selectedPath = selection?.files === files ? selection.path : null
  const selectPath = (path: null | string) => setSelection(path ? { files, path } : null)

  if (files.length === 0) {
    return null
  }

  const added = files.reduce((total, file) => total + file.added, 0)
  const removed = files.reduce((total, file) => total + file.removed, 0)

  return (
    <div
      aria-label={copy.filesChanged(files.length)}
      className={cn(
        WIDGET_SHELL_CLASS,
        'mt-2 min-w-0 overflow-hidden rounded-(--aino-radius-card) border border-(--ui-stroke-tertiary) p-0 text-[length:var(--conversation-tool-font-size)] leading-5'
      )}
      data-slot="aui_changed-files"
      role="region"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-(--ui-stroke-tertiary) px-3 py-2.5">
        <div className="flex min-w-36 flex-1 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-(--aino-radius-control) bg-(--ui-bg-quaternary) text-(--ui-text-secondary)">
            <Codicon name="new-file" size="1.125rem" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-(--ui-text-primary)">{copy.filesChanged(files.length)}</div>
            <DiffCount added={added} className="text-[length:var(--aino-text-caption)] leading-4" removed={removed} />
          </div>
        </div>
        <Button
          className="min-h-7 px-2.5"
          onClick={event => {
            reviewTrigger.current = event.currentTarget
            selectPath(files[0].path)
          }}
          size="xs"
          type="button"
          variant="outline"
        >
          {copy.reviewChanges}
        </Button>
      </div>
      <FadeScroll className="flex flex-col" maxHeight={MAX_ROWS_HEIGHT}>
        {files.map(file => {
          const path = changedFileDisplayPath(file.path, viewCwd)
          const directory = path.slice(0, -file.name.length)

          return (
            <Tip key={file.path} label={displayPath(file.path)}>
              <button
                aria-label={path}
                className="row-hover flex min-h-8 shrink-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100 even:bg-(--ui-bg-quaternary) focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                onClick={event => {
                  reviewTrigger.current = event.currentTarget
                  selectPath(file.path)
                }}
                type="button"
              >
                <FileTypeIcon className="shrink-0 text-(--ui-text-tertiary)" path={file.path} size="0.875rem" />
                <span className="flex min-w-0 flex-1 items-baseline overflow-hidden whitespace-nowrap">
                  <span className="truncate text-left text-(--ui-text-secondary)" dir="rtl">
                    <bdi dir="ltr">{directory}</bdi>
                  </span>
                  <span className="max-w-full shrink-0 truncate text-(--ui-text-primary)">{file.name}</span>
                </span>
                <DiffCount added={file.added} removed={file.removed} />
              </button>
            </Tip>
          )
        })}
      </FadeScroll>
      <ChangedFilesReview
        files={files}
        onCloseAutoFocus={() => reviewTrigger.current?.isConnected && reviewTrigger.current.focus()}
        onSelectPath={selectPath}
        selectedPath={selectedPath}
      />
    </div>
  )
}
