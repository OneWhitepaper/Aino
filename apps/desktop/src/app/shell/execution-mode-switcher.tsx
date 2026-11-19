import { useStore } from '@nanostores/react'
import { ChevronDown } from 'lucide-react'

import { BrandMark } from '@/components/brand-mark'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { $currentExecutionMode, requestExecutionMode } from '@/store/execution-mode'

interface ExecutionModeSwitcherProps {
  otherItems?: Array<{ id: string; title: string; description?: string }>
  onSelectPane?: (id: string) => void
  onOpenChange?: (open: boolean) => void
}

export function ExecutionModeSwitcher({ otherItems = [], onSelectPane, onOpenChange }: ExecutionModeSwitcherProps) {
  const { t } = useI18n()
  const copy = t.executionMode
  const mode = useStore($currentExecutionMode)

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${copy.switchMode}: ${copy[mode]}`}
          className="aino-sidebar-mode-trigger"
          onPointerDown={event => event.stopPropagation()}
          type="button"
        >
          <BrandMark className="aino-sidebar-mode-logo" />
          <span className="aino-sidebar-mode-title">{copy[mode]}</span>
          <ChevronDown className="aino-sidebar-mode-chevron" size={13} strokeWidth={1.65} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label={copy.switchMode} className="aino-sidebar-mode-menu" sideOffset={6}>
        <DropdownMenuRadioGroup
          onValueChange={value => {
            if (value === 'work' || value === 'code') {
              requestExecutionMode(value)
            }
          }}
          value={mode}
        >
          {(['work', 'code'] as const).map(value => (
            <DropdownMenuRadioItem className="aino-sidebar-mode-item" key={value} value={value}>
              <span className="aino-sidebar-mode-copy">
                <span className="aino-sidebar-mode-item-title">{copy[value]}</span>
                <span className="aino-sidebar-mode-description">{copy[`${value}Description`]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {otherItems.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup onValueChange={onSelectPane} value="">
              {otherItems.map(item => (
                <DropdownMenuRadioItem className="aino-sidebar-mode-item" key={item.id} value={item.id}>
                  <span className="aino-sidebar-mode-copy">
                    <span className="aino-sidebar-mode-item-title">{item.title}</span>
                    {item.description && <span className="aino-sidebar-mode-description">{item.description}</span>}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
