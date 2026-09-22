import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as Nanostores from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $activeGatewayProfile } from '@/store/profile'

import { ProjectDialog } from './project-dialog'

afterEach(() => {
  cleanup()
  $projectDialog.set({ mode: 'create' })
  vi.clearAllMocks()
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { cancel: 'Cancel', save: 'Save' },
      sidebar: {
        projects: {
          addFolder: 'Add folder',
          create: 'Create',
          createDesc: 'Create a new project',
          createFailed: 'Failed to create project',
          createTitle: 'New project',
          foldersLabel: 'Folders',
          ideaGenerate: 'Generate',
          ideaGenerating: 'Generating…',
          ideaLabel: 'Idea',
          ideaPlaceholder: 'What are you building?',
          ideaShuffle: 'Shuffle ideas',
          ideaTemplates: {
            rocket: { label: '火箭追踪', idea: '用于追踪火箭发射的项目。' }
          },
          namePlaceholder: 'Project name',
          noFolders: 'No folders yet',
          primaryBadge: 'Primary',
          removeFolder: 'Remove folder'
        }
      }
    }
  })
}))

// $projectDialog is a real nanostore atom in the app; recreate it here so
// useStore behaves identically without pulling in the rest of the projects
// store (backend calls, project list, etc.) which is irrelevant to the dialog
// interactions under test.
// vi.mock factories are hoisted above the rest of the file, so the atom must
// be created inside vi.hoisted to exist by the time the factory runs.
const { $newProjectDropPlacement, $projectDialog, createProject, enterProject, pickProjectFolder } = vi.hoisted(() => {
  const { atom } = require('nanostores') as typeof Nanostores

  return {
    // Where a "New project" DRAG armed its drop (null = plain click).
    $newProjectDropPlacement: atom<{ anchor: string; before?: null | string; dir: string } | null>(null),
    $projectDialog: atom<{
      mode: 'create' | 'rename' | 'add-folder'
      name?: string
      projectId?: string
      isCurrent?: () => boolean
    } | null>({
      mode: 'create'
    }),
    createProject: vi.fn(),
    enterProject: vi.fn(),
    pickProjectFolder: vi.fn()
  }
})

