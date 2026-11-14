import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type * as GroupRounds from './group-rounds'
import { translateBots } from './i18n-test-helper'

const { send, notify } = vi.hoisted(() => ({ send: vi.fn(() => false), notify: vi.fn() }))
vi.mock('./group-rounds', async importOriginal => ({
  ...(await importOriginal<typeof GroupRounds>()),
  sendToGroupChat: send
}))
vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const base = await pluginSdkMock({ ...createGroupGateway().host, notify })

  return {
    ...base,
    CopyButton: () => null,
    ConfirmDialog: () => null,
    Dialog: () => null,
    DialogContent: () => null,
    DialogDescription: () => null,
    DialogFooter: () => null,
    DialogHeader: () => null,
    DialogTitle: () => null,
    ToggleRow: () => null,
    Tip: ({ children }: { children: ReactNode }) => children,
    usePluginI18n: () => translateBots,
    useI18n: () => ({ t: { common: { save: 'Save', cancel: 'Cancel' } } })
  }
})
vi.mock('./avatar', () => ({ avatarColor: () => '#888', botAppearance: () => ({}), BotFace: () => null }))
vi.mock('./group-chat-parts', () => ({
  GroupClarifyCard: () => null,
  GroupImageControls: () => null,
  GroupMentionInput: ({
    value,
    onChange,
    onSubmitDraft,
    mentionScope,
    onInvalidMentionPaste,
    'aria-label': label
  }: {
    value: string
    onChange: (text: string) => void
    onSubmitDraft: () => void
    mentionScope?: string
    onInvalidMentionPaste: () => void
    'aria-label': string
  }) => (
    <textarea
      aria-label={label}
      data-mention-scope={mentionScope}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onSubmitDraft()
        }
      }}
      onPaste={onInvalidMentionPaste}
      value={value}
    />
  )
}))

import { $botMeta, $lastRoster } from './data'
import { $groupChats } from './group-chat'
import { GroupChatWorkspace } from './group-chat-view'
import { botsText } from './i18n'
import type { GroupMember } from './types'

const members: GroupMember[] = [
  { name: 'builder', handle: 'build-a', title: 'Builder', previous_names: ['old-builder'] },
  { name: 'reviewer', handle: 'review-b', title: 'Reviewer' }
]

let roomSequence = 0
beforeEach(() => {
  send.mockClear()
  notify.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
  $botMeta.set({})
  $lastRoster.set([])
  $groupChats.set({
    Safety: {
      roomId: `room-${++roomSequence}`,
      members,
      log: [{ at: 1, from: { kind: 'user', name: 'You' }, text: 'Original question', thread: 'thread-1' }],
      watermarks: {}
    }
  })
})
afterEach(cleanup)

it('guards both native submit paths without clearing the drafts and permits a validated legacy alias', async () => {
  render(<GroupChatWorkspace group="Safety" members={members} />)

  const main = (await screen.findByRole('textbox', {
    name: botsText().group.messageRoom('Safety')
  })) as HTMLTextAreaElement

  fireEvent.change(main, { target: { value: '@未关联成员 保留这段草稿' } })
  expect((screen.getByRole('button', { name: botsText().group.newThread }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(main, { key: 'Enter' })
  expect(send).not.toHaveBeenCalled()
  expect(main.value).toContain('保留这段草稿')
  expect(notify).toHaveBeenCalledWith({ kind: 'error', message: botsText().canonical.unresolvedMention })

  fireEvent.click(screen.getByRole('button', { name: botsText().group.replyInThread }))
  const reply = screen.getByRole('textbox', { name: botsText().group.replyInThread }) as HTMLTextAreaElement
  expect(reply.dataset.mentionScope).toBe(main.dataset.mentionScope)
  fireEvent.change(reply, { target: { value: '@未关联成员 线程回复' } })
  fireEvent.keyDown(reply, { key: 'Enter' })
  expect(send).not.toHaveBeenCalled()
  expect(reply.value).toContain('线程回复')

  fireEvent.change(main, { target: { value: '@old-builder 验证旧别名' } })
  fireEvent.keyDown(main, { key: 'Enter' })
  expect(send).toHaveBeenCalledWith('Safety', expect.any(Array), '@old-builder 验证旧别名', null, [])
})

it('checks the live room membership at submit and reports an invalid clipboard binding', async () => {
  render(<GroupChatWorkspace group="Safety" members={members} />)

  const main = (await screen.findByRole('textbox', {
    name: botsText().group.messageRoom('Safety')
  })) as HTMLTextAreaElement

  fireEvent.change(main, { target: { value: '@build-a 给原成员的消息' } })
  // A source update can land between the last render and an Enter event.
  $groupChats.get().Safety.members = [members[1], { name: 'new-member', handle: 'new-member' }]
  fireEvent.keyDown(main, { key: 'Enter' })
  expect(send).not.toHaveBeenCalled()
  expect(main.value).toContain('给原成员的消息')
  fireEvent.paste(main)
  expect(notify).toHaveBeenCalledWith({ kind: 'info', message: botsText().canonical.pastedMentionReset })
})
