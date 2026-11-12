import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WritableAtom } from 'nanostores'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import {
  $collaborationGroups,
  type CollaborationGroup,
  type CollaborationTask,
  interruptCollaborationTask
} from '@/store/collaboration-capsule'
import { $collaborationCapsuleOpen, openCollaborationCapsule } from '@/store/collaboration-capsule-view'
import { stubResizeObserver } from '@/test/jsdom'

import { CollaborationCapsule } from './collaboration-capsule'
import { openCollaborationGroup, openCollaborationTask, prepareCollaborationRetry } from './collaboration-navigation'

vi.mock('@/store/collaboration-capsule', async () => {
  const { atom } = await import('nanostores')

  return {
    $collaborationGroups: atom([]),
    interruptCollaborationTask: vi.fn().mockResolvedValue(undefined),
    steerCollaborationTask: vi.fn().mockResolvedValue(undefined)
  }
})
vi.mock('./collaboration-navigation', () => ({
  openCollaborationGroup: vi.fn().mockReturnValue(true),
  openCollaborationTask: vi.fn().mockResolvedValue(true),
  prepareCollaborationRetry: vi.fn().mockResolvedValue(true)
}))

const groups = $collaborationGroups as WritableAtom<CollaborationGroup[]>

const task = (status: CollaborationTask['status'] = 'running'): CollaborationTask => ({
  id: 'child-one',
  key: 'task-one',
  sourceKey: 'source-one',
  displayName: 'Research assistant',
  goal: 'Read the project notes',
  parentRuntimeId: 'runtime-one',
  storedSessionId: 'stored-one',
  owner: { connectionId: 'local', profile: 'default' },
  canControl: true,
  status,
  parentId: null,
  taskCount: 1,
  taskIndex: 0,
  startedAt: Date.now(),
  updatedAt: Date.now(),
  stream: [],
  filesRead: [],
  filesWritten: []
})

const group = (item: CollaborationTask): CollaborationGroup => ({
  key: 'source-one',
  title: 'Product research',
  owner: item.owner,
  storedSessionId: 'stored-one',
  workspaceMode: 'sessions',
  runtimeIds: ['runtime-one'],
  tasks: [item]
})

const publish = (item: CollaborationTask) => act(() => groups.set([group(item)]))

function mount() {
  render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <CollaborationCapsule />
        <textarea aria-label="Draft" defaultValue="Keep my draft" />
      </I18nProvider>
    </MemoryRouter>
  )
}

beforeAll(stubResizeObserver)
beforeEach(() => {
  groups.set([])
  $collaborationCapsuleOpen.set(false)
  vi.clearAllMocks()
  vi.mocked(openCollaborationTask).mockReset().mockResolvedValue(true)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('appears for real delegation facts without moving draft focus; updates keep task focus', () => {
  mount()
  const draft = screen.getByRole('textbox', { name: 'Draft' })
  draft.focus()
  publish(task())
  expect(window.document.activeElement).toBe(draft)
  expect(screen.queryByRole('region', { name: 'Collaboration' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /1 assistants collaborating/ }))
  fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
  const stop = screen.getByRole('button', { name: 'Stop task' })
  stop.focus()
  publish({ ...task(), stream: [{ at: Date.now(), kind: 'thinking', text: 'Checking notes' }] })
  expect(window.document.activeElement).toBe(stop)
  expect((draft as HTMLTextAreaElement).value).toBe('Keep my draft')
  fireEvent.keyDown(stop, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: 'Collaboration' })).toBeNull()
  expect(window.document.activeElement).toBe(screen.getByRole('button', { name: /1 assistants collaborating/ }))
})

