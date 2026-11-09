import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ClipboardEvent } from 'react'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GroupMentionInputHandle } from './group-chat-parts'
import { translateBots } from './i18n-test-helper'
import type { GroupMember } from './types'

// Group-composer mentions (#89049): the core composer's @-completion area
// doesn't mount inside workspace tiles, so the room's composers wrap the SDK
// input with a member-scoped popover of their own. Everything it inserts has
// to be a string parseGroupChatMentions resolves.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')
  const base = await pluginSdkMock(host)
  const popover = await import('@/components/ui/popover')

  return {
    ...base,
    ...popover,
    Button: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: () => null,
    Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
    RowButton: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    Textarea: (props: React.ComponentProps<'textarea'>) => <textarea {...props} />,
    useI18n: () => ({ t: (_key: string, fallback: string) => fallback }),
    // The plugin bundle normally lands via `ctx.i18n.register` at load, so
    // without this every localized label renders empty.
    usePluginI18n: () => translateBots
  }
})

const MEMBERS: GroupMember[] = [
  { handle: 'alpha', name: 'alpha', title: '' },
  { handle: 'builder', name: 'builder', title: '' }
]

/** Render the composer the way a room does: value owned by the caller (the
 *  draft atom in production), popover scoped to the seated members. */
async function mount(
  initial = '',
  members = MEMBERS,
  mentionScope = 'test-room',
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
) {
  const { GroupMentionInput } = await import('./group-chat-parts')
  const inputRef = createRef<GroupMentionInputHandle>()
  const onChange = vi.fn()
  const onSubmitDraft = vi.fn()
  const onInvalidMentionPaste = vi.fn()

  function Harness() {
    const [value, setValue] = useState(initial)

    return (
      <GroupMentionInput
        aria-label="Message Core"
        handleFor={member => member.handle}
        members={members}
        mentionScope={mentionScope}
        onChange={next => {
          onChange(next)
          setValue(next)
        }}
        onInvalidMentionPaste={onInvalidMentionPaste}
        onPaste={onPaste}
        onSubmitDraft={onSubmitDraft}
        ref={inputRef}
        value={value}
      />
    )
  }

  render(<Harness />)

  return {
    input: screen.getByLabelText('Message Core') as HTMLTextAreaElement,
    inputRef,
    onChange,
    onSubmitDraft,
    onInvalidMentionPaste
  }
}

/** Type `text`, then park the caret at `caret` (default: end of the text).
 *  The click is how the component re-reads the caret without a keystroke —
 *  jsdom does not preserve a selection across React's controlled re-write. */
function typeInto(input: HTMLTextAreaElement, text: string, caret = text.length) {
  fireEvent.change(input, { target: { value: text } })
  input.setSelectionRange(caret, caret)
  fireEvent.click(input)
}

const options = () => screen.queryAllByRole('option').map(option => option.textContent || '')

beforeEach(() => {
  vi.resetModules()
})

