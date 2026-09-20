// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountContext } from '@/app/account/account-context'
import { group, split } from '@/components/pane-shell/tree/model'
import { $layoutTree, noteActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { SidebarProvider } from '@/components/ui/sidebar'
import { registry } from '@/contrib/registry'
import { type AccountAdapter, createAccountActions } from '@/store/account'
import {
  $pinnedSessionIds,
  $sidebarPinsOpen,
  $sidebarRecentsOpen,
  $sidebarWorkspaceNodeOpen,
  setSidebarGrouping
} from '@/store/layout'
import { $openProjectsByProfile } from '@/store/open-projects'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $projectDialog,
  $projects,
  $projectScope,
  $projectTree,
  ALL_PROJECTS,
  closeProject,
  enterProject,
  exitProjectScope
} from '@/store/projects'
import { $selectedStoredSessionId, $sessions } from '@/store/session'
import { $removedSessionIds } from '@/store/session-removal'
import { makeSessionInfo } from '@/test/session-info'

import { type AppView, ROUTES_AREA, SIDEBAR_NAV_AREA } from '../../routes'

import { ChatSidebar } from './index'

const noop = () => {}

const noopAsync = async () => {}

const unavailableAccount = async () => {
  throw new Error('Sidebar account display must not request account services')
}

const accountActions = createAccountActions({
  kind: 'platform',
  fixedCodeHint: false,
  status: unavailableAccount,
  capabilities: unavailableAccount,
  retry: unavailableAccount,
  requestPhoneCode: unavailableAccount,
  verifyPhoneCode: unavailableAccount,
  loginExisting: unavailableAccount,
  completeSecondFactor: unavailableAccount,
  updateProfile: unavailableAccount,
  logout: unavailableAccount,
  onChanged: () => () => {}
} as AccountAdapter)

const sessionRows = [
  makeSessionInfo({ id: 'tile-one', last_active: 2, profile: 'default', started_at: 1, title: 'Tile one' }),
  makeSessionInfo({ id: 'tile-two', last_active: 2, profile: 'default', started_at: 1, title: 'Tile two' })
]

const renderSidebar = (pathname: string, currentView: AppView, onNewSessionInWorkspace = noop, onNavigate = noop) =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <AccountContext.Provider value={accountActions}>
        <SidebarProvider>
          <ChatSidebar
            currentView={currentView}
            onArchiveSession={noop}
            onBranchSession={noop}
            onDeleteSession={noop}
            onLoadMoreSessions={noop}
            onManageCronJob={noop}
            onNavigate={onNavigate}
            onNewSessionInWorkspace={onNewSessionInWorkspace}
            onNewSessionSplit={noop}
            onResumeSession={noop}
            onTriggerCronJob={noopAsync}
          />
        </SidebarProvider>
      </AccountContext.Provider>
    </MemoryRouter>
  )

const currentButtons = () =>
  screen.queryAllByRole('button').filter(button => button.classList.contains('bg-(--ui-control-active-background)'))

const expectOnlyCurrent = (label: string | null) => {
  const button = label ? screen.getByRole('button', { name: label }) : null

  expect(currentButtons()).toEqual(button ? [button] : [])
}

const expectOnlySelectedSession = (title: string | null) => {
  const rows = ['Tile one', 'Tile two']
    .map(label => screen.queryByText(label)?.closest('.group.row-hover'))
    .filter(row => row !== undefined)

  const selectedRows = rows.filter(row => row?.className.includes('bg-(--ui-row-active-background)'))
  const expected = title ? [screen.getByText(title).closest('.group.row-hover')] : []

  expect(selectedRows).toEqual(expected)
}

const focus = (groupId: null | string) => act(() => noteActiveTreeGroup(groupId))

