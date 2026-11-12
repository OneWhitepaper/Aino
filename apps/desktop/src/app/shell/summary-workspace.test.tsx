import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContribWiringContext } from '@/app/contrib/context'
import { SummarySection } from '@/app/right-sidebar/summary/summary-section'
import { $workspaceIsPage } from '@/app/routes'
import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'
import { group, split } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import { Button } from '@/components/ui/button'
import { I18nProvider } from '@/i18n'
import { $summaryOpen } from '@/store/summary'

import { SummaryToggle } from './summary-toggle'
import { SummaryWorkspace } from './summary-workspace'

function Workspace({ session = 'First session' }: { session?: string }) {
  return (
    <I18nProvider configClient={null} initialLocale="en">
      <ContribWiringContext.Provider
        value={{
          chatRoutes: null,
          settings: null,
          sidebar: null,
          summary: (
            <SummarySection title={session}>
              <Button>Inspect output</Button>
            </SummarySection>
          ),
          terminal: null
        }}
      >
        <SummaryToggle />
        <SummaryWorkspace>
          <textarea aria-label="Draft" defaultValue="Unsent message" />
        </SummaryWorkspace>
      </ContribWiringContext.Provider>
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  $summaryOpen.set(false)
  $workspaceIsPage.set(false)
  $activeTreeGroup.set(null)
  $layoutTree.set(null)
  vi.restoreAllMocks()
})

