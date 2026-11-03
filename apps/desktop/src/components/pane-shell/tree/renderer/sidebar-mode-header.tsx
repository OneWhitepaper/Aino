import './sidebar-mode-header.css'

import { BrandMark } from '@/components/brand-mark'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

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
  onOpenChange?: (open: boolean) => void
}

/** The pane group owns selection; the brand menu only presents its current panes. */
export function SidebarModeHeader({ activeId, items, onSelect, menuLabel, onOpenChange }: SidebarModeHeaderProps) {
  const active = items.find(item => item.id === activeId) ?? items[0]

  if (!active) {
    return null
  }

  const brand = (
    <>
      <BrandMark className="aino-sidebar-mode-logo" />
      <span className="aino-sidebar-mode-title">{active.title}</span>
    </>
  )

  return (
    <header className="aino-sidebar-mode-header" data-sidebar-mode-header="">
      {items.length < 2 ? (
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
              <Codicon className="aino-sidebar-mode-chevron" name="chevron-down" size="0.875rem" />
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
    </header>
  )
}
