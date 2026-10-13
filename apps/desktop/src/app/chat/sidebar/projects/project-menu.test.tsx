import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { dismissAutoProject, restoreAutoProject } from '@/store/layout'
import { notify } from '@/store/notifications'
import { setShowAllProfiles } from '@/store/profile'
import { closeProject, deleteProject, openProjectFolders } from '@/store/projects'

import { ProjectContextMenu, ProjectMenu } from './project-menu'
import type { SidebarProjectTree } from './workspace-groups'

const tipTrigger = (el: HTMLElement) => el.closest('[data-slot="tooltip-trigger"]')

afterEach(() => {
  cleanup()
  setShowAllProfiles(false)
  vi.clearAllMocks()
})

// jsdom doesn't implement ResizeObserver; Radix's PopoverContent/Arrow use it
// (via @radix-ui/react-use-size) to measure the arrow once the popover is
// actually mounted.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { cancel: 'Cancel', confirm: 'Confirm', done: 'Done', loading: 'Loading…' },
      sidebar: {
        projects: {
          copyPath: 'Copy path',
          deleteConfirm: 'This cannot be undone.',
          menu: 'Actions',
          menuAddFolder: 'Add folder',
          manageFolders: 'Manage folders',
          menuAppearance: 'Appearance',
          menuClose: 'Close project',
          menuDelete: 'Delete',
          menuRename: 'Rename',
          menuSetActive: 'Set active',
          noColor: 'No color',
          hiddenFromSidebar: 'Hidden from sidebar',
          removeFromSidebar: 'Remove from sidebar',
          reveal: 'Reveal in file manager',
          undoHide: 'Undo',
          unavailableAllProfiles: 'Project settings are read-only in All profiles.'
        }
      }
    }
  })
}))

vi.mock('@/store/layout', () => ({
  $panesFlipped: {
    get: () => false,
    listen: () => () => {},
    subscribe: (fn: (v: boolean) => void) => {
      fn(false)

      return () => {}
    }
  },
  dismissAutoProject: vi.fn(),
  restoreAutoProject: vi.fn()
}))

vi.mock('@/store/notifications', () => ({
  notify: vi.fn()
}))

vi.mock('@/store/projects', () => ({
  closeProject: vi.fn(),
  copyPath: vi.fn(),
  deleteProject: vi.fn(),
  openProjectAddFolder: vi.fn(),
  openProjectFolders: vi.fn(),
  openProjectRename: vi.fn(),
  revealPath: vi.fn(),
  setActiveProject: vi.fn(),
  setProjectAppearance: vi.fn().mockResolvedValue(false)
}))

const project = {
  color: null,
  icon: null,
  id: 'p1',
  isAuto: false,
  label: 'Test D',
  ownerProfile: 'worker',
  path: '/repo'
} as unknown as SidebarProjectTree

const autoProject = {
  color: null,
  icon: null,
  id: '/auto/repo',
  isAuto: true,
  label: 'repo',
  path: '/auto/repo'
} as unknown as SidebarProjectTree

const openTriggerMenu = (trigger: HTMLElement) => {
  // Radix's dropdown trigger opens on pointerdown (a synthetic 'click' fireEvent
  // alone won't do it), so fire the full mouse sequence a real click produces —
  // same technique as session-actions-menu.test.tsx (#67500).
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.click(trigger)
}

describe('ProjectMenu', () => {
  it.each([
    { isAuto: false, menu: 'kebab' },
    { isAuto: true, menu: 'kebab' },
    { isAuto: false, menu: 'context' },
    { isAuto: true, menu: 'context' }
  ])('closes a project without deleting its registration ($menu, auto: $isAuto)', ({ isAuto, menu }) => {
    const openedProject = { ...project, isAuto }

    if (menu === 'kebab') {
      render(<ProjectMenu isActive={false} project={openedProject} />)
      openTriggerMenu(screen.getByRole('button', { name: 'Actions' }))
    } else {
      render(
        <ProjectContextMenu isActive={false} project={openedProject}>
          <button type="button">Project row</button>
        </ProjectContextMenu>
      )
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Project row' }))
    }

    fireEvent.click(screen.getByRole('menuitem', { name: 'Close project' }))

    expect(closeProject).toHaveBeenCalledExactlyOnceWith(project.id)
    expect(deleteProject).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['kebab', 'context'])('keeps project management available in the all-workspaces view ($0)', menu => {
    setShowAllProfiles(true)

    if (menu === 'kebab') {
      render(<ProjectMenu isActive={false} project={project} />)
      openTriggerMenu(screen.getByRole('button', { name: 'Actions' }))
    } else {
      render(
        <ProjectContextMenu isActive={false} project={project}>
          <button type="button">Project row</button>
        </ProjectContextMenu>
      )
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Project row' }))
    }

    expect(screen.queryByText('Project settings are read-only in All profiles.')).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Manage folders' }).hasAttribute('data-disabled')).toBe(false)
    expect(screen.getByRole('menuitem', { name: 'Delete…' }).hasAttribute('data-disabled')).toBe(false)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage folders' }))
    expect(openProjectFolders).toHaveBeenCalledExactlyOnceWith({
      id: project.id,
      name: project.label,
      profile: 'worker'
    })
  })
  it('does not wrap the kebab trigger in a Tip', () => {
    render(<ProjectMenu isActive={false} project={project} />)

    const button = screen.getByRole('button', { name: 'Actions' })
    expect(tipTrigger(button)).toBeNull()
  })

  // When anchorRef is absent, PopoverAnchor wraps the dropdown trigger so the
  // appearance popover positions against the kebab. asChild must still reach
  // the real button (no non-forwarding wrappers inside the chain — #67500).
  it('opens the appearance popover through the kebab trigger when anchorRef is absent', async () => {
    render(<ProjectMenu isActive={false} project={project} />)

    const trigger = screen.getByRole('button', { name: 'Actions' })

    openTriggerMenu(trigger)

    const appearanceItem = await screen.findByRole('menuitem', { name: 'Appearance' })

    fireEvent.click(appearanceItem)

    // The color-swatch "No color" clear option only renders once the
    // appearance Popover is actually open — proving the click reached the
    // real button through the full Tip > PopoverAnchor > DropdownMenuTrigger
    // chain rather than getting silently dropped on an intermediate wrapper.
    expect(await screen.findByRole('button', { name: 'No color' })).toBeTruthy()
  }, 15000)

  // #73091: "Hide from sidebar" on an auto project used to be one-way — the
  // toast had no Undo and there was no restore control, so a mis-click was
  // permanent. Hiding must now offer an Undo whose click restores the id.
  it('hides an auto project with an Undo toast that restores it', async () => {
    render(<ProjectMenu isActive={false} project={autoProject} />)

    openTriggerMenu(screen.getByRole('button', { name: 'Actions' }))

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from sidebar' }))

    expect(dismissAutoProject).toHaveBeenCalledWith('/auto/repo')

    expect(notify).toHaveBeenCalledTimes(1)
    const input = vi.mocked(notify).mock.calls[0][0]
    expect(input.action?.label).toBe('Undo')

    // The Undo action must reach restoreAutoProject with the captured id even
    // though the row is gone — it closes over the id, not live menu state.
    expect(restoreAutoProject).not.toHaveBeenCalled()
    input.action?.onClick()
    expect(restoreAutoProject).toHaveBeenCalledWith('/auto/repo')
  }, 15000)
})
