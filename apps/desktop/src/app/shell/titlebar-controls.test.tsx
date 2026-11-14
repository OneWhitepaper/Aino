import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { $terminalTakeover, setTerminalTakeover } from '@/app/right-sidebar/store'
import { $activeTerminalId, $terminals } from '@/app/right-sidebar/terminal/terminals'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { $narrowOverlayPaneIds } from '@/components/pane-shell/narrow-overlay-state'
import { findGroup, group, split } from '@/components/pane-shell/tree/model'
import { ToolPanelControls } from '@/components/pane-shell/tree/renderer/tool-panel-controls'
import { $narrowViewport } from '@/components/pane-shell/tree/store'
import {
  $dismissedPanes,
  $hiddenTreePanes,
  $layoutTree,
  bindToolPaneCollapse,
  isPaneVisible,
  togglePaneVisible
} from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'
import { I18nProvider } from '@/i18n'
import { $fileBrowserOpen, $leftSideOpen, CHAT_SIDEBAR_PANE_ID, FILE_BROWSER_PANE_ID } from '@/store/layout'
import { REVIEW_PANE_ID } from '@/store/review'
import { $summaryOpen } from '@/store/summary'
import { stubResizeObserver } from '@/test/jsdom'

import { CAPABILITIES_ROUTE, ROUTES_AREA } from '../routes'

import { TITLEBAR_CHROME_CHANGED_EVENT } from './titlebar'
import { TitlebarControls, type TitlebarTool } from './titlebar-controls'

beforeAll(() => {
  stubResizeObserver()
  bindToolPaneCollapse(
    'terminal',
    $terminalTakeover,
    () => setTerminalTakeover(false),
    () => setTerminalTakeover(true)
  )
})

afterEach(() => {
  cleanup()
  setTerminalTakeover(false)
  $terminals.set([])
  $activeTerminalId.set(null)
  $summaryOpen.set(false)
})

describe('titlebar terminal toggle', () => {
  it('tracks the same visible pane as the keyboard command without replacing terminal tabs', () => {
    $dismissedPanes.set(new Set())
    $hiddenTreePanes.set(new Set())
    $layoutTree.set(split('column', [group(['workspace']), group(['terminal'], { minimized: true })]))

    const terminals = [{ auto: true, cwd: '/project', id: 'running-shell', kind: 'user' as const, title: 'zsh' }]

    $terminals.set(terminals)
    $activeTerminalId.set('running-shell')

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <MemoryRouter>
          <TitlebarControls />
        </MemoryRouter>
      </I18nProvider>
    )

    expect(screen.queryByRole('button', { name: '打开设置' })).toBeNull()
    expect(screen.queryByRole('button', { name: '布局编辑器' })).toBeNull()
    expect(screen.queryByRole('button', { name: '交换侧边栏位置' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '显示终端' }))
    expect(isPaneVisible('terminal')).toBe(true)
    expect(screen.getByRole('button', { name: '隐藏终端' }).getAttribute('aria-pressed')).toBe('true')

    act(() => togglePaneVisible('terminal'))
    expect(screen.getByRole('button', { name: '显示终端' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '显示终端' }))
    fireEvent.click(screen.getByRole('button', { name: '隐藏终端' }))
    expect(isPaneVisible('terminal')).toBe(false)
    expect($terminals.get()).toBe(terminals)
    expect($activeTerminalId.get()).toBe('running-shell')
  })

  it('offers Show after panel Hide and restores the same active terminal without replacing its shells', () => {
    const dispose = registry.registerMany([
      { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
      { id: 'files', area: 'panes', data: { placement: 'right', toolPanel: true }, render: () => null },
      { id: 'terminal', area: 'panes', data: { placement: 'right', toolPanel: true }, render: () => null }
    ])

    $dismissedPanes.set(new Set())
    $hiddenTreePanes.set(new Set())
    $layoutTree.set(
      split('row', [
        group(['workspace']),
        group(['files', 'terminal'], { id: 'tools', toolPanel: true, active: 'terminal' })
      ])
    )
    $fileBrowserOpen.set(true)
    setTerminalTakeover(true)

    const terminals = [{ auto: true, cwd: '/project', id: 'retained-shell', kind: 'user' as const, title: 'zsh' }]

    $terminals.set(terminals)
    $activeTerminalId.set('retained-shell')

    try {
      render(
        <I18nProvider configClient={null} initialLocale="en">
          <MemoryRouter>
            <TitlebarControls />
            <ToolPanelControls
              activate={() => undefined}
              groupId="tools"
              panes={['files', 'terminal']}
              title={id => id}
            />
          </MemoryRouter>
        </I18nProvider>
      )
      expect(screen.getByRole('button', { name: 'Hide right sidebar' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }))
      expect(findGroup($layoutTree.get()!, 'tools')?.minimized).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Show right sidebar' }))
      expect(findGroup($layoutTree.get()!, 'tools')?.minimized).toBeFalsy()
      expect(findGroup($layoutTree.get()!, 'tools')?.active).toBe('terminal')
      expect(screen.getByRole('button', { name: 'Hide right sidebar' })).toBeTruthy()
      expect($fileBrowserOpen.get()).toBe(true)
      expect($terminals.get()).toBe(terminals)
      expect($activeTerminalId.get()).toBe('retained-shell')
    } finally {
      dispose()
    }
  })
})

