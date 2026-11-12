import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { translateBotsIn } from './i18n-test-helper'
import { LegacyGroupMenu } from './legacy-group-menu'

vi.mock('@hermes/plugin-sdk', async importOriginal => ({
  ...(await importOriginal<typeof HermesSdk>()),
  usePluginI18n: () => translateBotsIn('zh')
}))

beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

it('opens every retained management action from one named entrance without running one on open', () => {
  const onSettings = vi.fn()
  const onMembers = vi.fn()
  const onDisband = vi.fn()
  render(<LegacyGroupMenu onDisband={onDisband} onMembers={onMembers} onSettings={onSettings} />)

  const open = () =>
    fireEvent.pointerDown(screen.getByRole('button', { name: '群聊信息' }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse'
    })
  open()
  expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  expect(onSettings).not.toHaveBeenCalled()
  expect(onMembers).not.toHaveBeenCalled()
  expect(onDisband).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('menuitem', { name: '管理成员' }))
  expect(onMembers).toHaveBeenCalledOnce()

  open()
  fireEvent.click(screen.getByRole('menuitem', { name: '群聊设置' }))
  expect(onSettings).toHaveBeenCalledOnce()

  open()
  fireEvent.click(screen.getByRole('menuitem', { name: '解散' }))
  expect(onDisband).toHaveBeenCalledOnce()
})
