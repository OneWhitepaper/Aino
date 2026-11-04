import { useStore } from '@nanostores/react'
import { type KeyboardEvent, useRef } from 'react'

import { ConnectionGlyph } from '@/app/chat/sidebar/connection-glyph'
import { useActiveTabVisible } from '@/components/pane-shell/tree/renderer/tab-strip-scroll'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tip, TipHintLabel } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { formatCombo } from '@/lib/keybinds/combo'
import { isMetaClose, middleClickHandlers } from '@/lib/middle-click'
import { cn } from '@/lib/utils'
import { $connectionsRegistry } from '@/store/connections'
import { $bindings } from '@/store/keybinds'

import { setTerminalTakeover } from '../store'

import { NewTerminalButton } from './rail-new-terminal'
import { terminalHost } from './terminal-gateway'
import {
  $activeTerminalId,
  $terminalHostsMixed,
  $terminals,
  closeAllTerminals,
  closeOtherTerminals,
  closeTerminal,
  selectTerminal,
  type TerminalEntry
} from './terminals'

/** Named terminal tabs stay above the persistent terminal body; hiding the
 *  panel preserves its shells, while each tab keeps an explicit close action. */
export function TerminalRail() {
  const { t } = useI18n()
  const terminals = useStore($terminals)
  const activeId = useStore($activeTerminalId)
  const bindings = useStore($bindings)
  const toggleHint = bindings['view.showTerminal']?.[0]
  const tabsRef = useRef<HTMLDivElement>(null)

  useActiveTabVisible(tabsRef, activeId ?? '', {
    enabled: activeId !== null,
    last: terminals.at(-1)?.id === activeId,
    tabCount: terminals.length
  })

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') {
      return
    }

    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const index = tabs.indexOf(event.target as HTMLButtonElement)

    const indexByKey: Record<string, number> = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1
    }

    const nextIndex = indexByKey[event.key]

    if (nextIndex === undefined || event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    tabs[nextIndex].focus()
    selectTerminal(terminals[nextIndex].id)
  }

  return (
    <div
      className="relative z-40 flex h-9 min-w-0 shrink-0 items-center border-b border-(--ui-stroke-tertiary) bg-(--aino-surface-bg) [-webkit-app-region:no-drag]"
      // Keep collapsed sidebars from revealing over terminal tab controls.
      data-suppress-pane-reveal=""
    >
      <div
        aria-label={t.rightSidebar.terminalsAria}
        aria-orientation="horizontal"
        className="flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-terminal-tabs=""
        onKeyDown={handleTabKeyDown}
        ref={tabsRef}
        role="tablist"
      >
        {terminals.map((term, index) => (
          <TerminalRailItem
            active={term.id === activeId}
            canCloseOthers={terminals.length > 1}
            index={index}
            key={term.id}
            term={term}
            toggleHint={toggleHint}
          />
        ))}
        <NewTerminalButton className="grid place-items-center rounded-md text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground" />
      </div>

      <div className="flex shrink-0 items-center px-1">
        <Tip label={t.rightSidebar.terminalHide} side="bottom">
          <Button
            aria-label={t.rightSidebar.terminalHide}
            onClick={() => setTerminalTakeover(false)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Codicon name="chevron-down" size="0.8125rem" />
          </Button>
        </Tip>
      </div>
    </div>
  )
}

interface TerminalRailItemProps {
  active: boolean
  canCloseOthers: boolean
  index: number
  term: TerminalEntry
  toggleHint?: string
}

function TerminalRailItem({ active, canCloseOthers, index, term, toggleHint }: TerminalRailItemProps) {
  const { t } = useI18n()
  // Keep the persisted English value as a stable sentinel for an untouched
  // tab, but render it in the active locale. Shell-resolved names and titles
  // entered by the user are real data and must stay unchanged.
  const title = term.auto && term.title === 'Terminal' ? t.rightSidebar.terminal : term.title
  const registry = useStore($connectionsRegistry)
  const mixed = useStore($terminalHostsMixed)
  const host = terminalHost(term, registry)
  // Where the shell runs. This device stays unlabeled until a tab runs elsewhere.
  const shown = host === 'removed' || (host && (mixed || host.connection.kind !== 'local')) ? host : null
  const hostLabel = shown === 'removed' ? t.rightSidebar.terminalGatewayRemoved : shown?.connection.label
  const label = `${index + 1}. ${title}${hostLabel ? ` · ${hostLabel}` : ''}`

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'flex h-full max-w-56 shrink-0 items-center gap-1 px-2',
            active ? 'bg-(--aino-surface-active)' : 'hover:bg-(--aino-surface-hover)'
          )}
          data-tree-tab={term.id}
          {...middleClickHandlers(() => closeTerminal(term.id))}
          role="presentation"
        >
          <Tip label={<TipHintLabel hint={toggleHint && formatCombo(toggleHint)} text={label} />} side="bottom">
            <button
              aria-label={label}
              aria-selected={active}
              className={cn(
                'flex h-full min-w-0 items-center gap-2 text-[length:var(--aino-text-ui)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--aino-focus-ring)',
                active ? 'text-(--ui-text-primary)' : 'text-(--ui-text-secondary)'
              )}
              // ⌘-click closes (the pane-tab gesture); a plain click selects.
              onClick={event => (isMetaClose(event) ? closeTerminal(term.id) : selectTerminal(term.id))}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <Codicon className="shrink-0" name={term.kind === 'agent' ? 'agent' : 'terminal'} size="0.875rem" />
              <span className="min-w-0 truncate">{title}</span>
              {shown && (
                <span
                  className="pointer-events-none absolute bottom-0 right-0.5 grid place-items-center rounded-sm bg-(--ui-terminal-surface-background)"
                  data-terminal-host={shown === 'removed' ? 'removed' : shown.connection.id}
                >
                  {shown === 'removed' ? (
                    <Codicon className="text-(--ui-text-quaternary)" name="debug-disconnect" size="0.625rem" />
                  ) : (
                    <ConnectionGlyph className="size-2.5 [&_svg]:size-2.5" connection={shown.connection} />
                  )}
                </span>
              )}
            </button>
          </Tip>
          <Button
            aria-label={`${t.common.close}: ${label}`}
            onClick={() => closeTerminal(term.id)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Codicon name="close" size="0.6875rem" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => closeTerminal(term.id)}>{t.common.close}</ContextMenuItem>
        <ContextMenuItem disabled={!canCloseOthers} onSelect={() => closeOtherTerminals(term.id)}>
          {t.rightSidebar.terminalCloseOthers}
        </ContextMenuItem>
        <ContextMenuItem onSelect={closeAllTerminals}>{t.rightSidebar.terminalCloseAll}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => setTerminalTakeover(false)}>{t.rightSidebar.terminalHide}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