describe('ChatSidebar navigation activity', () => {
  let disposeContributions: () => void

  beforeEach(() => {
    accountActions.state.set({
      ...accountActions.state.get(),
      authenticated: true,
      account: { id: 'account-one', display_name: 'Test User', phone_masked: '', email: 'user@example.test' }
    })
    $pinnedSessionIds.set([])
    $sidebarPinsOpen.set(true)
    $sidebarRecentsOpen.set(true)
    setSidebarGrouping('date')
    $sidebarWorkspaceNodeOpen.set({})
    $projects.set([])
    $openProjectsByProfile.set({})
    $projectTree.set([])
    $projectScope.set(ALL_PROJECTS)
    $projectDialog.set(null)
    disposeContributions = registry.registerMany([
      { area: ROUTES_AREA, id: 'kanban-page', data: { path: '/kanban' }, render: () => null },
      { area: ROUTES_AREA, id: 'reports-page', data: { path: '/reports' }, render: () => null },
      { area: SIDEBAR_NAV_AREA, id: 'kanban-nav', data: { codicon: 'project', label: 'Kanban', path: '/kanban' } },
      { area: SIDEBAR_NAV_AREA, id: 'reports-nav', data: { codicon: 'graph', label: 'Reports', path: '/reports' } }
    ])
    $selectedStoredSessionId.set('tile-one')
    $sessions.set(sessionRows)
    $removedSessionIds.set(new Set())
    $layoutTree.set(
      split('row', [
        group(['workspace'], { active: 'workspace', id: 'workspace-group' }),
        group(['session-tile:tile-one'], { active: 'session-tile:tile-one', id: 'tile-one-group' }),
        group(['session-tile:tile-two'], { active: 'session-tile:tile-two', id: 'tile-two-group' })
      ])
    )
    noteActiveTreeGroup('workspace-group')
  })

  afterEach(() => {
    cleanup()
    disposeContributions()
    $selectedStoredSessionId.set(null)
    $sessions.set([])
    $removedSessionIds.set(new Set())
    $layoutTree.set(null)
    noteActiveTreeGroup(null)
    $projects.set([])
    $projectTree.set([])
    $projectScope.set(ALL_PROJECTS)
    $projectDialog.set(null)
  })

  it('keeps navigation and session activity coherent with the focused pane', () => {
    renderSidebar('/kanban', 'extension')
    expectOnlyCurrent('Kanban')
    expectOnlySelectedSession(null)

    focus('tile-one-group')
    expectOnlyCurrent(null)
    expectOnlySelectedSession('Tile one')

    focus('tile-two-group')
    expectOnlyCurrent(null)
    expectOnlySelectedSession('Tile two')

    focus(null)
    expectOnlyCurrent('Kanban')
    expectOnlySelectedSession(null)

    focus('tile-two-group')
    act(() => {
      $removedSessionIds.set(new Set(['tile-two']))
      $sessions.set([sessionRows[0]])
    })
    expectOnlyCurrent(null)
    expectOnlySelectedSession(null)

    act(() => {
      $removedSessionIds.set(new Set())
      $sessions.set(sessionRows)
    })

    for (const [pathname, currentView, label] of [
      ['/profiles', 'profiles', 'Workspaces'],
      ['/skills', 'skills', 'Capabilities'],
      ['/messaging', 'messaging', 'Messaging'],
      ['/artifacts', 'artifacts', 'Artifacts'],
      ['/cron', 'cron', 'Scheduled jobs']
    ] as const) {
      cleanup()
      focus('workspace-group')
      renderSidebar(pathname, currentView)
      expectOnlyCurrent(label)
      expectOnlySelectedSession(null)

      focus('tile-one-group')
      expectOnlyCurrent(null)
      expectOnlySelectedSession('Tile one')
    }

    cleanup()
    focus('workspace-group')
    renderSidebar('/reports', 'extension')
    expectOnlyCurrent('Reports')

    cleanup()
    disposeContributions()
    disposeContributions = noop
    focus('workspace-group')
    renderSidebar('/kanban', 'extension')
    expect(screen.queryByRole('button', { name: 'Kanban' })).toBeNull()
    expectOnlyCurrent(null)
    expectOnlySelectedSession(null)
  })

  it('keeps project entry points visible before any session exists and hides empty pins', () => {
    $sessions.set([])
    renderSidebar('/', 'chat')

    expect(screen.queryByRole('button', { name: 'Pinned' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Projects' })).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Projects' })
        .closest('[data-sidebar-section]')
        ?.getAttribute('data-sidebar-section')
    ).toBe('projects')
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(screen.getByRole('button', { name: 'Projects' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: 'Recent' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open folder as project…' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    const invocation = $projectDialog.get()
    expect(invocation?.mode).toBe('create')
    expect(invocation?.isCurrent?.()).toBe(true)
    const profile = $activeGatewayProfile.get()

    try {
      act(() => $activeGatewayProfile.set('another-workspace'))
      expect(invocation?.isCurrent?.()).toBe(false)
    } finally {
      act(() => $activeGatewayProfile.set(profile))
    }
  })

  it('shows only opened projects and keeps other project history reachable in recent chats', () => {
    const projectSession = makeSessionInfo({ id: 'project-chat', cwd: '/work/app', title: 'Build the app' })
    $projects.set([
      {
        id: 'p_app',
        name: 'App',
        slug: 'app',
        description: null,
        color: null,
        icon: null,
        board_slug: null,
        created_at: 1,
        folders: [{ path: '/work/app', label: null, is_primary: true, added_at: 1 }],
        primary_path: '/work/app',
        archived: false
      }
    ])
    $projectTree.set([
      { id: 'p_app', label: 'App', path: '/work/app', repos: [], sessionCount: 1, previewSessions: [projectSession] },
      { id: 'p_empty', label: 'Empty project', path: '/work/empty', repos: [], sessionCount: 0, previewSessions: [] },
      {
        id: '/work/discovered',
        label: 'Discovered repo',
        path: '/work/discovered',
        isAuto: true,
        repos: [],
        sessionCount: 0
      }
    ])
    $sessions.set([...sessionRows, projectSession])
    renderSidebar('/', 'chat')

    const recents = screen.getByRole('button', { name: 'Recent' }).closest('[data-sidebar-section]') as HTMLElement
    expect(screen.queryByRole('button', { name: 'Open App' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Empty project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Discovered repo' })).toBeNull()
    expect(within(recents).getByText('Build the app')).toBeTruthy()

    act(() => {
      enterProject('p_app')
      enterProject('p_empty')
      exitProjectScope()
    })

    expect(within(recents).queryByText('Build the app')).toBeNull()
    expect(within(recents).getByText('Tile one')).toBeTruthy()
    expect(screen.getByText('Build the app')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Empty project' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open Discovered repo' })).toBeNull()

    act(() => $pinnedSessionIds.set(['project-chat']))
    const pins = screen.getByRole('button', { name: 'Pinned' }).closest('[data-sidebar-section]') as HTMLElement
    expect(within(pins).getByText('Build the app')).toBeTruthy()
    expect(screen.getAllByText('Build the app')).toHaveLength(1)

    act(() => $pinnedSessionIds.set([]))
    expect(screen.queryByRole('button', { name: 'Pinned' })).toBeNull()
    expect(screen.getAllByText('Build the app')).toHaveLength(1)

    act(() => closeProject('p_app'))
    expect(screen.queryByRole('button', { name: 'Open App' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Empty project' })).toBeTruthy()
    expect(within(recents).getByText('Build the app')).toBeTruthy()
    expect($projects.get().some(project => project.id === 'p_app')).toBe(true)
    expect($projectTree.get().some(project => project.id === 'p_app')).toBe(true)

    act(() => {
      enterProject('p_app')
      closeProject('p_app')
      closeProject('p_empty')
    })
    expect($projectScope.get()).toBe(ALL_PROJECTS)
    expect(screen.queryByRole('button', { name: 'Open Empty project' })).toBeNull()
    expect(within(recents).getByText('Build the app')).toBeTruthy()
  })

  it('starts ordinary chat without the previously selected project folder', () => {
    $projectScope.set('p_previous')
    const start = vi.fn()
    const { container } = renderSidebar('/', 'chat', start)

    fireEvent.click(container.querySelector('[data-tour="sidebar-nav-new-session"]')!)
    expect(start).toHaveBeenCalledWith(null, { openTab: false })
    expect($projectScope.get()).toBe(ALL_PROJECTS)
  })

  it('opens session import from the recent section menu', () => {
    const onNavigate = vi.fn()
    renderSidebar('/', 'chat', noop, onNavigate)

    expect(screen.queryByRole('button', { name: 'Import session' })).toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Session options' }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import session' }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ route: '/session-import' }))
  })

  it('shows the signed-in account and opens its details from the sidebar', () => {
    const onNavigate = vi.fn()
    const { container } = renderSidebar('/', 'chat', noop, onNavigate)
    const footer = within(container.querySelector('[data-slot="sidebar-identity-footer"]') as HTMLElement)

    expect(footer.getByText('Test User')).toBeTruthy()
    expect(footer.queryByText('default')).toBeNull()
    fireEvent.click(footer.getByRole('button', { name: 'My account · Test User' }))
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ route: '/settings?tab=account' }))

    act(() => {
      accountActions.state.set({
        ...accountActions.state.get(),
        account: { id: 'account-two', display_name: '', phone_masked: '', email: 'second@example.test' }
      })
    })
    expect(footer.queryByText('Test User')).toBeNull()
    expect(footer.getByText('second@example.test')).toBeTruthy()
    fireEvent.click(footer.getByRole('button', { name: 'Open settings' }))
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ route: '/settings' }))
  })
})
