import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ModelMenuCloseContext } from '@/app/shell/model-menu-panel'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { I18nProvider } from '@/i18n'
import { $approvalModes } from '@/store/approval-mode'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { ApprovalModeMenu } from './approval-mode-menu'
import { ContextMenu } from './context-menu'
import { ReasoningPill } from './reasoning-pill'
import type { ChatBarState } from './types'

const state: ChatBarState = {
  model: { canSwitch: true, model: 'glm-5.3-flash', provider: 'aino' },
  tools: { enabled: true, label: 'Add context' },
  voice: { active: false, enabled: true }
}

beforeAll(() => {
  stubResizeObserver()
  stubMenuDomApis()
})

afterEach(() => {
  cleanup()
  $approvalModes.set({})
})

function ReasoningChoice({ onSelect }: { onSelect: () => void }) {
  const closeMenu = useContext(ModelMenuCloseContext)

  return (
    <DropdownMenuItem
      onSelect={event => {
        event.preventDefault()
        onSelect()
        closeMenu()
      }}
    >
      High effort
    </DropdownMenuItem>
  )
}

describe('Bot composer settings in the attachment menu', () => {
  it('keeps approval changes on the existing profile configuration path', async () => {
    const requestGateway = vi.fn(async (_method, params) => ({ value: params?.value ?? 'smart' }))
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <ContextMenu
          onInsertText={vi.fn()}
          onOpenUrlDialog={vi.fn()}
          settings={<ApprovalModeMenu presentation="submenu" profile="research" requestGateway={requestGateway} />}
          state={state}
        />
      </I18nProvider>
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add context' }), { button: 0, ctrlKey: false })
    const approval = screen.getByRole('menuitem', { name: 'Approval mode: Approve for me' })
    fireEvent.keyDown(approval, { key: 'ArrowRight' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Ask for approval/ }))

    await waitFor(() => {
      expect(requestGateway).toHaveBeenCalledWith('config.set', {
        key: 'approvals.mode',
        value: 'manual',
        profile: 'research'
      })
      expect($approvalModes.get().research).toBe('manual')
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('uses the live reasoning menu and closes the entire attachment menu after a selection', async () => {
    const onSelect = vi.fn()
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <ContextMenu
          onInsertText={vi.fn()}
          onOpenUrlDialog={vi.fn()}
          settings={
            <ReasoningPill
              disabled={false}
              model={{ ...state.model, reasoningMenuContent: <ReasoningChoice onSelect={onSelect} /> }}
              presentation="submenu"
            />
          }
          state={state}
        />
      </I18nProvider>
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add context' }), { button: 0, ctrlKey: false })
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Effort:/ }), { key: 'ArrowRight' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'High effort' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add context' }).getAttribute('aria-expanded')).toBe('false')
  })
})