it('stop acknowledgement stays running until terminal; expiry never revives old tasks with new work', async () => {
  vi.useFakeTimers()
  mount()
  const running = task()
  publish(running)
  fireEvent.click(screen.getByRole('button', { name: /1 assistants collaborating/ }))
  fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop task' })))
  expect(interruptCollaborationTask).toHaveBeenCalledWith(running)
  expect(screen.getByText('Stop requested')).toBeTruthy()
  expect(screen.getByRole('button', { name: /1 assistants collaborating/ })).toBeTruthy()
  publish({ ...running, status: 'interrupted' })
  expect(screen.getByRole('button', { name: /^Collaboration stopped，/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
  act(() => vi.advanceTimersByTime(6001))
  expect(screen.queryByRole('button', { name: /^Collaboration stopped，/ })).toBeNull()
  act(() =>
    groups.set([
      group({ ...running, status: 'interrupted' }),
      {
        ...group(running),
        key: 'new-source',
        tasks: [{ ...running, id: 'new', key: 'new-task', displayName: 'New assistant' }]
      }
    ])
  )
  fireEvent.click(screen.getByRole('button', { name: /1 assistants collaborating/ }))
  expect(screen.queryByRole('button', { name: /Research assistant/ })).toBeNull()
  expect(screen.getByRole('button', { name: /New assistant/ })).toBeTruthy()
})

it('keeps failure until dismissed and pauses expiry while expanded; read-only facts never show stop', () => {
  vi.useFakeTimers()
  mount()
  publish({ ...task('failed'), canControl: false, summary: 'Connection was lost' })
  act(() => vi.advanceTimersByTime(20000))
  fireEvent.click(screen.getByRole('button', { name: /1 tasks need attention/ }))
  fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
  expect(screen.queryByRole('button', { name: 'Stop task' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Return to retry' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('button', { name: /1 tasks need attention/ })).toBeNull()
  publish({ ...task('completed'), key: 'completed-task' })
  fireEvent.click(screen.getByRole('button', { name: /Collaboration complete/ }))
  act(() => vi.advanceTimersByTime(20000))
  expect(screen.getByRole('region', { name: 'Collaboration' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
  act(() => vi.advanceTimersByTime(6001))
  expect(screen.queryByRole('button', { name: /Collaboration complete/ })).toBeNull()
  act(openCollaborationCapsule)
  expect(screen.getByText('No live subagents')).toBeTruthy()
})

it('Escape from an explicit external entry closes only the capsule and returns focus', () => {
  mount()
  const draft = screen.getByRole('textbox', { name: 'Draft' })
  draft.focus()
  act(openCollaborationCapsule)
  expect(window.document.activeElement).toBe(draft)
  fireEvent.keyDown(draft, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: 'Collaboration' })).toBeNull()
  expect(window.document.activeElement).toBe(draft)
})

it('keeps completion expiry running while another page suppresses automatic presentation', () => {
  vi.useFakeTimers()

  const view = render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <CollaborationCapsule autoVisible={true} />
      </I18nProvider>
    </MemoryRouter>
  )

  publish(task('completed'))
  expect(screen.getByRole('button', { name: /Collaboration complete/ })).toBeTruthy()
  view.rerender(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <CollaborationCapsule autoVisible={false} />
      </I18nProvider>
    </MemoryRouter>
  )
  expect(screen.queryByRole('button', { name: /Collaboration complete/ })).toBeNull()
  act(() => vi.advanceTimersByTime(6001))
  view.rerender(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <CollaborationCapsule autoVisible={true} />
      </I18nProvider>
    </MemoryRouter>
  )
  expect(screen.queryByRole('button', { name: /Collaboration complete/ })).toBeNull()
})

it('retains expired receipts when another source is dismissed and the earlier source later rehydrates', () => {
  vi.useFakeTimers()
  mount()
  const completed = task('completed')
  publish(completed)
  act(() => vi.advanceTimersByTime(6001))
  publish({ ...task('failed'), key: 'other-failure', displayName: 'Other assistant' })
  fireEvent.click(screen.getByRole('button', { name: /1 tasks need attention/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  publish(completed)
  expect(screen.queryByRole('button', { name: /Collaboration complete/ })).toBeNull()
})

it('lets a focused composer dismiss its own mention list before the collaboration capsule', () => {
  mount()
  publish(task())
  fireEvent.click(screen.getByRole('button', { name: /1 assistants collaborating/ }))
  const draft = screen.getByRole('textbox', { name: 'Draft' })
  render(
    <ul id="member-suggestions" role="listbox">
      <li aria-selected="true" role="option">
        Research assistant
      </li>
    </ul>
  )
  draft.setAttribute('aria-expanded', 'true')
  draft.setAttribute('aria-controls', 'member-suggestions')

  const handleEscape = vi.fn((event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
  })

  draft.addEventListener('keydown', handleEscape)
  draft.focus()
  fireEvent.keyDown(draft, { key: 'Escape' })
  expect(handleEscape).toHaveBeenCalledOnce()
  expect(screen.getByRole('region', { name: 'Collaboration' })).toBeTruthy()
  expect(window.document.activeElement).toBe(draft)
})

it('opens the delegated conversation once and closes the capsule only after navigation succeeds', async () => {
  let finish!: (opened: boolean) => void
  vi.mocked(openCollaborationTask).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  mount()
  const delegated = task()
  publish(delegated)
  fireEvent.click(screen.getByRole('button', { name: /1 assistants collaborating/ }))
  fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
  const viewConversation = screen.getByRole('button', { name: 'View conversation' })

  await act(async () => fireEvent.click(viewConversation))
  expect(openCollaborationTask).toHaveBeenCalledWith(delegated)
  expect(openCollaborationGroup).not.toHaveBeenCalled()
  expect((viewConversation as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('region', { name: 'Collaboration' })).toBeTruthy()
  fireEvent.click(viewConversation)
  expect(openCollaborationTask).toHaveBeenCalledOnce()

  await act(async () => finish(true))
  expect($collaborationCapsuleOpen.get()).toBe(false)
  expect(screen.queryByRole('region', { name: 'Collaboration' })).toBeNull()
})

it.each(['unavailable', 'rejected'] as const)(
  'keeps the capsule and recovery message when child navigation is %s',
  async outcome => {
    if (outcome === 'rejected') {
      vi.mocked(openCollaborationTask).mockRejectedValueOnce(new Error('Connection closed'))
    } else {
      vi.mocked(openCollaborationTask).mockResolvedValueOnce(false)
    }

    mount()
    publish(task())
    fireEvent.click(screen.getByRole('button', { name: /1 assistants collaborating/ }))
    fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'View conversation' })))
    expect($collaborationCapsuleOpen.get()).toBe(true)
    expect(screen.getByRole('region', { name: 'Collaboration' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Reconnect to its workspace and try again.')
    expect((screen.getByRole('button', { name: 'View conversation' }) as HTMLButtonElement).disabled).toBe(false)
  }
)

it('keeps retry preparation on the original task source without opening its child conversation', async () => {
  mount()
  const failed = task('failed')
  publish(failed)
  fireEvent.click(screen.getByRole('button', { name: /1 tasks need attention/ }))
  fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Return to retry' })))
  expect(prepareCollaborationRetry).toHaveBeenCalledWith(failed, expect.any(Function))
  expect(openCollaborationTask).not.toHaveBeenCalled()
  expect(screen.getByRole('region', { name: 'Collaboration' })).toBeTruthy()
})
