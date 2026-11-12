import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $workspaceOwnerLabels, setWorkspaceOwnerLabel } from '@/components/pane-shell/workspace-scope'
import { getApiRequestConnection, renameSession } from '@/hermes'
import { $botChatScopes } from '@/store/bot-chat-scope'
import { $notificationEpoch } from '@/store/notifications'
import { refreshProjectTree } from '@/store/projects'
import { $sessionTiles, sessionTileDelegate } from '@/store/session-states'

import { SessionActionsMenu, SessionContextMenu } from './session-actions-menu'

afterEach(() => {
  cleanup()
  $workspaceOwnerLabels.set({})
  $botChatScopes.set({})
  $sessionTiles.set([])
  vi.mocked(sessionTileDelegate).mockReturnValue(null)
  vi.mocked(getApiRequestConnection).mockReturnValue(null)
})

// Exercises the real SessionActionsMenu end-to-end (no DropdownMenu mock) so
// a broken asChild composition on the kebab trigger fails here — the menu
// must still open on click.

vi.mock('@/components/pane-shell/tree/store', () => ({
  closeAllTreeTabs: vi.fn(),
  closeOtherTreeTabs: vi.fn(),
  closeTreeTabsToRight: vi.fn(),
  treeTabCloseTargets: vi.fn(() => null)
}))
vi.mock('@/hermes', () => ({
  getApiRequestConnection: vi.fn(() => null),
  getApiRequestProfile: vi.fn(() => 'default'),
  renameSession: vi.fn(),
  setApiRequestProfile: vi.fn(),
  setSessionUnreadRemote: vi.fn(() => Promise.resolve({ ok: true }))
}))
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: {
        cancel: 'Cancel',
        close: 'Close',
        confirm: 'Confirm',
        delete: 'Delete',
        done: 'Done',
        loading: 'Loading…',
        save: 'Save'
      },
      errors: { genericFailure: 'Something went wrong' },
      sidebar: {
        projects: {
          menuAppearance: 'Appearance',
          moveFailed: 'Could not move session',
          moveNoProjects: 'No other projects',
          movedTo: (name: string) => `Moved to ${name}`,
          moveToProject: 'Move to project',
          noColor: 'No color'
        },
        row: {
          archive: 'Archive',
          branchFrom: 'Branch from here',
          copyId: 'Copy ID',
          copyIdFailed: 'Failed to copy ID',
          deleteDesc: (title: string) => `Delete ${title}?`,
          deleteTitle: 'Delete session?',
          deleting: 'Deleting…',
          deleted: 'Session deleted',
          export: 'Export',
          hideTabBar: 'Hide tab bar',
          markRead: 'Mark as read',
          pin: 'Pin',
          rename: 'Rename',
          renameDesc: 'Leave empty to clear.',
          renameFailed: 'Rename failed',
          renameTitle: 'Rename session',
          renamed: 'Renamed',
          sessionActions: 'Session actions',
          unarchive: 'Unarchive',
          unpin: 'Unpin',
          untitledPlaceholder: 'Untitled'
        }
      },
      zones: { closeAll: 'Close all', closeOthers: 'Close others', closeToRight: 'Close to the right' }
    }
  })
}))
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/lib/profile-color', () => ({ PROFILE_SWATCHES: [] }))
vi.mock('@/lib/session-export', () => ({ exportSession: vi.fn() }))
vi.mock('@/store/gateway', () => ({ activeGateway: vi.fn(() => null) }))
vi.mock('@/store/notifications', () => ({ $notificationEpoch: atom(0), notify: vi.fn(), notifyError: vi.fn() }))
vi.mock('@/store/projects', () => ({
  applyRenamedSessionTitle: vi.fn(),
  $projectTree: atom<unknown[]>([]),
  moveSessionToProject: vi.fn(),
  projectIdForCwd: vi.fn(() => null),
  projectRootCwd: vi.fn(() => ''),
  refreshProjectTree: vi.fn(() => Promise.resolve())
}))
vi.mock('@/store/session', () => ({
  applySessionTitle: vi.fn(),
  $activeSessionId: atom<null | string>(null),
  $connection: atom<null | { mode: string }>(null),
  $cronSessions: atom<unknown[]>([]),
  $messagingSessions: atom<unknown[]>([]),
  $selectedStoredSessionId: atom<null | string>(null),
  $sessions: atom<unknown[]>([]),
  $unreadFinishedSessionIds: atom<string[]>([]),
  markSessionRead: vi.fn(),
  sessionMatchesStoredId: vi.fn(() => false),
  sessionPinId: vi.fn((s: { id: string }) => s.id),
  setSessions: vi.fn()
}))
vi.mock('@/store/session-color', () => ({
  $sessionColorOverrides: atom<Record<string, string>>({}),
  setSessionColorOverride: vi.fn()
}))
vi.mock('@/store/session-states', () => ({
  $sessionStates: atom<Record<string, unknown>>({}),
  $sessionTiles: atom<unknown[]>([]),
  closeAllOpenSessionTiles: vi.fn(),
  openSessionTile: vi.fn(),
  sessionTileDelegate: vi.fn(() => null)
}))
vi.mock('@/store/windows', () => ({
  canOpenSessionInTerminal: () => false,
  canOpenSessionWindow: () => false,
  isBrowserWindow: () => false,
  isSecondaryWindow: () => false,
  openSessionInNewWindow: vi.fn(),
  openSessionInTerminal: vi.fn()
}))

