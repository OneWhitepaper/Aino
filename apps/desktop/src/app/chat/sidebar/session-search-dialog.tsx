import { type ComponentProps, useRef } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'

import { SidebarSessionSkeletons } from './section-states'
import { SidebarSessionsSection } from './sessions-section'

interface SidebarSessionSearchDialogProps extends Pick<
  ComponentProps<typeof SidebarSessionsSection>,
  | 'activeSessionId'
  | 'onArchiveSession'
  | 'onBranchSession'
  | 'onDeleteSession'
  | 'onResumeSession'
  | 'onTogglePin'
  | 'onToggleUnread'
  | 'showProfileTags'
> {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (query: string) => void
  pending: boolean
  results: SessionInfo[]
  recentSessions: SessionInfo[]
}

/** The sidebar owns retrieval and navigation; this surface owns focus and dismissal. */
export function SidebarSessionSearchDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  pending,
  results,
  recentSessions,
  ...sessionActions
}: SidebarSessionSearchDialogProps) {
  const { t } = useI18n()
  const s = t.sidebar
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmedQuery = query.trim()

  return (
    <Dialog
      onOpenChange={nextOpen => {
        onOpenChange(nextOpen)

        if (!nextOpen) {
          onQueryChange('')
        }
      }}
      open={open}
    >
      <DialogContent
        aria-describedby={undefined}
        className="aino-session-search-dialog"
        onOpenAutoFocus={event => {
          event.preventDefault()
          inputRef.current?.focus({ preventScroll: true })
        }}
      >
        <DialogTitle className="sr-only">{s.searchAria}</DialogTitle>
        <div data-session-search-shell="">
          <SearchField
            aria-label={s.searchAria}
            containerClassName="aino-session-search-field w-full"
            inputClassName="flex-1 [field-sizing:fixed]"
            inputRef={inputRef}
            onChange={onQueryChange}
            placeholder={s.searchPlaceholder}
            value={query}
          />
        </div>
        <div className="aino-session-search-results" data-session-search-results="">
          <SidebarSessionsSection
            {...sessionActions}
            collapsible={false}
            contentClassName="max-h-[min(28rem,calc(100vh-12rem))] overflow-y-auto px-1 pb-1"
            emptyState={
              pending ? (
                <SidebarSessionSkeletons />
              ) : (
                <div className="wrap-anywhere grid min-h-24 place-items-center rounded-lg px-2 text-center text-xs text-(--ui-text-tertiary)">
                  {trimmedQuery ? s.noMatch(trimmedQuery) : s.noSessions}
                </div>
              )
            }
            label={trimmedQuery ? s.results : s.recent}
            onToggle={() => undefined}
            open
            pinned={false}
            rootClassName="min-h-0 p-2"
            sectionLabelTone="neutral"
            sessions={trimmedQuery ? results : recentSessions.slice(0, 20)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
