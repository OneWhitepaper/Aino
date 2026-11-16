import './sidebar-mode-header.css'

import { ChevronDown, Search } from 'lucide-react'

import { BrandMark } from '@/components/brand-mark'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Slot } from '@/contrib/react/slot'
import { useI18n } from '@/i18n'
import { SESSION_SEARCH_FOCUS_EVENT } from '@/store/layout'

export interface SidebarModeItem {
  id: string
  title: string
  description?: string
}

interface SidebarModeHeaderProps {
  activeId: string
  items: SidebarModeItem[]
  onSelect: (id: string) => void
  menuLabel: string
  navigation?: 'menu' | 'rail'
  onOpenChange?: (open: boolean) => void
}

/** The pane group owns selection; the brand menu only presents its current panes. */
export function SidebarModeHeader({
  activeId,
  items,
  onSelect,
  menuLabel,
  navigation = 'menu',
  onOpenChange
}: SidebarModeHeaderProps) {
  const { t } = useI18n()
  const active = items.find(item => item.id === activeId) ?? items[0]

  if (!active) {
    return null
  }

  const botNavigation = active.id === 'hermes-bots:pane'

  const brand = (
    <>
      {!botNavigation ? <BrandMark className="aino-sidebar-mode-logo" /> : null}
      <span className="aino-sidebar-mode-title">{active.title}</span>
    </>
  )

  return (
    <header
      className="aino-sidebar-mode-header"
      data-bot-navigation={botNavigation || undefined}
      data-sidebar-mode-header=""
    >
      {navigation === 'rail' || items.length < 2 ? (
        <div className="aino-sidebar-mode-static">{brand}</div>
      ) : (
        <DropdownMenu onOpenChange={onOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`${menuLabel}: ${active.title}`}
              className="aino-sidebar-mode-trigger"
              onPointerDown={event => event.stopPropagation()}
              type="button"
            >
              {brand}
              <ChevronDown className="aino-sidebar-mode-chevron" size={13} strokeWidth={1.65} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            aria-label={menuLabel}
            className="aino-sidebar-mode-menu"
            data-sidebar-mode-menu=""
            sideOffset={6}
          >
            <DropdownMenuRadioGroup onValueChange={onSelect} value={active.id}>
              {items.map(item => (
                <DropdownMenuRadioItem className="aino-sidebar-mode-item" key={item.id} value={item.id}>
                  <span className="aino-sidebar-mode-copy">
                    <span className="aino-sidebar-mode-item-title">{item.title}</span>
                    {item.description ? (
                      <span className="aino-sidebar-mode-description">{item.description}</span>
                    ) : null}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {active.id === 'sessions' && (
        <button
          aria-label={t.sidebar.searchAria}
          className="aino-sidebar-search-button"
          onClick={() => window.dispatchEvent(new CustomEvent(SESSION_SEARCH_FOCUS_EVENT))}
          type="button"
        >
          <Search size={18} strokeWidth={1.65} />
        </button>
      )}
      {active.id !== 'sessions' && (
        <div className="aino-sidebar-header-actions">
          <Slot area="navigation.header.actions" />
        </div>
      )}
    </header>
  )
}
