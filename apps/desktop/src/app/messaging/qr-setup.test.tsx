// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { MessagingPlatformInfo } from '@/types/hermes'

import { MessagingQrSetup } from './qr-setup'

const api = vi.hoisted(() => ({ start: vi.fn(), poll: vi.fn(), apply: vi.fn(), cancel: vi.fn() }))
vi.mock('@/api/messaging-onboarding', () => ({
  startMessagingOnboarding: api.start,
  getMessagingOnboarding: api.poll,
  applyMessagingOnboarding: api.apply,
  cancelMessagingOnboarding: api.cancel
}))
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,qr') }))

const platform: MessagingPlatformInfo = {
  id: 'weixin',
  name: 'WeChat',
  description: '',
  docs_url: '',
  configured: false,
  enabled: false,
  gateway_running: true,
  env_vars: [],
  state: 'not_configured',
  onboarding: true
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

it('shows the actual connection failure after authorization was saved', async () => {
  const view = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MessagingQrSetup
        onApplied={vi.fn()}
        platform={{ ...platform, configured: true, state: 'connecting' }}
        scopeProfile="robot"
      />
    </I18nProvider>
  )

  expect(screen.getByText('连接中')).toBeTruthy()
  view.rerender(
    <I18nProvider configClient={null} initialLocale="zh">
      <MessagingQrSetup
        onApplied={vi.fn()}
        platform={{ ...platform, configured: true, state: 'startup_failed' }}
        scopeProfile="robot"
      />
    </I18nProvider>
  )
  expect(screen.getByText('启动失败')).toBeTruthy()
  expect(screen.queryByText('已连接')).toBeNull()
})

it('shows a QR and saves the confirmed account once without exposing credentials', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  api.start.mockResolvedValue({
    pairing_id: 'owned-qr',
    qr_payload: 'https://example.com/qr',
    expires_at: new Date(Date.now() + 120_000).toISOString()
  })
  api.poll.mockResolvedValue({ status: 'ready' })
  api.apply.mockResolvedValue({ ok: true, platform: 'weixin', needs_activation: true })
  let finishApply!: () => void

  const onApplied = vi.fn(
    () =>
      new Promise<void>(resolve => {
        finishApply = resolve
      })
  )

  const onBusyChange = vi.fn()
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MessagingQrSetup onApplied={onApplied} onBusyChange={onBusyChange} platform={platform} scopeProfile="robot" />
    </I18nProvider>
  )
  expect(await screen.findByRole('img', { name: '微信连接二维码' })).toBeTruthy()
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  expect(screen.queryByRole('textbox')).toBeNull()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  await waitFor(() =>
    expect(api.apply).toHaveBeenCalledExactlyOnceWith('weixin', 'owned-qr', { connectionId: null, profile: 'robot' })
  )
  expect(onApplied).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  expect(screen.queryByRole('button', { name: '刷新二维码' })).toBeNull()
  expect(onBusyChange).toHaveBeenLastCalledWith(true)
  await act(async () => {
    finishApply()
  })
  expect(screen.getByText('授权已保存，正在连接…')).toBeTruthy()
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
})

it('cancels an abandoned QR and never applies a late confirmation to another profile', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let finish!: (value: { status: string }) => void
  api.start.mockResolvedValue({
    pairing_id: 'old-qr',
    qr_payload: 'qr',
    expires_at: new Date(Date.now() + 120_000).toISOString()
  })
  api.poll.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  api.cancel.mockResolvedValue({ ok: true })
  const onBusyChange = vi.fn()

  const view = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MessagingQrSetup onApplied={vi.fn()} onBusyChange={onBusyChange} platform={platform} scopeProfile="old" />
    </I18nProvider>
  )

  await screen.findByRole('img')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  view.unmount()
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  await act(async () => {
    finish({ status: 'ready' })
  })
  expect(api.cancel).toHaveBeenCalledWith('weixin', 'old-qr', { connectionId: null, profile: 'old' })
  expect(api.apply).not.toHaveBeenCalled()
})

it('cancels an in-flight QR confirmation and allows an explicit new attempt', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let finish!: (value: { status: string }) => void
  api.start.mockResolvedValue({
    pairing_id: 'cancelled-qr',
    qr_payload: 'qr',
    expires_at: new Date(Date.now() + 120_000).toISOString()
  })
  api.poll.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  api.cancel.mockResolvedValue({ ok: true })
  const onApplied = vi.fn(async () => undefined)
  const onBusyChange = vi.fn()
  const controls: { cancel: (() => Promise<void> | void) | null } = { cancel: null }

  const onCancelChange = vi.fn((cancel: (() => Promise<void> | void) | null) => {
    controls.cancel = cancel
  })

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MessagingQrSetup
        onApplied={onApplied}
        onBusyChange={onBusyChange}
        onCancelChange={onCancelChange}
        platform={platform}
        scopeProfile="robot"
      />
    </I18nProvider>
  )
  await screen.findByRole('img')
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  await act(async () => {
    await controls.cancel?.()
  })
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText('需要设置')).toBeTruthy()
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  await act(async () => {
    finish({ status: 'ready' })
  })
  expect(api.apply).not.toHaveBeenCalled()
  expect(onApplied).not.toHaveBeenCalled()
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith('weixin', 'cancelled-qr', { connectionId: null, profile: 'robot' })
  fireEvent.click(screen.getByRole('button', { name: '刷新二维码' }))
  await screen.findByRole('img')
  expect(api.start).toHaveBeenCalledTimes(2)
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
})

it('waits for a submitted authorization before the parent writes disabled', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  api.start.mockResolvedValue({
    pairing_id: 'saving-qr',
    qr_payload: 'qr',
    expires_at: new Date(Date.now() + 120_000).toISOString()
  })
  api.poll.mockResolvedValue({ status: 'ready' })
  let finish!: () => void
  const writes: string[] = []
  api.apply.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = () => {
          writes.push('saved')
          resolve({ ok: true, platform: 'weixin' })
        }
      })
  )
  const controls: { cancel: (() => Promise<void> | void) | null } = { cancel: null }

  const onCancelChange = vi.fn((cancel: (() => Promise<void> | void) | null) => {
    controls.cancel = cancel
  })

  const onApplied = vi.fn(async () => undefined)

  const view = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MessagingQrSetup
        onApplied={onApplied}
        onCancelChange={onCancelChange}
        platform={platform}
        scopeProfile="robot"
      />
    </I18nProvider>
  )

  await screen.findByRole('img')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  expect(api.apply).toHaveBeenCalledOnce()

  const disable = async () => {
    await controls.cancel?.()
    writes.push('disabled')
  }

  let disabled!: Promise<void>
  act(() => {
    disabled = disable()
  })
  expect(writes).toEqual([])
  await act(async () => {
    finish()
    await disabled
  })
  expect(writes).toEqual(['saved', 'disabled'])
  expect(onApplied).not.toHaveBeenCalled()
  view.unmount()
  expect(onCancelChange).toHaveBeenLastCalledWith(null)
})

it('preserves an existing account until the user explicitly chooses to replace it', async () => {
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MessagingQrSetup
        onApplied={vi.fn()}
        onConnect={vi.fn()}
        platform={{ ...platform, configured: true, state: 'connected' }}
        scopeProfile="robot"
      />
    </I18nProvider>
  )
  expect(screen.getByText('已连接')).toBeTruthy()
  expect(api.start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '更换账号' }))
  await waitFor(() => expect(api.start).toHaveBeenCalledWith('weixin', { connectionId: null, profile: 'robot' }))
})
