import { LOCAL_CONNECTION_ID } from '@hermes/shared'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { isDesktopFsRemoteMode } from '@/lib/desktop-fs'
import { cn } from '@/lib/utils'
import { dismissAutoProject, restoreAutoProject } from '@/store/layout'
import { notify } from '@/store/notifications'
import { $profileScope, ALL_PROFILES } from '@/store/profile'
import {
  closeProject,
  copyPath,
  deleteProject,
  openProjectAddFolder,
  openProjectFolders,
  openProjectRename,
  revealPath,
  setActiveProject
} from '@/store/projects'

import { SIDEBAR_FOCUS_VISIBLE } from '../chrome'

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
  const target = { id: project.id, name: project.label, profile: project.ownerProfile }
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const ownerUnknown = useStore($profileScope) === ALL_PROFILES && !project.ownerProfile

  const removeAuto = () => {
    // Capture the id now: the row unmounts (and, when scoped, the scope exits)
    // the moment we dismiss, so Undo can't read it back off live menu state.
    const id = project.id

    dismissAutoProject(id)

    if (scoped) {
      onExitScope?.()
    }

    // The hide is persisted and otherwise irreversible — there is no other
    // restore control — so offer a short undo window (mirrors restoreWorktree).
    notify({
      action: { label: p.undoHide, onClick: () => restoreAutoProject(id) },
      durationMs: 8_000,
      kind: 'success',
      message: p.hiddenFromSidebar
    })
  }

  const confirmDelete = async () => {
    await deleteProject(project.id, project.ownerProfile)

    if (scoped) {
      onExitScope?.()
    }
  }

  // Rename / add folder / set active require an explicit project record.
  const identityItems: ActionItemSpec[] = project.isAuto
    ? []
    : [
        {
          disabled: ownerUnknown,
          icon: 'edit',
          key: 'rename',
          label: p.menuRename,
          onSelect: () => openProjectRename(target)
        },
        {
          disabled: ownerUnknown,
          icon: 'new-folder',
          key: 'add-folder',
          label: p.menuAddFolder,
          onSelect: () => openProjectAddFolder(target)
        },
        {
          disabled: ownerUnknown,
          icon: 'files',
          key: 'folders',
          label: p.manageFolders,
          onSelect: () => openProjectFolders(target)
        },
        {
          disabled: isActive || ownerUnknown,
          icon: 'target',
          key: 'set-active',
          label: p.menuSetActive,
          onSelect: () => void setActiveProject(project.id, project.ownerProfile)
        }
      ]

  // The OS file manager needs the local filesystem; a remote backend's
  // project is not on this computer (the file trees hide reveal the same way).
  // Another gateway's project names its own machine: one on This device opens
  // even from a remote window; one elsewhere stays listed but disabled, as no
  // file manager here can show it.
  const onThisComputer = project.connectionId ? project.connectionId === LOCAL_CONNECTION_ID : !isDesktopFsRemoteMode()

  const pathItems: ActionItemSpec[] = [
    ...(!project.connectionId && isDesktopFsRemoteMode()
      ? []
      : [
          {
            disabled: !project.path || !onThisComputer,
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
    ? { key: 'hide-auto', icon: 'eye-closed', label: p.removeFromSidebar, onSelect: removeAuto }
    : {
        disabled: ownerUnknown,
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

  return { closeItem, confirmDialog, dangerItem, identityItems, pathItems }
}

// The kebab and right-click menu share the same project actions.
export function ProjectMenu({
  project,
  isActive,
  scoped = false,
  onExitScope
}: {
  project: SidebarProjectTree
  isActive: boolean
  // True when rendered in the entered-project header, so removal can leave the
  // now-defunct scope.
  scoped?: boolean
  onExitScope?: () => void
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects

  const { closeItem, confirmDialog, dangerItem, identityItems, pathItems } = useProjectActions({
    isActive,
    onExitScope,
    project,
    scoped
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={p.menu}
            className={cn(
              'grid size-4 shrink-0 place-items-center rounded-sm bg-transparent text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100',
              SIDEBAR_FOCUS_VISIBLE,
              scoped ? 'group-hover/section:opacity-100' : 'group-hover/workspace:opacity-100'
            )}
            onClick={event => event.stopPropagation()}
            type="button"
          >
            <Codicon name="ellipsis" size="0.75rem" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" sideOffset={6}>
          {identityItems.map(item => renderActionItem(DROPDOWN_KIT, item))}
          {identityItems.length > 0 && <DropdownMenuSeparator />}
          {pathItems.map(item => renderActionItem(DROPDOWN_KIT, item))}
          <DropdownMenuSeparator />
          {renderActionItem(DROPDOWN_KIT, closeItem)}
          {dangerItem && renderActionItem(DROPDOWN_KIT, dangerItem)}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </>
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
export function ProjectContextMenu({
  project,
  isActive,
  scoped = false,
  onExitScope,
  children
}: ProjectContextMenuProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects

  const { closeItem, confirmDialog, dangerItem, identityItems, pathItems } = useProjectActions({
    isActive,
    onExitScope,
    project,
    scoped
  })

  const items = (kit: MenuKit) => (
    <>
      {identityItems.map(item => renderActionItem(kit, item))}
      {identityItems.length > 0 && <kit.Separator />}
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