vi.mock('@/store/projects', () => ({
  $newProjectDropPlacement,
  $projectDialog,
  addProjectFolder: vi.fn(),
  clearNewProjectDropPlacement: vi.fn(),
  closeProjectDialog: vi.fn(),
  createProject,
  enterProject,
  generateProjectIdea: vi.fn(),
  goToProject: vi.fn(),
  pickProjectFolder,
  renameProject: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  createProject.mockResolvedValue({ id: 'p_created' })
  pickProjectFolder.mockResolvedValue('/Users/test/my-folder')
})

vi.mock('@/store/notifications', () => ({
  notifyError: vi.fn()
}))

vi.mock('@/lib/project-idea-templates', () => ({
  randomIdeaTemplates: () => [{ emoji: '🚀', id: 'rocket' }]
}))

const tipTrigger = (el: HTMLElement) => el.closest('[data-slot="tooltip-trigger"]')

// Fill the create form and click Create once the form is actually submittable
// (creation requires a name + at least one folder, so the button stays
// disabled until both are in). Awaiting the enable also keeps an async submit
// from one test leaking into the next.
async function fillCreateForm() {
  fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Skunkworks' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))
  await screen.findByText('/Users/test/my-folder')

  const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement

  await waitFor(() => expect(create.disabled).toBe(false))
  fireEvent.click(create)
}

describe('ProjectDialog', () => {
  it('refuses to create when the draft or owner changed while the dialog was open', async () => {
    const { createProject } = vi.mocked(await import('@/store/projects'))
    const { notifyError } = vi.mocked(await import('@/store/notifications'))
    notifyError.mockClear()
    createProject.mockClear()
    let current = true
    $projectDialog.set({ mode: 'create', isCurrent: () => current })
    render(<ProjectDialog />)
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Scoped project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))
    await screen.findByText('/Users/test/my-folder')
    current = false
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(notifyError).toHaveBeenCalled())
    expect(createProject).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('Scoped project')).toBeTruthy()
    $projectDialog.set({ mode: 'create' })
  })

  it('discards a folder chosen after the add-folder dialog changes owner', async () => {
    const { addProjectFolder, pickProjectFolder } = vi.mocked(await import('@/store/projects'))
    let finish!: (path: string) => void
    pickProjectFolder.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    let current = true
    $projectDialog.set({ mode: 'add-folder', projectId: 'p_owner_a', isCurrent: () => current })
    render(<ProjectDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))
    current = false
    await act(async () => {
      finish('/owner-a/folder')
    })
    expect(addProjectFolder).not.toHaveBeenCalled()
  })
  it('creates from the folder basename and enters the created project when the name is empty', async () => {
    const { goToProject } = vi.mocked(await import('@/store/projects'))
    render(<ProjectDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))

    await screen.findByDisplayValue('my-folder')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ folders: ['/Users/test/my-folder'], name: 'my-folder' })
      )
      expect(goToProject).toHaveBeenCalledWith('p_created', { newSession: true })
    })
  })

  it('keeps an explicit project name when a folder is selected', async () => {
    render(<ProjectDialog />)

    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'My project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))

    await screen.findByRole('button', { name: 'Remove folder' })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'My project' }))
    })
  })
  it('wraps the "shuffle idea" button in a Tip', () => {
    render(<ProjectDialog />)

    const button = screen.getByRole('button', { name: 'Shuffle ideas' })
    expect(tipTrigger(button)).toBeTruthy()
  })

  it('renders the localized idea template and inserts its localized content', () => {
    render(<ProjectDialog />)

    fireEvent.click(screen.getByRole('button', { name: '火箭追踪' }))

    expect(screen.getByDisplayValue('用于追踪火箭发射的项目。')).toBeTruthy()
  })

  it('wraps the "remove folder" button in a Tip once a folder is added', async () => {
    render(<ProjectDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))

    const button = await screen.findByRole('button', { name: 'Remove folder' })
    expect(tipTrigger(button)).toBeTruthy()
  })

  it('forwards an armed drag placement to createProject on submit', async () => {
    const { clearNewProjectDropPlacement, createProject } = vi.mocked(await import('@/store/projects'))
    const placement = { anchor: 'workspace', dir: 'center' }

    $newProjectDropPlacement.set(placement)
    render(<ProjectDialog />)
    await fillCreateForm()
    await waitFor(() => expect(createProject).toHaveBeenCalledOnce())
    expect(createProject).toHaveBeenCalledTimes(1)

    expect(createProject.mock.calls[0]?.[0]).toMatchObject({ dropPlacement: placement })

    // Closing the dialog clears the store's arm so no later create inherits it.
    // The clear rides the post-close effect, so wait for it to flush.
    await waitFor(() => expect(clearNewProjectDropPlacement).toHaveBeenCalled())
  })

  it('keeps the armed placement when the create FAILS, so a retry still lands where dropped', async () => {
    const { clearNewProjectDropPlacement, createProject } = vi.mocked(await import('@/store/projects'))
    const placement = { anchor: 'workspace', dir: 'right' }

    vi.mocked(createProject).mockClear()
    vi.mocked(clearNewProjectDropPlacement).mockClear()
    vi.mocked(createProject).mockRejectedValueOnce(new Error('gateway hiccup'))

    $newProjectDropPlacement.set(placement)
    render(<ProjectDialog />)
    await fillCreateForm()
    await waitFor(() => expect(createProject).toHaveBeenCalledOnce())

    // The failed attempt consumed nothing and closed nothing — the dialog
    // stays open for a retry with the placement intact.
    expect(clearNewProjectDropPlacement).not.toHaveBeenCalled()
    expect(createProject.mock.calls[0]?.[0]).toMatchObject({ dropPlacement: placement })

    // Retry succeeds → forwards the SAME placement.
    await fillCreateForm()
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(2))
    expect(createProject.mock.calls[1]?.[0]).toMatchObject({ dropPlacement: placement })
  })

  it('sends no placement when opened by a plain click', async () => {
    const { createProject } = vi.mocked(await import('@/store/projects'))

    vi.mocked(createProject).mockClear()
    $newProjectDropPlacement.set(null)
    render(<ProjectDialog />)
    await fillCreateForm()
    await waitFor(() => expect(createProject).toHaveBeenCalledOnce())

    expect(createProject.mock.calls[0]?.[0]).toMatchObject({ dropPlacement: undefined })
  })

  it('opens a new chat in the created project after a successful plain-click create', async () => {
    const { createProject, goToProject } = vi.mocked(await import('@/store/projects'))
    createProject.mockResolvedValueOnce({
      id: 'p_new',
      name: 'Skunkworks',
      slug: 'skunkworks',
      description: null,
      icon: null,
      color: null,
      board_slug: null,
      primary_path: '/Users/test/my-folder',
      archived: false,
      created_at: 1,
      folders: [{ path: '/Users/test/my-folder', label: null, is_primary: true, added_at: 1 }]
    })
    $newProjectDropPlacement.set(null)
    render(<ProjectDialog />)
    await fillCreateForm()
    await waitFor(() => expect(goToProject).toHaveBeenCalledWith('p_new', { newSession: true }))
  })

  it.each(['dismissed', 'profile-switched'])('does not open a chat after the create intent is %s', async reason => {
    const { createProject, goToProject } = vi.mocked(await import('@/store/projects'))
    let finish!: (result: Awaited<ReturnType<typeof createProject>>) => void
    createProject.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    goToProject.mockClear()
    $newProjectDropPlacement.set(null)
    $projectDialog.set({ mode: 'create' })
    const originalProfile = $activeGatewayProfile.get()
    render(<ProjectDialog />)
    await fillCreateForm()

    await act(async () => {
      if (reason === 'dismissed') {
        $projectDialog.set(null)
      } else {
        $activeGatewayProfile.set('different-profile')
      }

      finish({
        id: 'p_delayed',
        name: 'Delayed',
        slug: 'delayed',
        description: null,
        icon: null,
        color: null,
        board_slug: null,
        primary_path: '/Users/test/my-folder',
        archived: false,
        created_at: 1,
        folders: [{ path: '/Users/test/my-folder', label: null, is_primary: true, added_at: 1 }]
      })
    })
    expect(goToProject).not.toHaveBeenCalled()
    $activeGatewayProfile.set(originalProfile)
    $projectDialog.set({ mode: 'create' })
  })
})
