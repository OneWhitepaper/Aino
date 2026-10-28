import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { SearchField } from '@/components/ui/search-field'
import { ResponsiveTabs, TabDropdown, tabMetaContent } from '@/components/ui/tab-dropdown'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { IconComponent } from '@/lib/icons'
import { cn } from '@/lib/utils'

// Tabs are data, not nodes: the shell owns text or segmented presentation and
// collapses either into the existing dropdown when the header runs out of room.
export interface PageShellTab {
  id: string
  label: string
  icon?: IconComponent
  /** Count badge. `null` = still loading (renders a skeleton); `undefined` = no badge. */
  meta?: string | number | null
}

interface PageSearchShellProps extends React.ComponentProps<'section'> {
  children: ReactNode
  /** Optional page identity, above the existing tab row. */
  heading?: ReactNode
  tabs?: PageShellTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  /** Secondary filters shown full-width on their own row below (expands). */
  filters?: ReactNode
  /** Header search; a shell that hides it (or whose tabs own their search) omits these. */
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  /** Data-derived rotating placeholder nudges (see SearchField.hints). */
  searchHints?: string[]
  searchValue?: string
  /** Hide the search field when there's nothing to search (empty dataset). */
  searchHidden?: boolean
  tabsAlign?: 'center' | 'start'
  tabsVariant?: 'text' | 'section'
  /** Right-aligned control in the header's trailing cell (e.g. a refresh button)
   *  so mouse users get a visible affordance for the refresh hotkey. */
  searchTrailingAction?: ReactNode
}

const headerLayouts = {
  center: {
    grid: 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
    search: '',
    tabs: 'justify-center',
    trailing: ''
  },
  start: {
    grid: 'grid-cols-[minmax(0,1fr)_auto_auto] px-6 pt-[calc(var(--titlebar-height)+1.5rem)]',
    search: 'col-start-2 row-start-1 justify-end',
    tabs: 'col-start-1 row-start-1 justify-start',
    trailing: 'col-start-3 row-start-1'
  }
}

function ShellTabs({
  tabs,
  activeTab,
  onTabChange,
  align,
  variant
}: {
  tabs: PageShellTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  align?: 'center' | 'start'
  variant: 'text' | 'section'
}) {
  if (variant === 'section') {
    return (
      <>
        <div className="hidden min-w-0 @min-[640px]:flex">
          <TabsList size="navigation">
            {tabs.map(({ id, label, icon: Icon, meta }) => (
              <TabsTrigger data-tour={`tab-${id}`} key={id} size="navigation" value={id}>
                {Icon && <Icon aria-hidden />}
                {label}
                {meta !== undefined && (
                  <Badge className="tabular-nums" size="xs" variant="muted">
                    {tabMetaContent(meta)}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="@min-[640px]:hidden">
          <TabDropdown
            align={align}
            items={tabs.map(tab => ({
              ...tab,
              active: tab.id === activeTab,
              onSelect: () => onTabChange?.(tab.id)
            }))}
            variant="navigation"
          />
        </div>
      </>
    )
  }

  return (
    <ResponsiveTabs
      onChange={id => onTabChange?.(id)}
      tabs={tabs}
      value={activeTab ?? tabs[0]?.id ?? ''}
      wideClassName={align === 'start' ? 'justify-start' : 'justify-center'}
    />
  )
}

export function PageSearchShell({
  children,
  heading,
  className,
  tabs,
  activeTab,
  onTabChange,
  filters,
  onSearchChange,
  searchPlaceholder,
  searchHints,
  searchValue,
  searchHidden = false,
  tabsAlign = 'center',
  tabsVariant = 'text',
  searchTrailingAction,
  ...props
}: PageSearchShellProps) {
  const hasTabs = (tabs?.length ?? 0) > 0
  const currentTab = activeTab ?? tabs?.[0]?.id ?? ''
  const layout = headerLayouts[tabsAlign]

  const content = (
    <div className="min-h-0 flex-1 overflow-hidden bg-(--ui-chat-surface-background)" data-aino-page-content="">
      {children}
    </div>
  )

  const page = (
    <section
      {...props}
      className={cn('flex h-full min-w-0 flex-col overflow-hidden bg-(--ui-chat-surface-background)', className)}
      data-aino-page-shell=""
    >
      {/*
        Header lives in the page body, below the window chrome (the shell floats
        traffic lights over the top titlebar-height strip, which the `pt` clears
        and leaves draggable). Search left, tabs centered on the page via the
        1fr/auto/1fr grid; the trailing 1fr keeps the center honest.
      */}
      {/*
        IMPORTANT: do NOT put `-webkit-app-region: drag` on this header. It spans
        full width over the band where the floating titlebar icon clusters live,
        and an overlapping OS drag region eats their clicks at the compositor
        level (pointer-events / no-drag carve-outs across separate stacking
        contexts don't reliably fix it on macOS). The shell already supplies a
        draggable titlebar strip that is `calc()`'d around the icon clusters
        (see app-shell.tsx), so window dragging still works here.
      */}
      <div className="shrink-0">
        {heading}
        {(hasTabs || !searchHidden) && (
          <div
            className={cn('grid items-center gap-3 px-3 pb-2 pt-[calc(var(--titlebar-height)+0.5rem)]', layout.grid)}
            data-aino-page-header=""
            data-tabs-variant={tabsVariant}
          >
            <div
              className={cn(
                'flex min-w-0 items-center justify-start',
                layout.search,
                searchHidden && tabsAlign === 'start' && 'hidden'
              )}
            >
              {!searchHidden && onSearchChange && (
                <SearchField
                  containerClassName="max-w-[45vw]"
                  hints={searchHints}
                  onChange={onSearchChange}
                  placeholder={searchPlaceholder ?? ''}
                  value={searchValue ?? ''}
                />
              )}
            </div>
            {hasTabs ? (
              <div className={cn('flex min-w-0 items-center', layout.tabs)} data-tour="page-tabs">
                <ShellTabs
                  activeTab={currentTab}
                  align={tabsAlign}
                  onTabChange={onTabChange}
                  tabs={tabs!}
                  variant={tabsVariant}
                />
              </div>
            ) : (
              <span />
            )}
            <div className={cn('flex min-w-0 items-center justify-end', layout.trailing)}>{searchTrailingAction}</div>
          </div>
        )}
        {filters ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2">{filters}</div> : null}
      </div>
      {tabsVariant === 'section' && hasTabs ? (
        <TabsContent asChild value={currentTab}>
          {content}
        </TabsContent>
      ) : (
        content
      )}
    </section>
  )

  return tabsVariant === 'section' && hasTabs ? (
    <Tabs asChild className="gap-0" onValueChange={id => onTabChange?.(id)} value={currentTab}>
      {page}
    </Tabs>
  ) : (
    page
  )
}
