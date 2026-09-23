import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ContribWiringContext } from '@/app/contrib/context'
import { SummarySection } from '@/app/right-sidebar/summary/summary-section'
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
})

describe('summary workspace', () => {
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
})