describe('recipient clipboard operations', () => {
  const seated: GroupMember[] = [
    { name: 'encoded-a', handle: 'encoded-a', display_name: '测试' },
    { name: 'encoded-b', handle: 'encoded-b', display_name: '测试' }
  ]

  const clipboard = () => {
    const data = new Map<string, string>()

    return {
      getData: (kind: string) => data.get(kind) || '',
      setData: (kind: string, value: string) => data.set(kind, value),
      types: []
    }
  }

  it('copies and pastes an exact same-name recipient while keeping exported plain text friendly', async () => {
    const { input, onChange } = await mount('@encoded-b ', seated)
    const data = clipboard()
    input.setSelectionRange(0, 3)
    fireEvent.copy(input, { clipboardData: data })
    expect(data.getData('text/plain')).toBe('@测试')
    expect(data.getData('text/plain')).not.toContain('encoded')
    input.setSelectionRange(input.value.length, input.value.length)
    expect(fireEvent.paste(input, { clipboardData: data })).toBe(false)
    expect(input.value).toBe('@测试 @测试')
    expect(onChange).toHaveBeenLastCalledWith('@encoded-b @encoded-b')
  })

  it('cut preserves the other identical recipient and carries the exact removed identity', async () => {
    const { input, onChange } = await mount('@encoded-a @encoded-b', seated)
    const data = clipboard()
    input.setSelectionRange(0, 4)
    expect(fireEvent.cut(input, { clipboardData: data })).toBe(false)
    expect(input.value).toBe('@测试')
    expect(onChange).toHaveBeenLastCalledWith('@encoded-b')
    input.setSelectionRange(0, 0)
    fireEvent.paste(input, { clipboardData: data })
    expect(onChange).toHaveBeenLastCalledWith('@encoded-a @encoded-b')
  })

  it('rejects metadata from another room and leaves plain names unbound instead of broadcasting silently', async () => {
    const { input, onChange, onInvalidMentionPaste } = await mount('', seated, 'different-room')
    const { copyGroupMentions, GROUP_MENTION_CLIPBOARD_TYPE } = await import('./group-chat-mention-clipboard')
    const { projectGroupMentions, unresolvedGroupMentions } = await import('./group-chat-mentions')
    const projection = projectGroupMentions('@encoded-a', [{ handle: 'encoded-a', label: '测试' }])
    const copied = copyGroupMentions(projection, 0, 3, 'original-room')
    const data = clipboard()
    data.setData('text/plain', copied.text)
    data.setData(GROUP_MENTION_CLIPBOARD_TYPE, copied.envelope!)
    expect(fireEvent.paste(input, { clipboardData: data })).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith('＠测试')
    expect(onInvalidMentionPaste).toHaveBeenCalledOnce()
    expect(unresolvedGroupMentions('＠测试', [{ handle: 'encoded-a', label: '测试' }])).toHaveLength(1)
  })

  it('does not intercept partial selections, plain text or attachment paste ownership', async () => {
    const externalPaste = vi.fn((event: ClipboardEvent<HTMLTextAreaElement>) => event.preventDefault())
    const { input, onChange } = await mount('@encoded-a help', seated, 'test-room', externalPaste)
    const data = clipboard()
    input.setSelectionRange(1, 3)
    expect(fireEvent.copy(input, { clipboardData: data })).toBe(true)
    expect(data.getData('application/x-aino-group-mention+json')).toBe('')
    const before = onChange.mock.calls.length
    fireEvent.paste(input, { clipboardData: data })
    expect(externalPaste).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(before)
  })

  it('neutralizes a foreign label that happens to be a valid local ASCII handle', async () => {
    const { input, onChange, onInvalidMentionPaste } = await mount(
      '',
      [{ name: 'writer', handle: 'writer', display_name: '本地成员' }],
      'local-room'
    )

    const { copyGroupMentions, GROUP_MENTION_CLIPBOARD_TYPE } = await import('./group-chat-mention-clipboard')
    const { projectGroupMentions, unresolvedGroupMentions } = await import('./group-chat-mentions')
    const projection = projectGroupMentions('@foreign-id', [{ handle: 'foreign-id', label: 'writer' }])
    const copied = copyGroupMentions(projection, 0, projection.text.length, 'foreign-room')
    const data = clipboard()
    data.setData('text/plain', copied.text)
    data.setData(GROUP_MENTION_CLIPBOARD_TYPE, copied.envelope!)
    fireEvent.paste(input, { clipboardData: data })
    expect(input.value).toBe('＠writer')
    expect(onChange).toHaveBeenLastCalledWith('＠writer')
    expect(onInvalidMentionPaste).toHaveBeenCalledOnce()
    expect(unresolvedGroupMentions('＠writer', [{ handle: 'writer', label: '本地成员' }])).toHaveLength(1)
  })

  it('keeps ordinary raw-handle paste semantics when it has no Aino metadata', async () => {
    const { input, onChange, onInvalidMentionPaste } = await mount('', seated)
    const data = clipboard()
    data.setData('text/plain', '@encoded-b')
    expect(fireEvent.paste(input, { clipboardData: data })).toBe(true)
    fireEvent.change(input, { target: { value: '@encoded-b' } })
    expect(input.value).toBe('@测试')
    expect(onChange).toHaveBeenLastCalledWith('@encoded-b')
    expect(onInvalidMentionPaste).not.toHaveBeenCalled()
  })

  it('keeps the exact binding across native undo and redo of surrounding prose', async () => {
    const { input, onChange } = await mount('@encoded-b help', seated)
    fireEvent.input(input, { inputType: 'historyUndo', target: { value: '@测试 ' } })
    expect(onChange).toHaveBeenLastCalledWith('@encoded-b ')
    fireEvent.input(input, { inputType: 'historyRedo', target: { value: '@测试 help' } })
    expect(onChange).toHaveBeenLastCalledWith('@encoded-b help')
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the @-token at the caret', () => {
  it('opens the popover on a token that begins a word', async () => {
    const { input } = await mount()

    typeInto(input, 'hey @al')

    expect(options().some(label => label.toLowerCase().startsWith('alpha'))).toBe(true)
  })

  it('offers one readable room-wide broadcast choice, with both aliases remaining searchable', async () => {
    const { input } = await mount()

    typeInto(input, '@')

    expect(options().filter(label => label === 'Every bot in the room')).toHaveLength(1)
    typeInto(input, '@all')
    expect(input.value).toBe('@Every bot in the room')
    expect(options()).toEqual([])
  })

  it('narrows to @everyone as the query grows', async () => {
    const { input } = await mount()

    typeInto(input, 'ping @every')

    expect(options().filter(label => label === 'Every bot in the room')).toHaveLength(1)
    expect(options().some(label => label.toLowerCase().startsWith('alpha'))).toBe(false)
  })

  it('stays closed mid-word, on plain text, and with the caret before the @', async () => {
    const { input } = await mount()

    typeInto(input, 'email me a@b')

    expect(options()).toHaveLength(0)

    typeInto(input, 'plain text')

    expect(options()).toHaveLength(0)

    typeInto(input, 'hey @al', 3)

    expect(options()).toHaveLength(0)
  })
})

describe('insertion', () => {
  it('writes exactly "@handle " — the shape parseGroupChatMentions resolves', async () => {
    const { input, onChange } = await mount()

    typeInto(input, 'hey @al')
    const option = screen.getAllByRole('option').find(option => option.textContent?.toLowerCase().startsWith('alpha'))
    fireEvent.mouseDown(option!)

    expect(onChange).toHaveBeenLastCalledWith('hey @alpha ')
  })

  it('preventDefaults the mousedown so the input keeps focus', async () => {
    const { input } = await mount()

    typeInto(input, 'hey @al')
    const option = screen.getAllByRole('option').find(option => option.textContent?.toLowerCase().startsWith('alpha'))

    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.mouseDown(option!)).toBe(false)
  })

  it('replaces the whole token, not just the typed suffix', async () => {
    const { input, onChange } = await mount()

    typeInto(input, '@bui and then some', 4)
    const option = screen.getAllByRole('option').find(option => option.textContent?.toLowerCase().startsWith('builder'))
    fireEvent.mouseDown(option!)

    expect(onChange).toHaveBeenLastCalledWith('@builder  and then some')
  })

  it('lists every seated member under a bare @, keyed by handle', async () => {
    const { input } = await mount()

    typeInto(input, '@')

    // Handles only — a profile name that never resolved would surface as
    // "@undefined" and route to nobody.
    expect(options().some(label => label.toLowerCase().startsWith('alpha'))).toBe(true)
    expect(options().some(label => label.toLowerCase().startsWith('builder'))).toBe(true)
    expect(options().some(label => label.includes('undefined'))).toBe(false)
  })
})

describe('readable recipients with exact routing', () => {
  const seated: GroupMember[] = [
    { name: 'u6d4b-u8bd5', handle: 'u6d4b-u8bd5', display_name: '测试' },
    { name: 'second-writer', handle: 'second-writer', display_name: '测试' },
    { name: 'visual-designer', handle: 'visual-designer', display_name: '视觉设计师' }
  ]

  it('searches Chinese names and shows the selected name while the draft keeps its frozen handle', async () => {
    const { input, onChange } = await mount('', seated)
    typeInto(input, '请 @视觉')
    expect(options()).toEqual(['视觉设计师'])
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('请 @视觉设计师 ')
    expect(onChange).toHaveBeenLastCalledWith('请 @visual-designer ')
    typeInto(input, input.value + '帮我看下')
    expect(onChange).toHaveBeenLastCalledWith('请 @visual-designer 帮我看下')
  })

  it('keeps two same-name members distinct through selection and later edits', async () => {
    const { input, onChange } = await mount('', seated)
    typeInto(input, '@测试')
    const matches = screen.getAllByRole('option')
    expect(matches).toHaveLength(2)
    expect(matches.every(option => option.querySelector('.aino-group-mention-name')?.textContent === '测试')).toBe(true)
    fireEvent.mouseDown(matches[1])
    expect(input.value).toBe('@测试 ')
    expect(onChange).toHaveBeenLastCalledWith('@second-writer ')
    typeInto(input, input.value + '继续')
    expect(onChange).toHaveBeenLastCalledWith('@second-writer 继续')
  })

  it('removes a mention atomically on Backspace without leaving fragments of an encoded address', async () => {
    const { input, onChange } = await mount('@u6d4b-u8bd5 帮我看看', seated)
    expect(input.value).toBe('@测试 帮我看看')
    input.setSelectionRange(3, 3)
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(input.value).toBe(' 帮我看看')
    expect(onChange).toHaveBeenLastCalledWith(' 帮我看看')
  })

  it('keeps an unknown draft address literal and never resolves a typed display name by guessing', async () => {
    const { input, onChange } = await mount('@unknown help', seated)
    expect(input.value).toBe('@unknown help')
    typeInto(input, '@测试 help')
    expect(onChange).toHaveBeenLastCalledWith('@测试 help')
    expect(onChange).not.toHaveBeenLastCalledWith('@u6d4b-u8bd5 help')
  })

  it('projects imperative member actions through the same frozen-address path', async () => {
    const { input, inputRef, onChange } = await mount('', seated)
    act(() => inputRef.current?.mention('u6d4b-u8bd5'))
    expect(input.value).toBe('@测试 ')
    expect(onChange).toHaveBeenLastCalledWith('@u6d4b-u8bd5 ')
  })

  it('keeps typed composition text and waits for IME completion before showing recipient choices', async () => {
    const { input, onSubmitDraft } = await mount('', seated)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '@视觉' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(options()).toHaveLength(0)
    expect(onSubmitDraft).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    expect(options()).toEqual(['视觉设计师'])
  })
})

describe('keyboard (#89884)', () => {
  it('submits on Enter and leaves Shift+Enter to the textarea', async () => {
    const { input, onSubmitDraft } = await mount('a room prompt')

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSubmitDraft).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(onSubmitDraft).toHaveBeenCalledTimes(1)
  })

  it('inserts the highlighted mention on Enter while the popover is open', async () => {
    const { input, onChange, onSubmitDraft } = await mount()

    typeInto(input, 'hey @alp')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).toHaveBeenLastCalledWith('hey @alpha ')
    expect(onSubmitDraft).not.toHaveBeenCalled()
  })

  // #93528: Enter here confirms composed Chinese/Japanese/Korean text. It must
  // neither insert a mention nor submit the draft. isComposing covers Chromium;
  // keyCode 229 covers macOS Chinese IMEs that fire Enter after compositionend
  // with isComposing already false.
  it('swallows IME composition Enters (#93528)', async () => {
    const { input, onSubmitDraft } = await mount('中文')

    fireEvent.keyDown(input, { isComposing: true, key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })

    expect(onSubmitDraft).not.toHaveBeenCalled()
  })
})

