import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { confirmHandler, notifyError } = vi.hoisted(() => ({
  confirmHandler: { current: null as null | (() => Promise<void> | void) },
  notifyError: vi.fn()
}))

vi.mock('@/store/notifications', () => ({ notifyError }))

vi.mock('@/components/assistant-ui/thread/list', () => ({
  ThreadMessageList: ({ components }: { components: { UserMessage: React.ComponentType } }) => {
    const UserMessage = components.UserMessage

    return <UserMessage />
  }
}))

vi.mock('@/components/assistant-ui/thread/user-message', () => ({
  UserMessage: ({
    onRequestRestoreConfirm
  }: {
    onRequestRestoreConfirm?: (messageId: string, target: { text: string; userOrdinal: number | null }) => void
  }) => (
    <button
      onClick={() => onRequestRestoreConfirm?.('message-1', { text: 'restore me', userOrdinal: 1 })}
      type="button"
    >
      request restore
    </button>
  )
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ onConfirm, open }: { onConfirm: () => Promise<void> | void; open: boolean }) => {
    confirmHandler.current = onConfirm

    return open ? (
      <button onClick={() => void onConfirm()} type="button">
        confirm restore
      </button>
    ) : null
  }
}))

vi.mock('@/components/assistant-ui/chat-empty-slot', () => ({ ChatEmptySlot: () => null }))
vi.mock('@/components/assistant-ui/thread/assistant-message', () => ({ AssistantMessage: () => null }))
vi.mock('@/components/assistant-ui/thread/status', () => ({
  BackgroundResumeNotice: () => null,
  ThreadCompactionIndicator: () => null,
  CenteredThreadSpinner: () => null
}))
vi.mock('@/components/assistant-ui/thread/system-message', () => ({ SystemMessage: () => null }))
vi.mock('@/components/assistant-ui/thread/timeline', () => ({ ThreadTimeline: () => null }))
vi.mock('@/components/assistant-ui/thread/user-edit-composer', () => ({ UserEditComposer: () => null }))

import { I18nProvider } from '@/i18n'

import { Thread } from '.'

afterEach(() => {
  cleanup()
  notifyError.mockReset()
  confirmHandler.current = null
})

describe('Thread restore errors', () => {
  it('uses Simplified Chinese copy when restoring a message fails', async () => {
    const onRestoreToMessage = vi.fn().mockRejectedValue(new Error('restore exploded'))

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Thread onRestoreToMessage={onRestoreToMessage} />
      </I18nProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'request restore' }))
    fireEvent.click(screen.getByRole('button', { name: 'confirm restore' }))

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(expect.any(Error), '恢复失败'))
  })

  it('localizes the unavailable restore callback error', () => {
    const view = render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Thread onRestoreToMessage={() => undefined} />
      </I18nProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'request restore' }))

    view.rerender(
      <I18nProvider configClient={null} initialLocale="zh">
        <Thread />
      </I18nProvider>
    )

    expect(confirmHandler.current).not.toBeNull()
    expect(() => confirmHandler.current?.()).toThrow('恢复失败')
  })
})
