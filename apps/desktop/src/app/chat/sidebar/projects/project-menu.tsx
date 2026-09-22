import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useState } from 'react'

import {
  type ActionItemSpec,
  ActionsContextMenu,
  DROPDOWN_KIT,
  type MenuKit,
  renderActionItem
} from '@/components/ui/actions-menu'
import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { isDesktopFsRemoteMode } from '@/lib/desktop-fs'
import { $panesFlipped } from '@/store/layout'
import { $profileScope, ALL_PROFILES } from '@/store/profile'
import {
  closeProject,
  copyPath,
  deleteProject,
  openProjectAddFolder,
  openProjectFolders,
  openProjectRename,
  revealPath,
  setActiveProject,
  setProjectAppearance
} from '@/store/projects'

import { ProjectAppearancePicker } from './project-appearance'
import type { SidebarProjectTree } from './workspace-groups'

// Shared per-project state + handlers, so the kebab dropdown and the row's
// right-click menu drive the exact same actions. Closing a project only changes
// the opened list; removing an explicit registration remains separate.
function useProjectActions({
  project,
  isActive,
  scoped,
  onExitScope
}: {
  project: SidebarProjectTree
  isActive: boolean
  scoped: boolean
  onExitScope?: () => void
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const target = { id: project.id, name: project.label }
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const readOnly = useStore($profileScope) === ALL_PROFILES

  const confirmDelete = async () => {
    await deleteProject(project.id)

    if (scoped) {
      onExitScope?.()
    }
  }

  // Rename / add folder / set active — explicit projects only (auto ones lack a
  // materialized record). Appearance is handled per-surface (popover vs submenu)
  // by the caller since its picker chrome differs.
  const identityItems: ActionItemSpec[] = project.isAuto
    ? []
    : [
        {
          disabled: readOnly,
          icon: 'edit',
          key: 'rename',
          label: p.menuRename,
          onSelect: () => openProjectRename(target)
        },
        {
          disabled: readOnly,
          icon: 'new-folder',
          key: 'add-folder',
          label: p.menuAddFolder,
          onSelect: () => openProjectAddFolder(target)
        },
        {
          disabled: readOnly,
          icon: 'files',
          key: 'folders',
          label: p.manageFolders,
          onSelect: () => openProjectFolders(target)
        },
        {
          disabled: isActive || readOnly,
          icon: 'target',
          key: 'set-active',
          label: p.menuSetActive,
          onSelect: () => void setActiveProject(project.id)
        }
      ]

  // The OS file manager needs the local filesystem; a remote backend's
  // project is not on this computer (the file trees hide reveal the same way).
  const pathItems: ActionItemSpec[] = [
    ...(isDesktopFsRemoteMode()
      ? []
      : [
          {
            disabled: !project.path,
            icon: 'folder-opened',
            key: 'reveal',
            label: p.reveal,
            onSelect: () => void revealPath(project.path)
          } satisfies ActionItemSpec
        ]),
    {
      disabled: !project.path,
      icon: 'copy',
      key: 'copy',
      label: p.copyPath,
      onSelect: () => void copyPath(project.path)
    }
  ]

  const closeItem: ActionItemSpec = {
    icon: 'close',
    key: 'close',
    label: p.menuClose,
    onSelect: () => closeProject(project.id)
  }

  const dangerItem: ActionItemSpec | null = project.isAuto
    ? null
    : {
        disabled: readOnly,
        icon: 'trash',
        key: 'delete',
        label: `${p.menuDelete}…`,
        onSelect: () => setConfirmDeleteOpen(true),
        variant: 'destructive'
      }

  const confirmDialog = (
    <ConfirmDialog
      confirmLabel={p.menuDelete}
      description={p.deleteConfirm}
      destructive
      onClose={() => setConfirmDeleteOpen(false)}
      onConfirm={confirmDelete}
      open={confirmDeleteOpen}
      title={`${p.menuDelete} "${project.label}"?`}
    />
  )

  return { closeItem, confirmDialog, dangerItem, identityItems, pathItems, readOnly }
}

// Per-project actions. The kebab keeps its row-anchored Appearance popover; the
// right-click menu (ProjectContextMenu) renders the same actions with Appearance
// as a submenu. Hidden until the row is hovered, matching the + affordance.
export function ProjectMenu({
  project,
  isActive,
  scoped = false,
  onExitScope,
  anchorRef
}: {
  project: SidebarProjectTree
  isActive: boolean
  // True when rendered in the entered-project header, so removal can leave the
  // now-defunct scope.
  scoped?: boolean
  onExitScope?: () => void
  // Anchor the appearance popover to the whole row instead of the kebab, so it
  // opens flush against the sidebar's content-facing edge — otherwise a
  // right-side sidebar drags the picker across the entire panel (the kebab
  // lives at the row's outer edge). Falls back to the kebab when absent.
  anchorRef?: React.RefObject<HTMLElement | null>
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  // Open toward the content area: right when the sidebar is on the left, left
  // when the panes are flipped (sidebar on the right).
  const panesFlipped = useStore($panesFlipped)

  const { closeItem, confirmDialog, dangerItem, identityItems, pathItems, readOnly } = useProjectActions({
    isActive,
    onExitScope,
    project,
    scoped
  })

  // Appearance writes route through the adopt-aware helper: an auto project is
  // materialized on its first change (its id then changes), so close the picker
  // on adopt to stop a second write double-creating from a now-stale node.
  const applyAppearance = async (patch: { color?: null | string; icon?: null | string }) => {
    if (await setProjectAppearance(project, patch)) {
      setAppearanceOpen(false)
    }
  }

  // Set color / pick an icon — shown for explicit projects and for auto ones
  // (where selecting adopts the repo as a real project so the look sticks).
  const appearanceItem = (
    <DropdownMenuItem disabled={readOnly} onSelect={() => setAppearanceOpen(true)}>
      <Codicon name="symbol-color" size="0.875rem" />
      <span>{p.menuAppearance}</span>
    </DropdownMenuItem>
  )

  // When anchorRef is absent, PopoverAnchor wraps the trigger so the
  // appearance popover positions against this button. Keep asChild chains free
  // of non-forwarding wrappers (#67500).
  const triggerButton = (
    <DropdownMenuTrigger asChild>
      <button
        aria-label={p.menu}
        className="grid size-4 shrink-0 place-items-center rounded-sm bg-transparent text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) hover:text-foreground group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        onClick={event => event.stopPropagation()}
        type="button"
      >
        <Codicon name="ellipsis" size="0.75rem" />
      </button>
    </DropdownMenuTrigger>
  )

  const trigger = anchorRef ? triggerButton : <PopoverAnchor asChild>{triggerButton}</PopoverAnchor>

  return (
    <Popover onOpenChange={setAppearanceOpen} open={appearanceOpen}>
      {/* Position the appearance popover against the row (when a ref is wired);
          the kebab is only the dropdown trigger then. */}
      {anchorRef ? <PopoverAnchor virtualRef={anchorRef as React.RefObject<HTMLElement>} /> : null}
      <DropdownMenu>
        {trigger}
        {/* Closing the menu refocuses the trigger (also the popover anchor),
            which the appearance popover would read as focus-outside and die on.
            Suppress that refocus so it survives. */}
        <DropdownMenuContent
          align="end"
          className="w-48"
          onCloseAutoFocus={event => event.preventDefault()}
          sideOffset={6}
        >
          {readOnly && (
            <DropdownMenuLabel className="whitespace-normal font-normal">{p.unavailableAllProfiles}</DropdownMenuLabel>
          )}
          {project.isAuto ? (
            // Inherited (auto) repos can still be themed — the change adopts the
            // repo as a real project. Rename / add-folder / set-active stay out
            // until then (they need the materialized record).
            project.path && (
              <>
                {appearanceItem}
                <DropdownMenuSeparator />
              </>
            )
          ) : (
            <>
              {identityItems.slice(0, 1).map(item => renderActionItem(DROPDOWN_KIT, item))}
              {appearanceItem}
              {identityItems.slice(1).map(item => renderActionItem(DROPDOWN_KIT, item))}
              <DropdownMenuSeparator />
            </>
          )}
          {pathItems.map(item => renderActionItem(DROPDOWN_KIT, item))}
          <DropdownMenuSeparator />
          {renderActionItem(DROPDOWN_KIT, closeItem)}
          {dangerItem && renderActionItem(DROPDOWN_KIT, dangerItem)}
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="start"
        className="w-auto p-2"
        onClick={event => event.stopPropagation()}
        side={panesFlipped ? 'left' : 'right'}
        sideOffset={6}
      >
        <ProjectAppearancePicker
          color={project.color ?? null}
          icon={project.icon ?? null}
          noColorLabel={p.noColor}
          onColor={color => void applyAppearance({ color })}
          onIcon={icon => void applyAppearance({ icon })}
        />
      </PopoverContent>
      {confirmDialog}
    </Popover>
  )
}

interface ProjectContextMenuProps {
  project: SidebarProjectTree
  isActive: boolean
  scoped?: boolean
  onExitScope?: () => void
  children: React.ReactNode
}

// Wrap a project row so right-clicking it opens the same actions as its kebab.
// The kebab's row-anchored Appearance popover can't nest in a context menu, so
// here Appearance is a submenu with the same swatch + icon picker.
export function ProjectContextMenu({
  project,
  isActive,
  scoped = false,
  onExitScope,
  children
}: ProjectContextMenuProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects

  const { closeItem, confirmDialog, dangerItem, identityItems, pathItems, readOnly } = useProjectActions({
    isActive,
    onExitScope,
    project,
    scoped
  })

  const canTheme = !project.isAuto || Boolean(project.path)

  const applyAppearance = (patch: { color?: null | string; icon?: null | string }) => {
    void setProjectAppearance(project, patch)
  }

  const items = (kit: MenuKit) => (
    <>
      {readOnly && <kit.Label className="whitespace-normal font-normal">{p.unavailableAllProfiles}</kit.Label>}
      {identityItems.map(item => renderActionItem(kit, item))}
      {canTheme && (
        <kit.Sub>
          <kit.SubTrigger disabled={readOnly}>
            <Codicon name="symbol-color" size="0.875rem" />
            <span>{p.menuAppearance}</span>
          </kit.SubTrigger>
          <kit.SubContent className="w-auto p-2">
            <ProjectAppearancePicker
              color={project.color ?? null}
              icon={project.icon ?? null}
              noColorLabel={p.noColor}
              onColor={color => applyAppearance({ color })}
              onIcon={icon => applyAppearance({ icon })}
            />
          </kit.SubContent>
        </kit.Sub>
      )}
      {(identityItems.length > 0 || canTheme) && <kit.Separator />}
      {pathItems.map(item => renderActionItem(kit, item))}
      <kit.Separator />
      {renderActionItem(kit, closeItem)}
      {dangerItem && renderActionItem(kit, dangerItem)}
    </>
  )

  return (
    <>
      <ActionsContextMenu ariaLabel={p.menu} contentClassName="w-48" items={items}>
        {children}
      </ActionsContextMenu>
      {confirmDialog}
    </>
  )
}
