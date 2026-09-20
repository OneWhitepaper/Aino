import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { queryClient } from '@/lib/query-client'
import * as gateway from '@/store/gateway'
import { stubResizeObserver } from '@/test/jsdom'

import { ConversationSlashSuggestions } from './conversation-slash-suggestions'
import { conversationCommandReader } from './hooks/use-conversation-slash-completions'
import { composerPlainText, placeCaretAtOffset } from './rich-editor'
stubResizeObserver()
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})
const owner = { connectionId: 'captured', installId: 'host', conversationId: 'conversation' }

function Probe({ profile, generation = 1, initial = '/' }: { profile: string; generation?: number; initial?: string }) {
  const [text, setText] = useState(initial)
  const input = useRef<HTMLDivElement>(null)

  return (
    <>
      <div
        aria-label="Draft"
        contentEditable
        data-slot="composer-rich-input"
        ref={input}
        role="textbox"
        suppressContentEditableWarning
      />
      <button onClick={() => setText('Voice draft /writer-skill ')}>External draft</button>
      <button onClick={() => setText(value => `${value} spoken`)}>Append voice</button>
      <output data-testid="serialized">{text}</output>
      <ConversationSlashSuggestions
        generation={generation}
        input={input}
        key={`${profile}:${generation}`}
        onChange={setText}
        owner={owner}
        profile={profile}
        text={text}
      />
    </>
  )
}

it.each(['/', 'Please use / here'])('uses the original chips and exact expert cache for %s', async initial => {
  const rpc = vi
    .spyOn(gateway, 'requestGatewayForAgent')
    .mockImplementation(async (_connection, _profile, method, params) => {
      if (method === 'conversations.capabilities') {
        return { scoped_commands: true, supported_read_commands: ['status'] } as never
      }

      const skill = `/${params?.profile}-skill`

      return {
        pairs: [
          ['/status', 'Status'],
          ['/new', 'New'],
          [skill, 'Skill']
        ],
        categories: [{ name: 'Skills', pairs: [[skill, 'Skill']] }],
        skills: { [skill]: { origin: 'local', usage: 1 } }
      } as never
    })

  const view = render(<Probe initial={initial} profile="writer" />)
  const input = screen.getByLabelText('Draft') as HTMLDivElement
  act(() => {
    input.focus()
    placeCaretAtOffset(input, initial.indexOf('/') + 1)
  })
  fireEvent.keyUp(input, { key: '/' })
  await screen.findByRole('button', { name: /writer-skill/ })
  expect(screen.queryByRole('button', { name: /^\/new/ })).toBeNull()
  view.rerender(<Probe initial={initial} profile="reviewer" />)
  await screen.findByRole('button', { name: /reviewer-skill/ })
  expect(screen.queryByRole('button', { name: /writer-skill/ })).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(composerPlainText(input)).toBe(initial)
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  expect(composerPlainText(input)).toBe(initial)
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Tab' })
  await waitFor(() =>
    expect(composerPlainText(input)).toBe(initial === '/' ? '/reviewer-skill ' : 'Please use /reviewer-skill here')
  )
  expect(input.querySelector('[data-slash-kind=skill]')?.textContent).toContain('reviewer-skill')
  fireEvent.keyDown(input, { key: 'z', metaKey: true })
  expect(composerPlainText(input)).toBe(initial)
  fireEvent.keyDown(input, { key: 'z', metaKey: true, shiftKey: true })
  expect(input.querySelector('[data-slash-kind=skill]')).not.toBeNull()
  act(() => placeCaretAtOffset(input, (initial === '/' ? 0 : 'Please use '.length) + '/reviewer-skill'.length))
  fireEvent.keyDown(input, { key: 'Backspace' })
  expect(input.querySelector('[data-slash-kind=skill]')).toBeNull()
  expect(screen.getByTestId('serialized').textContent).toBe(composerPlainText(input))
  fireEvent.click(screen.getByRole('button', { name: 'External draft' }))
  expect(composerPlainText(input)).toBe('Voice draft /writer-skill ')
  expect(input.querySelector('[data-slash-kind=skill]')).not.toBeNull()
  expect(rpc.mock.calls.every(call => call[0] === 'captured' && call[1] === 'default')).toBe(true)
  expect(rpc).toHaveBeenCalledWith('captured', 'default', 'commands.catalog', { profile: 'writer' })
  expect(rpc).toHaveBeenCalledWith('captured', 'default', 'commands.catalog', { profile: 'reviewer' })
})
it('does not request unsafe discovery without the capability and never completes mutating read arguments', async () => {
  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ scoped_commands: false } as never)
  render(<Probe profile="writer" />)
  await waitFor(() => expect(rpc).toHaveBeenCalledOnce())
  expect(screen.queryByRole('listbox')).toBeNull()
  const reader = conversationCommandReader(owner, 'writer', ['model'], rpc as typeof gateway.requestGatewayForAgent)
  expect(await reader.request('complete.slash', { text: '/model switch' })).toEqual({ items: [] })
  expect(rpc).toHaveBeenCalledOnce()
})

it.each(['External draft', 'Append voice'])('preserves IME edits and concurrent %s', async action => {
  vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ scoped_commands: false } as never)
  render(<Probe initial="before" profile="writer" />)
  const input = screen.getByLabelText('Draft')
  fireEvent.compositionStart(input)
  fireEvent.input(input, { target: { textContent: 'composed' }, isComposing: true })
  fireEvent.click(screen.getByRole('button', { name: action }))
  const external = action === 'Append voice' ? ' spoken' : 'Voice draft /writer-skill '
  expect(screen.getByTestId('serialized').textContent).toContain(external)
  fireEvent.compositionEnd(input)
  const result = screen.getByTestId('serialized').textContent
  expect(result).toContain('composed')
  expect(result).toContain(external)
  expect(composerPlainText(input)).toBe(result)
})