// #91706: a command approval in a room could be SELECTED but never sent — the
// footer "Respond" button sat off-screen or under an overflowing code block.
// Approvals are a closed choice set, so the click itself is the answer.
describe('approval card (#91706)', () => {
  const entry = {
    at: 1,
    choices: ['once', 'session', 'always', 'deny'],
    command: 'rm -rf /tmp/scratch',
    group: 'Core',
    kind: 'approval' as const,
    member: 'alpha',
    memberKey: 'alpha',
    multiSelect: false,
    question: '',
    requestId: 'req-1',
    sessionId: 'sid-1',
    thread: 't1'
  }

  it('submits the clicked choice at once, with no second Respond click', async () => {
    const answer = vi.fn(async () => undefined)
    vi.doMock('./group-turns', () => ({ answerGroupClarify: answer }))
    vi.doMock('./group-chat', () => ({ appendGroupChatEntry: vi.fn() }))
    const { GroupClarifyCard } = await import('./group-chat-parts')

    render(<GroupClarifyCard entry={entry} members={MEMBERS} />)

    expect(screen.queryByRole('button', { name: 'Respond' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'once' }))
    // A second click while the first is in flight must not double-submit.
    fireEvent.click(screen.getByRole('button', { name: 'session' }))

    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(1))
    expect(answer).toHaveBeenCalledWith(entry, MEMBERS[0], 'once')
  })

  it('names a pending command and its failure using the member own connection display name', async () => {
    const answer = vi.fn().mockRejectedValue(new Error('Connection interrupted'))
    const notify = vi.fn()
    host.notify = notify
    vi.doMock('./group-turns', () => ({ answerGroupClarify: answer }))
    vi.doMock('./group-chat', () => ({ appendGroupChatEntry: vi.fn() }))
    const { $botMeta } = await import('./data')
    const { GroupClarifyCard } = await import('./group-chat-parts')
    const profile = 'u6d4b-u8bd5'
    $botMeta.set({ [profile]: { title: '另一连接的助手' }, [`studio::${profile}`]: { title: '工作室测试助手' } })
    const member = { name: profile, connectionId: 'studio', sourceScoped: true, remoteSource: true }
    render(
      <GroupClarifyCard entry={{ ...entry, member: profile, memberKey: `studio::${profile}` }} members={[member]} />
    )

    expect(screen.getByText('@工作室测试助手 wants to run a command:')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'once' }))
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        kind: 'error',
        message: 'Could not send the answer to @工作室测试助手: Connection interrupted'
      })
    )
    expect(notify.mock.calls.flatMap(call => call.map(String)).join(' ')).not.toContain(profile)
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ member: profile }), member, 'once')
  })
})