describe('titlebar summary toggle', () => {
  it('keeps summary open until toggled without replacing the saved layout or terminal tabs', async () => {
    const tree = split('column', [group(['workspace']), group(['terminal'])])
    $layoutTree.set(tree)
    const terminals = [{ auto: true, cwd: '/project', id: 'live-shell', kind: 'user' as const, title: 'zsh' }]
    $terminals.set(terminals)
    $activeTerminalId.set('live-shell')

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <MemoryRouter>
          <TitlebarControls />
          <button type="button">Outside</button>
        </MemoryRouter>
      </I18nProvider>
    )

    const button = screen.getByRole('button', { name: '会话资源' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await act(async () => fireEvent.click(button))
    expect($summaryOpen.get()).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-expanded')).toBe('true')

    await act(async () => fireEvent.keyDown(button.ownerDocument, { key: 'Escape' }))
    expect($summaryOpen.get()).toBe(true)
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
    const outside = screen.getByRole('button', { name: 'Outside' })
    await act(async () => {
      fireEvent.pointerDown(outside, { button: 0, pointerType: 'mouse' })
      fireEvent.click(outside)
    })
    expect($summaryOpen.get()).toBe(true)

    await act(async () => fireEvent.click(button))
    expect($summaryOpen.get()).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect($layoutTree.get()).toBe(tree)
    expect($terminals.get()).toBe(terminals)
    expect($activeTerminalId.get()).toBe('live-shell')
  })

  it('retains the window-local summary choice when the toolbar remounts', async () => {
    const toolbar = (
      <I18nProvider configClient={null} initialLocale="zh">
        <MemoryRouter>
          <TitlebarControls />
        </MemoryRouter>
      </I18nProvider>
    )

    const view = render(toolbar)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '会话资源' })))
    view.unmount()
    render(toolbar)

    expect($summaryOpen.get()).toBe(true)
    expect(screen.getByRole('button', { name: '会话资源' }).getAttribute('aria-expanded')).toBe('true')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '会话资源' })))
    expect($summaryOpen.get()).toBe(false)
  })
})

const PLUGIN_TOOL: TitlebarTool = { icon: <span />, id: 'plugin-tool', label: 'plugin tool' }

let navigateTo: (to: string) => void = () => {}

function NavigateProbe() {
  navigateTo = useNavigate()

  return null
}

function renderControls(pathname: string, props?: { leftTools?: TitlebarTool[]; tools?: TitlebarTool[] }) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <I18nProvider configClient={null} initialLocale="en">
        <NavigateProbe />
        <TitlebarControls leftTools={props?.leftTools} tools={props?.tools} />
      </I18nProvider>
    </MemoryRouter>
  )
}

const windowControls = () => screen.queryByLabelText('Window controls')
const appControls = () => screen.queryByLabelText('App controls')
const pluginChrome = () => screen.queryByText('plugin-chrome')
const pluginTool = () => screen.queryByLabelText('plugin tool')