function renderMenu() {
  return render(
    <SessionActionsMenu sessionId="s1" title="My session">
      <button aria-label="Session actions" type="button">
        ⋮
      </button>
    </SessionActionsMenu>
  )
}

describe('SessionActionsMenu', () => {
  it('opens the dropdown on click', async () => {
    renderMenu()

    const trigger = screen.getByRole('button', { name: 'Session actions' })

    // Radix's dropdown trigger opens on pointerdown (not on the synthetic
    // 'click' fireEvent alone would dispatch), so fire the full mouse
    // sequence a real click produces.
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)

    expect(await screen.findByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /archive/i })).toBeTruthy()
  })

  it('opens the rename dialog focused on its input, not the row trigger', async () => {
    renderMenu()

    const trigger = screen.getByRole('button', { name: 'Session actions' })

    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)

    const rename = await screen.findByRole('menuitem', { name: /rename/i })
    fireEvent.click(rename)

    // The dialog opens and its textbox takes focus. If the menu's close restored
    // focus to the row trigger instead, Space would activate the row and the
    // arrow keys would move the list rather than the caret (the reported bug).
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox')

    // eslint-disable-next-line no-restricted-globals -- asserting real focus requires the live document
    await waitFor(() => expect(document.activeElement).toBe(input))
    // eslint-disable-next-line no-restricted-globals -- asserting real focus requires the live document
    expect(document.activeElement).not.toBe(trigger)
  })

  it.each([
    { surface: 'dropdown', Component: SessionActionsMenu },
    { surface: 'context menu', Component: SessionContextMenu }
  ])('preserves the rename draft across background title updates in the $surface', async ({ surface, Component }) => {
    vi.mocked(renameSession).mockClear()

    const view = (title: string) => (
      <Component sessionId="s1" title={title}>
        <button aria-label="Session actions" type="button">
          Menu
        </button>
      </Component>
    )

    const { rerender } = render(view('Initial title'))

    const openRename = async () => {
      const trigger = screen.getByRole('button', { name: 'Session actions' })

      if (surface === 'context menu') {
        fireEvent.contextMenu(trigger)
      } else {
        fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
        fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
        fireEvent.click(trigger)
      }

      fireEvent.click(await screen.findByRole('menuitem', { name: /rename/i }))
      const input = within(await screen.findByRole('dialog')).getByRole('textbox') as HTMLInputElement
      await waitFor(() => expect(globalThis.document.activeElement).toBe(input))

      return input
    }

    const input = await openRename()
    fireEvent.change(input, { target: { value: 'My edited title' } })
    rerender(view('Background generated title'))
    expect(input.value).toBe('My edited title')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(renameSession).not.toHaveBeenCalled()
    rerender(view('Latest saved title'))
    const reopened = await openRename()
    expect(reopened.value).toBe('Latest saved title')

    fireEvent.change(reopened, { target: { value: 'My final title' } })
    rerender(view('Another background title'))
    expect(reopened.value).toBe('My final title')
    vi.mocked(renameSession).mockResolvedValueOnce({ ok: true, title: 'My final title' })

    if (surface === 'context menu') {
      fireEvent.keyDown(reopened, { key: 'Enter' })
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    }

    await waitFor(() => expect(renameSession).toHaveBeenCalledWith('s1', 'My final title', undefined))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('passes profile to renameSession when submitting from RenameSessionDialog', async () => {
    const { renameSession } = await import('@/hermes')
    vi.mocked(renameSession).mockResolvedValue({ ok: true, title: 'Prep Butler' })

    render(
      <SessionActionsMenu profile="personal" sessionId="s1" title="My session">
        <button aria-label="Session actions" type="button">
          ⋮
        </button>
      </SessionActionsMenu>
    )

    const trigger = screen.getByRole('button', { name: 'Session actions' })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)

    const rename = await screen.findByRole('menuitem', { name: /rename/i })
    fireEvent.click(rename)

    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Prep Butler' } })

    const save = within(dialog).getByRole('button', { name: /save/i })
    fireEvent.click(save)

    await waitFor(() => {
      expect(renameSession).toHaveBeenCalledWith('s1', 'Prep Butler', 'personal')
    })
  })

  it('confirms before deleting — cancel keeps the session, confirm deletes it', async () => {
    const onDelete = vi.fn()
    render(
      <SessionActionsMenu onDelete={onDelete} sessionId="s1" title="My session">
        <button aria-label="Session actions" type="button">
          ⋮
        </button>
      </SessionActionsMenu>
    )

    const trigger = screen.getByRole('button', { name: 'Session actions' })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)

    const deleteItem = await screen.findByRole('menuitem', { name: /delete/i })
    fireEvent.click(deleteItem)

    // The confirm dialog is up and names the session being deleted.
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getAllByText(/My session/).length).toBeGreaterThan(0)

    // Cancel: nothing is deleted.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()

    // Re-open the menu and confirm: only now does the delete call fire.
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)
    const deleteItemAgain = await screen.findByRole('menuitem', { name: /delete/i })
    fireEvent.click(deleteItemAgain)

    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    // ConfirmDialog shows a done beat before auto-closing (600ms); awaiting it
    // also drains the async run() update inside act().
    expect(await screen.findByText('Session deleted')).toBeTruthy()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('names the exact bot owner in deletion confirmation while preserving its canonical session identity', async () => {
    const onDelete = vi.fn()
    setWorkspaceOwnerLabel('bot:right', '创建修复验证')
    setWorkspaceOwnerLabel('bot:other', '另一个机器人')
    $botChatScopes.set({
      'bot-chat': { workspaceMode: 'bots', workspaceOwnerKey: 'bot:right', workspaceTabTitle: 'Bot Chat' }
    })
    $sessionTiles.set([
      {
        storedSessionId: 'other-chat',
        workspaceMode: 'bots',
        workspaceOwnerKey: 'bot:other',
        workspaceTabTitle: 'Bot Chat'
      }
    ])
    render(
      <SessionActionsMenu onDelete={onDelete} renameable={false} sessionId="bot-chat" title="Bot Chat">
        <button>Actions</button>
      </SessionActionsMenu>
    )

    const openDelete = async () => {
      const trigger = screen.getByRole('button', { name: 'Actions' })
      fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
      fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
      fireEvent.click(trigger)
      fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }))
      await screen.findByRole('dialog')
    }

    await openDelete()
    expect(screen.getByText('Delete 创建修复验证?')).toBeTruthy()
    expect(screen.queryByText('Delete Bot Chat?')).toBeNull()
    expect(screen.queryByText('Delete 另一个机器人?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    act(() => setWorkspaceOwnerLabel('bot:right', '新机器人名称'))
    await openDelete()
    expect(screen.getByText('Delete 新机器人名称?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect($botChatScopes.get()['bot-chat'].workspaceTabTitle).toBe('Bot Chat')
  })

  it('disables the delete item when no onDelete is provided', async () => {
    render(
      <SessionActionsMenu sessionId="s1" title="My session">
        <button aria-label="Session actions" type="button">
          ⋮
        </button>
      </SessionActionsMenu>
    )

    const trigger = screen.getByRole('button', { name: 'Session actions' })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)

    const deleteItem = await screen.findByRole('menuitem', { name: /delete/i })
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true')
  })

  it('retains a rejected deletion in the original dialog for retry', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('Delete refused')).mockResolvedValue(undefined)
    render(
      <SessionActionsMenu onDelete={onDelete} sessionId="s1" title="My session">
        <button>Actions</button>
      </SessionActionsMenu>
    )
    const trigger = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Delete refused')).toBeTruthy()
    expect(screen.queryByText('Session deleted')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Session deleted')).toBeTruthy()
    expect(onDelete).toHaveBeenCalledTimes(2)
  })

  it.each([SessionActionsMenu, SessionContextMenu])(
    'offers reversible sidebar removal through the captured action owner',
    async Component => {
      let reject!: (error: Error) => void

      const archiveSession = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, fail) => {
              reject = fail
            })
        )
        .mockResolvedValueOnce(undefined)

      const onDelete = vi.fn()
      vi.mocked(sessionTileDelegate).mockReturnValue({ archiveSession } as never)
      render(
        <Component onDelete={onDelete} profile="Research workspace" sessionId="owned-session" title="Notes">
          <button>Actions</button>
        </Component>
      )
      const trigger = screen.getByRole('button', { name: 'Actions' })

      if (Component === SessionContextMenu) {
        fireEvent.contextMenu(trigger)
      } else {
        fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
        fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
        fireEvent.click(trigger)
      }

      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Research workspace')).toBeTruthy()
      expect(within(dialog).getByText(/compressed history and delegated subtask history/)).toBeTruthy()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from sidebar' }))
      expect(archiveSession).toHaveBeenCalledWith('owned-session', { throwOnError: true })
      expect(onDelete).not.toHaveBeenCalled()
      expect(within(dialog).getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(true)
      await act(async () => reject(new Error('Archive refused')))
      expect(within(dialog).getByRole('alert').textContent).toBe('Archive refused')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from sidebar' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(archiveSession).toHaveBeenCalledTimes(2)
    }
  )

  it('retires the captured decision on account reset and never retargets it after a session switch', async () => {
    const firstDelete = vi.fn()
    const nextDelete = vi.fn()

    const view = (sessionId: string, onDelete: () => void) => (
      <SessionActionsMenu onDelete={onDelete} sessionId={sessionId} title={sessionId}>
        <button>Actions</button>
      </SessionActionsMenu>
    )

    const { rerender } = render(view('first-session', firstDelete))

    const openDelete = async () => {
      const trigger = screen.getByRole('button', { name: 'Actions' })
      fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
      fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
      fireEvent.click(trigger)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
      await screen.findByRole('dialog')
    }

    await openDelete()
    rerender(view('next-session', nextDelete))
    expect(screen.queryByRole('dialog')).toBeNull()
    await openDelete()
    act(() => $notificationEpoch.set($notificationEpoch.get() + 1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(firstDelete).not.toHaveBeenCalled()
    expect(nextDelete).not.toHaveBeenCalled()
  })

  // The sidebar's Archived view reuses this menu; its rows must offer the
  // restore verb instead of a no-op re-archive (#98813). The item still fires
  // the shared onArchive callback — the wiring dispatches it to the restore
  // path based on the row's archived state.
  it('labels the archive verb Unarchive for an already-archived row and fires the shared callback', async () => {
    const onArchive = vi.fn()
    render(
      <SessionActionsMenu archived onArchive={onArchive} sessionId="s1" title="My session">
        <button aria-label="Session actions" type="button">
          ⋮
        </button>
      </SessionActionsMenu>
    )

    const trigger = screen.getByRole('button', { name: 'Session actions' })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)

    const restoreItem = await screen.findByRole('menuitem', { name: /^unarchive$/i })
    expect(screen.queryByRole('menuitem', { name: /^archive$/i })).toBeNull()

    fireEvent.click(restoreItem)
    await waitFor(() => expect(onArchive).toHaveBeenCalledTimes(1))
  })

  it('focuses Cancel on delete, confirms Enter on Delete, and cancels with Escape', async () => {
    const onDelete = vi.fn()
    render(
      <SessionActionsMenu onDelete={onDelete} sessionId="s1" title="My session">
        <button aria-label="Session actions" type="button">
          ⋮
        </button>
      </SessionActionsMenu>
    )

    const trigger = screen.getByRole('button', { name: 'Session actions' })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()

    // Escape cancels: dialog closes, nothing is deleted.
    fireEvent.keyDown(window.document, { key: 'Escape' })
    expect(await screen.queryByRole('dialog')).toBeNull()
    expect(onDelete).not.toHaveBeenCalled()

    // Re-opening must focus the safe action. Deletion requires moving focus
    // to Delete before pressing Enter.
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }))

    const reopened = await screen.findByRole('dialog')
    const cancel = within(reopened).getByRole('button', { name: 'Cancel' })
    // eslint-disable-next-line no-restricted-globals -- asserting real focus requires the live document
    await waitFor(() => expect(document.activeElement).toBe(cancel))
    fireEvent.keyDown(cancel, { key: 'Enter' })
    expect(onDelete).not.toHaveBeenCalled()

    within(reopened).getByRole('button', { name: 'Delete' }).focus()
    // eslint-disable-next-line no-restricted-globals -- asserting real focus requires the live document
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })

    expect(await screen.findByText('Session deleted')).toBeTruthy()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('routes the same confirm guard through the context menu', async () => {
    const onDelete = vi.fn()
    render(
      <SessionContextMenu onDelete={onDelete} sessionId="s1" title="My session">
        <button aria-label="Session row" type="button">
          Row
        </button>
      </SessionContextMenu>
    )

    const row = screen.getByRole('button', { name: 'Session row' })
    fireEvent.contextMenu(row)

    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }))
    expect(await screen.findByRole('dialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Session deleted')).toBeTruthy()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  // A canonical Bot Chat tab must not offer Rename: the write can never reach
  // the caption it names (the caption is the roster label) and the backend
  // guard refuses it anyway — the old flow toasted success over a no-op
  // (#124857). The item is omitted, not disabled, so the menu shows only
  // verbs whose result the user can observe.
  it('omits Rename (and never mounts its dialog) when renameable is false', async () => {
    const { unmount } = render(
      <SessionContextMenu onDelete={vi.fn()} renameable={false} sessionId="bot-chat" title="Bot Chat">
        <button aria-label="Session row" type="button">
          Row
        </button>
      </SessionContextMenu>
    )

    const row = screen.getByRole('button', { name: 'Session row' })
    fireEvent.contextMenu(row)

    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: /rename/i })).toBeNull()
    // The other identity verbs stay available — only Rename is gated.
    expect(screen.getByRole('menuitem', { name: /^pin$/i })).toBeTruthy()

    // No rename dialog is mounted anywhere (portals included): the verb is
    // unreachable even programmatically, not just hidden from pointer users.
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
  })

  // $projectTree is only populated by a grouped-view visit or the flat view's
  // background warm timer (PROJECT_TREE_WARM_MS). Opening this submenu before
  // either fires must not silently show "No other projects" forever — it must
  // pull the authoritative tree itself.
  it('refreshes the project tree when the "Move to project" submenu opens', async () => {
    renderMenu()

    const trigger = screen.getByRole('button', { name: 'Session actions' })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)

    await screen.findByRole('menu')
    expect(refreshProjectTree).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to project' }))

    await waitFor(() => expect(refreshProjectTree).toHaveBeenCalledTimes(1))
  })
})