describe('summary workspace', () => {
  it.each([632, 880, 1200])(
    'keeps resources on the right at chat width %s without replacing the draft',
    async width => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 600))
      const { container } = render(<Workspace />)
      const draft = screen.getByRole('textbox', { name: 'Draft' })
      await act(async () => $summaryOpen.set(true))
      const rail = container.querySelector<HTMLElement>('[data-slot="summary-rail"]')!
      expect(rail.style.position).toBe(width < 960 ? 'absolute' : '')

      if (width < 960) {
        expect(rail.style.top).toBe('0px')
        expect(rail.style.right).toBe('0px')
      }

      expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
      await act(async () => $summaryOpen.set(false))
      expect(rail.getAttribute('aria-hidden')).toBe('true')
      expect(rail.hasAttribute('inert')).toBe(true)
      await waitFor(() => expect(container.querySelector('[data-slot="summary-rail"]')).toBeNull())
      expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
    }
  )

  it('keeps one summary in the owning chat when file focus or split chat focus changes', async () => {
    $layoutTree.set(
      split('row', [
        group(['workspace'], { id: 'main-chat' }),
        group(['session-tile:second'], { id: 'second-chat' }),
        group(['files'], { id: 'file-zone' })
      ])
    )
    $activeTreeGroup.set('main-chat')
    $summaryOpen.set(true)

    const view = render(
      <I18nProvider configClient={null} initialLocale="en">
        <ContribWiringContext.Provider
          value={{
            chatRoutes: null,
            settings: null,
            sidebar: null,
            terminal: null,
            summary: <button>Inspect owned output</button>
          }}
        >
          <SummaryWorkspace target="main">
            <textarea aria-label="Main draft" defaultValue="Keep main text" />
          </SummaryWorkspace>
          <SummaryWorkspace target="tile:second">
            <textarea aria-label="Second draft" defaultValue="Keep second text" />
          </SummaryWorkspace>
        </ContribWiringContext.Provider>
      </I18nProvider>
    )

    const mainDraft = screen.getByRole('textbox', { name: 'Main draft' })
    const secondDraft = screen.getByRole('textbox', { name: 'Second draft' })

    const owns = (draft: HTMLElement) =>
      draft
        .closest('[data-slot="summary-workspace"]')!
        .contains(screen.getByRole('button', { name: 'Inspect owned output' }))

    expect(screen.getAllByRole('button', { name: 'Inspect owned output' })).toHaveLength(1)
    expect(owns(mainDraft)).toBe(true)
    act(() => $activeTreeGroup.set('file-zone'))
    expect(owns(mainDraft)).toBe(true)
    act(() => $activeTreeGroup.set('second-chat'))
    await waitFor(() => expect(owns(secondDraft)).toBe(true))
    expect(screen.getAllByRole('button', { name: 'Inspect owned output' })).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Main draft' })).toBe(mainDraft)
    expect(screen.getByRole('textbox', { name: 'Second draft' })).toBe(secondDraft)
    view.unmount()
  })

  it('does not expose summary from an inactive kept chat pane', () => {
    $summaryOpen.set(true)
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <ContribWiringContext.Provider
          value={{
            chatRoutes: null,
            settings: null,
            sidebar: null,
            terminal: null,
            summary: <button>Hidden chat output</button>
          }}
        >
          <PaneVisibleContext.Provider value={false}>
            <SummaryWorkspace target="main">
              <textarea aria-label="Kept draft" />
            </SummaryWorkspace>
          </PaneVisibleContext.Provider>
        </ContribWiringContext.Provider>
      </I18nProvider>
    )
    expect(screen.queryByRole('button', { name: 'Hidden chat output' })).toBeNull()
    expect($summaryOpen.get()).toBe(true)
  })

  it('keeps the draft mounted and editable beside a non-modal summary until toggled closed', async () => {
    render(<Workspace />)
    const toggle = screen.getByRole('button', { name: 'Session resources' })
    const ownerDocument = toggle.ownerDocument
    const draft = screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement
    const panelId = toggle.getAttribute('aria-controls')!
    expect(ownerDocument.getElementById(panelId)).toBeNull()

    await act(async () => fireEvent.click(toggle))
    const panel = ownerDocument.getElementById(panelId)
    expect(panel).not.toBeNull()
    expect(panel!.contains(screen.getByRole('button', { name: 'Inspect output' }))).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)

    draft.focus()
    fireEvent.change(draft, { target: { value: 'Keep editing while summary is open' } })
    fireEvent.pointerDown(draft)
    fireEvent.keyDown(draft, { key: 'Escape' })
    expect($summaryOpen.get()).toBe(true)
    expect(ownerDocument.activeElement).toBe(draft)

    await act(async () => fireEvent.click(toggle))
    await waitFor(() => expect(ownerDocument.getElementById(panelId)).toBeNull())
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
    expect(draft.value).toBe('Keep editing while summary is open')

    await act(async () => {
      fireEvent.click(toggle)
      fireEvent.click(toggle)
      fireEvent.click(toggle)
    })
    expect(screen.getAllByRole('button', { name: 'Inspect output' })).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
    expect(draft.value).toBe('Keep editing while summary is open')
  })

  it('refreshes the wired session contents without closing or replacing the summary surface', async () => {
    const view = render(<Workspace />)
    const toggle = screen.getByRole('button', { name: 'Session resources' })
    const ownerDocument = toggle.ownerDocument
    await act(async () => fireEvent.click(toggle))
    const panel = ownerDocument.getElementById(toggle.getAttribute('aria-controls')!)
    expect(panel).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'First session' })).toBeTruthy()

    view.rerender(<Workspace session="Second session" />)
    expect($summaryOpen.get()).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(ownerDocument.getElementById(toggle.getAttribute('aria-controls')!)).toBe(panel)
    expect(screen.queryByRole('heading', { name: 'First session' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Second session' })).toBeTruthy()
  })

  it('reverses a closing summary without duplicating it or replacing its draft', async () => {
    const view = render(<Workspace />)
    const draft = screen.getByRole('textbox', { name: 'Draft' })
    act(() => $summaryOpen.set(true))
    const rail = view.container.querySelector('[data-slot="summary-rail"]')!
    act(() => $summaryOpen.set(false))
    expect(rail.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Inspect output' })).toBeNull()
    act(() => $summaryOpen.set(true))
    expect(view.container.querySelectorAll('[data-slot="summary-rail"]')).toHaveLength(1)
    expect(view.container.querySelector('[data-slot="summary-rail"]')).toBe(rail)
    expect(rail.hasAttribute('inert')).toBe(false)
    expect(screen.getByRole('button', { name: 'Inspect output' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
  })

  it('removes a closing summary immediately when its owning chat is hidden', () => {
    const content = (visible: boolean) => (
      <PaneVisibleContext value={visible}>
        <Workspace />
      </PaneVisibleContext>
    )

    const view = render(content(true))
    act(() => $summaryOpen.set(true))
    act(() => $summaryOpen.set(false))
    expect(view.container.querySelector('[data-slot="summary-rail"]')).not.toBeNull()
    view.rerender(content(false))
    expect(view.container.querySelector('[data-slot="summary-rail"]')).toBeNull()
  })

  it('closes immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: media === '(prefers-reduced-motion: reduce)',
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))

    try {
      const view = render(<Workspace />)
      act(() => $summaryOpen.set(true))
      expect(view.container.querySelector('[data-slot="summary-rail"]')).not.toBeNull()
      act(() => $summaryOpen.set(false))
      expect(view.container.querySelector('[data-slot="summary-rail"]')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

it('covers the summary on management pages without losing the open preference or mounted content', async () => {
  render(<Workspace />)
  await act(async () => $summaryOpen.set(true))
  const action = screen.getByRole('button', { name: 'Inspect output' })
  const card = action.closest('[data-slot="summary-card"]')
  act(() => $workspaceIsPage.set(true))
  expect(screen.queryByRole('button', { name: 'Inspect output' })).toBeNull()
  expect(action.isConnected).toBe(true)
  expect($summaryOpen.get()).toBe(true)
  act(() => $workspaceIsPage.set(false))
  expect(screen.getByRole('button', { name: 'Inspect output' })).toBe(action)
  expect(action.closest('[data-slot="summary-card"]')).toBe(card)
})
