import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SidebarToggleIcon } from '@/components/ui/sidebar-toggle-icon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Maximize } from '@/lib/icons'

import { setTreeGroupMinimized } from '../store'
import { $maximizedToolGroup, toggleToolGroupMaximized } from '../tool-panel-view'

interface ToolPanelControlsProps {
  groupId: string
  panes: string[]
  title: (id: string) => string
  activate: (id: string) => void
  onHide?: () => void
  canMaximize?: boolean
}

export function ToolPanelControls({
  groupId,
  panes,
  title,
  activate,
  onHide,
  canMaximize = true
}: ToolPanelControlsProps) {
  const { t } = useI18n()
  const maximized = useStore($maximizedToolGroup) === groupId
  const maxLabel = maximized ? t.toolPanel.restore : t.toolPanel.maximize

  return (
    <span
      className="flex shrink-0 items-center gap-0.5 px-1 [-webkit-app-region:no-drag]"
      onPointerDown={event => event.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={t.toolPanel.listTabs} size="icon-xs" variant="ghost">
            <Codicon name="chevron-down" size="0.8125rem" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {panes.map(id => (
            <DropdownMenuItem key={id} onSelect={() => activate(id)}>
              {title(id)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {canMaximize && (
        <Tip label={maxLabel}>
          <Button
            aria-label={maxLabel}
            onClick={() => toggleToolGroupMaximized(groupId)}
            size="icon-xs"
            variant="ghost"
          >
            <Maximize className="size-3.5" />
          </Button>
        </Tip>
      )}
      <Tip label={t.toolPanel.hide}>
        <Button
          aria-label={t.toolPanel.hide}
          onClick={() => {
            if (onHide) {
              onHide()

              return
            }

            $maximizedToolGroup.set(null)
            setTreeGroupMinimized(groupId, true)
          }}
          size="icon-xs"
          variant="ghost"
        >
          <SidebarToggleIcon expanded side="right" />
        </Button>
      </Tip>
    </span>
  )
}
