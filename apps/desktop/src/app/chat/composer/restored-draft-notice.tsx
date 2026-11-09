import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { $restoredDraftNotice, dismissRestoredDraftNotice, undoRestoredDraft } from '@/store/composer'

interface RestoredDraftNoticeProps {
  /** The composer is showing the fresh draft (no session scope). */
  freshDraft: boolean
  /** Clear the editor after Undo emptied the fresh draft. */
  onUndone: () => void
  /** Latest live editor text — Undo only applies while it is still what was restored. */
  readLiveText: () => string
}

/**
 * "Restored your unsent message" strip above the fresh draft's input
 * (#111868). Offers, never hijacks: no focus move, no navigation, no toast —
 * the text is simply in the composer with a way to put it back. Renders
 * nothing outside the fresh draft, so opening another session hides it
 * without consuming the Undo.
 */
export function RestoredDraftNotice({ freshDraft, onUndone, readLiveText }: RestoredDraftNoticeProps) {
  const notice = useStore($restoredDraftNotice)
  const { t } = useI18n()

  if (!notice || !freshDraft) {
    return null
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-lg border border-[color-mix(in_srgb,var(--dt-composer-ring)_32%,transparent)] bg-accent/18 px-3 py-2"
      data-slot="composer-restored-draft"
      role="status"
    >
      <p className="min-w-0 flex-1 basis-48 text-sm leading-5 text-(--ui-text-secondary) [overflow-wrap:anywhere]">
        {t.composer.restoredDraftNotice}
      </p>
      <div className="flex max-w-full flex-wrap items-center gap-1">
        <Button
          className="min-h-7 max-w-full whitespace-normal rounded-md px-2 text-[length:var(--aino-text-label)] [overflow-wrap:anywhere]"
          onClick={() => {
            if (undoRestoredDraft(readLiveText())) {
              onUndone()
            }
          }}
          type="button"
          variant="ghost"
        >
          {t.composer.restoredDraftUndo}
        </Button>
        <Button
          aria-label={t.common.close}
          className="size-7 shrink-0 rounded-md p-0"
          onClick={dismissRestoredDraftNotice}
          type="button"
          variant="ghost"
        >
          <Codicon aria-hidden name="close" size="0.85rem" />
        </Button>
      </div>
    </div>
  )
}