describe('TitlebarControls fixed clusters', () => {
  let dispose: () => void

  beforeEach(() => {
    dispose = registry.registerMany([
      {
        area: ROUTES_AREA,
        data: { path: '/kanban' },
        id: 'test-kanban-route',
        render: () => null
      },
      {
        area: ROUTES_AREA,
        data: { path: '/plain' },
        id: 'test-plain-route',
        render: () => null
      }
    ])
  })

  afterEach(() => {
    dispose()
    cleanup()
  })

  it('keeps the app clusters on a contributed page that mounts no titlebar chrome', () => {
    renderControls('/plain')

    expect(windowControls()).not.toBeNull()
    expect(appControls()).not.toBeNull()
  })

  it('hides the app clusters on an overlay', () => {
    renderControls('/settings')

    expect(windowControls()).toBeNull()
    expect(appControls()).toBeNull()
  })

  it('a titleBar.tools item alone does not claim the band', () => {
    renderControls('/plain', { leftTools: [PLUGIN_TOOL] })

    expect(windowControls()).not.toBeNull()
    expect(pluginTool()).not.toBeNull()
  })

  it('does not duplicate the shell-owned titleBar.center component during navigation', () => {
    // ContribController owns the persistent center slot; fixed action clusters
    // must not mount a second copy of a plugin's component and side effects.
    const life = { cleanups: 0, mounts: 0 }

    function PluginCenter() {
      useEffect(() => {
        life.mounts += 1

        return () => {
          life.cleanups += 1
        }
      }, [])

      return <span>plugin-center</span>
    }

    const disposeTitle = registry.register({
      area: 'titleBar.center',
      id: 'test-plugin-center',
      render: () => <PluginCenter />
    })

    try {
      renderControls('/')
      expect(life).toEqual({ cleanups: 0, mounts: 0 })

      act(() => navigateTo(CAPABILITIES_ROUTE))
      expect(screen.queryByText('plugin-center')).toBeNull()
      expect(windowControls()).not.toBeNull()
      expect(appControls()).not.toBeNull()

      act(() => navigateTo('/'))
      expect(life).toEqual({ cleanups: 0, mounts: 0 })
    } finally {
      act(disposeTitle)
    }
  })

  describe('when the page projects titlebar chrome', () => {
    let disposeChrome: () => void

    beforeEach(() => {
      disposeChrome = registry.register({
        area: 'titleBar.left',
        id: 'test-plugin-chrome',
        render: () => <span>plugin-chrome</span>
      })
    })

    afterEach(() => {
      // The mounted controls subscribe to titleBar.* areas — dispose inside
      // act so the unmount-time registry update doesn't warn.
      act(() => disposeChrome())
    })

    it('keeps plugin titlebar contributions on a contributed full-page route', () => {
      renderControls('/kanban')

      expect(pluginChrome()).not.toBeNull()
      expect(windowControls()).toBeNull()
      expect(appControls()).toBeNull()
    })

    it('keeps contributed titlebar tools on a chrome-owning page', () => {
      renderControls('/kanban', { leftTools: [PLUGIN_TOOL] })

      expect(pluginTool()).not.toBeNull()
    })

    it('hides plugin titlebar contributions on an overlay', () => {
      renderControls('/settings')

      expect(pluginChrome()).toBeNull()
    })

    it('keeps measurable titlebar clusters on a chrome-owning contributed page', () => {
      // usePanelTitlebar positions the sessions tab strip from these hooks;
      // without them the tabs keep their stale chat-view offset and slide
      // under the page's switcher (kanban's board switcher).
      const { container } = renderControls('/kanban')

      expect(container.querySelector('[data-titlebar-cluster="left"]')).not.toBeNull()
      expect(container.querySelector('[data-titlebar-cluster="right"]')).not.toBeNull()
    })

    it('announces its chrome so the sessions tab reservation re-measures', () => {
      const listener = vi.fn()
      window.addEventListener(TITLEBAR_CHROME_CHANGED_EVENT, listener)

      try {
        renderControls('/kanban')

        expect(listener).toHaveBeenCalled()
      } finally {
        window.removeEventListener(TITLEBAR_CHROME_CHANGED_EVENT, listener)
      }
    })
  })
})

