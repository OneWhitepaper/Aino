import './tool-panel.css'

import { useStore } from '@nanostores/react'
import { type ComponentPropsWithoutRef, forwardRef, type Ref, useRef } from 'react'

import { ToolPanelControls } from '@/components/pane-shell/tree/renderer/tool-panel-controls'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { PaneTab, PaneTabStrip } from '@/components/ui/pane-tab'
import { usePaneTabKeyboard } from '@/components/ui/pane-tab-keyboard'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { collaborationCopy } from '@/i18n/collaboration-capsule'
import { $previewTabs } from '@/store/preview'

import { openToolPanelChooser, openToolPanelResource } from './tool-panel-actions'
import {
  retainedToolCategoryPane,
  TOOL_PANEL_CATEGORIES,
  toolPanelCategory,
  type ToolPanelCategory
} from './tool-panel-categories'

interface ToolPanelStripProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  activeId: string
  groupId: string
  panes: string[]
  title: (id: string) => string
  activate: (id: string) => void
  onClose?: () => void
  onHide?: () => void
  canMaximize?: boolean
  listRef?: Ref<HTMLDivElement>
}

/** Five stable tools sit above the same retained pane bodies. Extra tabs stay
 *  reachable from +, including contributed tools and every open preview. */
export const ToolPanelStrip = forwardRef<HTMLDivElement, ToolPanelStripProps>(function ToolPanelStrip(
  { activeId, groupId, panes, title, activate, onClose, onHide, canMaximize, className, style, listRef, ...props },
  ref
) {
  const { t, locale } = useI18n()
  const previews = useStore($previewTabs)
  const keyboardRoot = useRef<HTMLDivElement>(null)
  const selected = toolPanelCategory(activeId, previews)
  const keyboardProps = usePaneTabKeyboard(TOOL_PANEL_CATEGORIES, selected || '', keyboardRoot)

  const labels: Record<ToolPanelCategory, string> = {
    browser: t.preview.browserTab,
    files: t.sidebar.files,
    terminal: t.sidebar.terminal,
    review: t.sidebar.review,
    collaboration: collaborationCopy(locale).title
  }

  const icons: Record<ToolPanelCategory, string> = {
    browser: 'globe',
    files: 'folder',
    terminal: 'terminal',
    review: 'git-pull-request',
    collaboration: 'organization'
  }

  const select = (category: ToolPanelCategory) => {
    const retained = retainedToolCategoryPane(category, panes, activeId, previews)

    if (retained) {
      activate(retained)
    } else {
      openToolPanelResource(category)
    }
  }

  return (
    <div {...props} className={className} data-bot-tool-strip="" ref={ref} style={style}>
      <PaneTabStrip
        className="w-full"
        data-zone-tabstrip={groupId}
        listRef={node => {
          keyboardRoot.current = node

          if (typeof listRef === 'function') {
            listRef(node)
          } else if (listRef) {
            listRef.current = node
          }
        }}
        trailing={
          <>
            <DropdownMenu>
              <Tip label={t.toolPanel.listTabs}>
                <DropdownMenuTrigger asChild>
                  <Button aria-label={t.toolPanel.listTabs} size="icon-xs" variant="ghost">
                    <Codicon name="add" size={14} />
                  </Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end">
                {panes.map(id => (
                  <DropdownMenuItem key={id} onSelect={() => activate(id)}>
                    {title(id)}
                  </DropdownMenuItem>
                ))}
                {panes.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => openToolPanelChooser(groupId)}>
                  <Codicon name="add" />
                  {t.zones.newTab}
                </DropdownMenuItem>
                {onClose && (
                  <DropdownMenuItem onSelect={onClose}>
                    <Codicon name="close" />
                    {t.common.close}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <ToolPanelControls
              activate={activate}
              canMaximize={canMaximize}
              groupId={groupId}
              onHide={onHide}
              panes={panes}
              showTabList={false}
              title={title}
            />
          </>
        }
        variant="tool"
      >
        {TOOL_PANEL_CATEGORIES.map(category => (
          <PaneTab
            {...keyboardProps(category)}
            active={selected === category}
            aria-label={labels[category]}
            aria-selected={selected === category}
            className="aino-tool-category"
            key={category}
            onActivate={() => select(category)}
            onClick={() => select(category)}
            role="tab"
          >
            <Codicon name={icons[category]} size={14} />
            <span>{labels[category]}</span>
          </PaneTab>
        ))}
      </PaneTabStrip>
    </div>
  )
})