describe('titlebar app-action cluster', () => {
  beforeEach(() => {
    vi.stubGlobal('hermesDesktop', { ...window.hermesDesktop, hud: { open: vi.fn() } })
  })

  afterEach(() => {
    $narrowViewport.set(false)
    $narrowOverlayPaneIds.set(new Set())
    cleanup()
    vi.unstubAllGlobals()
    delete window.document.documentElement.dataset.hermesDesktopHost
  })

  // A narrow native window keeps main's titlebar: the side buttons read the
  // docked sides and flip the overlay through the shared ⌘B/⌘J toggle, whatever
  // the overlay shows, and carry no aria-expanded.
  it('names and toggles the sides from docked state in a narrow native window, as on main', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    )
    $narrowViewport.set(true)
    $narrowOverlayPaneIds.set(new Set([CHAT_SIDEBAR_PANE_ID, REVIEW_PANE_ID]))
    const intents: unknown[] = []
    const listener = (event: Event) => intents.push((event as CustomEvent).detail)
    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)

    try {
      renderControls('/')

      const sidebar = screen.getByRole('button', {
        name: $leftSideOpen.get() ? 'Hide sidebar' : 'Show sidebar'
      })

      const rightSidebar = screen.getByRole('button', {
        name: $fileBrowserOpen.get() ? 'Hide right sidebar' : 'Show right sidebar'
      })

      expect(sidebar.hasAttribute('aria-expanded')).toBe(false)
      expect(rightSidebar.hasAttribute('aria-expanded')).toBe(false)
      fireEvent.click(sidebar)
      fireEvent.click(rightSidebar)
      expect(intents).toEqual([
        { id: CHAT_SIDEBAR_PANE_ID, mode: 'toggle' },
        { id: FILE_BROWSER_PANE_ID, mode: 'toggle' }
      ])
    } finally {
      window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)
    }
  })

  it('names the narrow sidebar action from its visible overlay, not docked state', () => {
    window.document.documentElement.dataset.hermesDesktopHost = 'browser'
    $narrowViewport.set(true)
    renderControls('/')
    const left = screen.getByLabelText('Window controls')
    expect(within(left).getByRole('button', { name: 'Show sidebar' }).getAttribute('aria-expanded')).toBe('false')
    act(() => $narrowOverlayPaneIds.set(new Set([CHAT_SIDEBAR_PANE_ID])))
    expect(within(left).getByRole('button', { name: 'Hide sidebar' }).getAttribute('aria-expanded')).toBe('true')
    act(() => $narrowOverlayPaneIds.set(new Set()))
    expect(within(left).getByRole('button', { name: 'Show sidebar' })).toBeTruthy()
  })

  it('explicitly closes a visible overlay rather than pinning a hover reveal', () => {
    window.document.documentElement.dataset.hermesDesktopHost = 'browser'
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    )
    $narrowViewport.set(true)
    $narrowOverlayPaneIds.set(new Set([CHAT_SIDEBAR_PANE_ID]))
    const intents: unknown[] = []
    const listener = (event: Event) => intents.push((event as CustomEvent).detail)
    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)

    try {
      renderControls('/')
      fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
      expect(intents).toEqual([{ id: CHAT_SIDEBAR_PANE_ID, mode: 'close' }])
    } finally {
      window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)
    }
  })

  it('hides a review-only right sidebar instead of opening files', () => {
    window.document.documentElement.dataset.hermesDesktopHost = 'browser'
    $narrowViewport.set(true)
    $narrowOverlayPaneIds.set(new Set([REVIEW_PANE_ID]))
    const intents: unknown[] = []
    const listener = (event: Event) => intents.push((event as CustomEvent).detail)
    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)

    try {
      renderControls('/')
      fireEvent.click(screen.getByRole('button', { name: 'Hide right sidebar' }))
      expect(intents).toEqual([{ id: 'review', mode: 'close' }])
    } finally {
      window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, listener)
    }
  })

  it('keeps only navigation on the left and groups remaining app actions on the right', () => {
    renderControls('/')

    const left = screen.getByLabelText('Window controls')
    const right = screen.getByLabelText('App controls')

    expect(screen.queryByLabelText('Mute haptics')).toBeNull()
    expect(screen.queryByLabelText('Unmute haptics')).toBeNull()
    expect(screen.queryByLabelText('Layout editor')).toBeNull()
    expect(screen.queryByLabelText('Swap sidebar sides')).toBeNull()
    expect(within(right).getByLabelText('HUD mode')).toBeTruthy()

    expect(within(left).queryByLabelText('Mute haptics')).toBeNull()
    expect(within(left).queryByLabelText('Layout editor')).toBeNull()
    expect(within(left).queryByLabelText('HUD mode')).toBeNull()
    expect(within(left).getByLabelText(/Hide sidebar|Show sidebar/)).toBeTruthy()
  })

  it('ignores the retired app-actions placement preference', () => {
    window.localStorage.setItem('hermes.desktop.titlebarAppActions', 'left')
    renderControls('/')

    const left = screen.getByLabelText('Window controls')
    const right = screen.getByLabelText('App controls')

    expect(within(left).getAllByRole('button')).toHaveLength(3)
    expect(within(right).queryByLabelText('Mute haptics')).toBeNull()
    expect(within(right).getByLabelText('HUD mode')).toBeTruthy()
    window.localStorage.removeItem('hermes.desktop.titlebarAppActions')
  })

  it('keeps HUD unavailable in the browser without restoring the removed editor', () => {
    vi.stubGlobal('hermesDesktop', { ...window.hermesDesktop, hud: undefined })
    renderControls('/')

    expect(screen.queryByLabelText('HUD mode')).toBeNull()
    expect(screen.queryByLabelText('Layout editor')).toBeNull()
    expect(within(screen.getByLabelText('Window controls')).getAllByRole('button')).toHaveLength(3)
  })
})
