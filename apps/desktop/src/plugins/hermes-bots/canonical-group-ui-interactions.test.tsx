import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { request, viewport } = vi.hoisted(() => ({ request: vi.fn(), viewport: { width: 1440 } }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { createGroupGateway, pluginSdkMock } = await import('./group-test-utils')
  const { useLayoutEffect } = await import('react')
  const { en } = await import('@/i18n/en')
  const gateway = createGroupGateway()

  return {
    ...(await pluginSdkMock(gateway.host)),
    host: { ...gateway.host, requestProfile: request },
    useI18n: () => ({ locale: 'en', t: en }),
    usePluginI18n: () => translateBots,
    useValue: useStore,
    // Layout is synthetic here; a real browser owns visual width verification.
    useResizeObserver: (
      callback: (entries: readonly ResizeObserverEntry[]) => void,
      ..._refs: RefObject<Element | null>[]
    ) => {
      useLayoutEffect(() => {
        callback([{ contentRect: { width: viewport.width } } as ResizeObserverEntry])
      }, [callback])
    }
  }
})

import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import { CanonicalGroupWorkspace } from './canonical-group-workspace'
import type { CanonicalGroupBinding, CanonicalRoomMember } from './canonical-groups'
import { $botMeta, $lastRoster } from './data'
import { clearGroupComposerDrafts } from './group-panes'
import { translateBots } from './i18n-test-helper'

const labels = CANONICAL_GROUP_LOCALES.en
const binding = { connectionId: 'remote-owner', profile: 'team', roomId: 'room-one' }

const members: CanonicalRoomMember[] = [
  { member_id: 'research-id', profile: 'researcher', handle: 'original-researcher', display_name: 'Researcher' },
  { member_id: 'review-id', profile: 'reviewer', handle: 'review', display_name: 'Reviewer' }
]

const log = [
  {
    seq: 1,
    kind: 'message.user',
    actor: { kind: 'user', display_name: 'Morgan' },
    payload: { text: 'Please review the launch plan.' }
  },
  {
    seq: 2,
    kind: 'message.member',
    actor: { kind: 'member', id: 'research-id' },
    payload: { text: 'The research is complete.' }
  }
]

const originalDesktop = window.hermesDesktop

beforeEach(() => {
  viewport.width = 1440
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, writable: true, value: undefined })
  $lastRoster.set([])
  $botMeta.set({})
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  clearGroupComposerDrafts()
  request.mockReset()
  localStorage.clear()
  $lastRoster.set([])
  $botMeta.set({})
  window.hermesDesktop = originalDesktop
  vi.restoreAllMocks()
})

function serve({ working = false, events = log } = {}) {
  request.mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      return { room: { room_id: binding.roomId, name: 'Content team', members }, driver_status: { working } }
    }

    if (method === 'groups.log') {
      return { events }
    }

    return {}
  })
}

async function compose() {
  const input = (await screen.findByRole('textbox', { name: labels.groupMessage })) as HTMLTextAreaElement
  await waitFor(() => expect(input.disabled).toBe(false))

  return input
}

it('searches the current conversation and clears highlighting without discarding messages or its draft', async () => {
  serve()
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  const input = await compose()
  fireEvent.change(input, { target: { value: 'Keep my draft' } })
  fireEvent.click(screen.getByRole('button', { name: labels.searchMessages }))
  const search = screen.getByRole('textbox', { name: labels.searchMessages })
  fireEvent.change(search, { target: { value: 'launch' } })

  expect(screen.getByText(log[0].payload.text)).toBeTruthy()
  expect(screen.getByText(log[1].payload.text)).toBeTruthy()
  expect(view.container.querySelectorAll('[data-search-match="true"]')).toHaveLength(1)
  expect(view.container.querySelectorAll('[data-search-dim="true"]')).toHaveLength(1)
  expect(input.value).toBe('Keep my draft')

  fireEvent.change(search, { target: { value: 'no-such-message' } })
  expect(screen.getByText(labels.noResults)).toBeTruthy()
  fireEvent.change(search, { target: { value: '' } })
  expect(view.container.querySelector('[data-search-dim]')).toBeNull()
  expect(screen.queryByText(labels.noResults)).toBeNull()
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(screen.queryByRole('textbox', { name: labels.searchMessages })).toBeNull()
  expect(input.value).toBe('Keep my draft')
  expect(request.mock.calls.every(call => ['groups.state', 'groups.log'].includes(call[1]))).toBe(true)
})

it('counts an author-name search consistently with its highlighted message', async () => {
  serve()
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  await compose()
  fireEvent.click(screen.getByRole('button', { name: labels.searchMessages }))
  fireEvent.change(screen.getByRole('textbox', { name: labels.searchMessages }), { target: { value: 'Researcher' } })
  expect(view.container.querySelectorAll('[data-search-match="true"]')).toHaveLength(1)
  expect(screen.queryByText(labels.noResults)).toBeNull()
})

it('opens group information beside the chat and mentions a member by its frozen handle', async () => {
  serve()
  $lastRoster.set([{ name: 'researcher', connectionId: binding.connectionId, display_name: 'Renamed Researcher' }])
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  const input = await compose()
  const toggle = screen.getByRole('button', { name: labels.groupInfo })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  const info = screen.getByRole('complementary', { name: labels.groupInfo })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(within(info).getByRole('button', { name: `${labels.reply} Renamed Researcher` })).toBeTruthy()
  fireEvent.click(within(info).getByRole('button', { name: `${labels.reply} Renamed Researcher` }))
  expect(input.value).toBe('@Renamed Researcher ')
  expect(view.container.querySelector('aside')).not.toBeNull()
  expect(request.mock.calls.some(call => !['groups.state', 'groups.log'].includes(call[1]))).toBe(false)
  fireEvent.click(within(info).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('complementary', { name: labels.groupInfo })).toBeNull()
})

it('uses the same information content in a narrow dialog, closes on Escape and keeps the draft', async () => {
  viewport.width = 850
  serve()
  render(<CanonicalGroupWorkspace binding={binding} />)
  const input = await compose()
  fireEvent.change(input, { target: { value: 'Draft in a narrow window' } })
  fireEvent.click(screen.getByRole('button', { name: labels.groupInfo }))
  const dialog = await screen.findByRole('dialog', { name: labels.groupInfo })
  expect(within(dialog).getByRole('button', { name: `${labels.reply} Researcher` })).toBeTruthy()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: labels.groupInfo })).toBeNull())
  expect(input.value).toBe('Draft in a narrow window')
})

it('offers Stop only while the group is working and sends it to the captured room owner', async () => {
  serve()
  const idle = render(<CanonicalGroupWorkspace binding={binding} />)
  await compose()
  expect(screen.queryByRole('button', { name: 'Stop this round' })).toBeNull()
  idle.unmount()

  serve({ working: true })
  render(<CanonicalGroupWorkspace binding={binding} />)
  await compose()
  fireEvent.click(screen.getByRole('button', { name: 'Stop this round' }))
  await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.stop')).toBe(true))
  const stop = request.mock.calls.find(call => call[1] === 'groups.stop')!
  expect(stop[0]).toMatchObject({ connectionId: binding.connectionId, targetProfile: binding.profile })
  expect(stop[2]).toMatchObject({ room_id: binding.roomId, profile: binding.profile, cancel_id: expect.any(String) })
})

it('blocks icon Send and keyboard submission until an uploaded attachment is acknowledged', async () => {
  const attachment = { attachment_id: 'uploaded-one', kind: 'file', name: 'review.txt', mime: 'text/plain', size: 2 }
  let acknowledge!: () => void
  serve()
  const reads = request.getMockImplementation()!
  request.mockImplementation(async (route, method, params) =>
    method === 'groups.attachment.upload'
      ? new Promise(resolve => {
          acknowledge = () => resolve(attachment)
        })
      : reads(route, method, params)
  )
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  const input = await compose()
  fireEvent.change(input, { target: { value: 'Read this attachment' } })
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['hi'], attachment.name, { type: attachment.mime })] }
  })
  await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.attachment.upload')).toBe(true))
  const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
  expect(send.disabled).toBe(true)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(request.mock.calls.some(call => call[1] === 'groups.send')).toBe(false)
  await act(async () => acknowledge())
  await waitFor(() => expect(send.disabled).toBe(false))
  fireEvent.click(send)
  await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.send')).toBe(true))
  expect(request.mock.calls.find(call => call[1] === 'groups.send')?.[2]).toMatchObject({
    room_id: binding.roomId,
    profile: binding.profile,
    payload: { text: 'Read this attachment', attachments: [attachment] }
  })
})

it('keeps an acknowledged discard successful when refreshing the room fails, and never replays it on refresh', async () => {
  const action = { kind: 'discard', member_id: members[0].member_id, task_id: 'unknown-task', execution_generation: 7 }
  let acknowledged = false
  let allowRefresh = false
  request.mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      if (acknowledged && !allowRefresh) {
        throw new Error('Room refresh unavailable')
      }

      return {
        room: { room_id: binding.roomId, name: 'Content team', members },
        driver_status: { pending_actions: acknowledged ? [] : [action] }
      }
    }

    if (method === 'groups.log') {
      return { events: log }
    }

    if (method === 'groups.discard') {
      acknowledged = true
    }

    return {}
  })
  render(<CanonicalGroupWorkspace binding={binding} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
  const confirmation = screen.getByRole('dialog', { name: labels.discardUnknown })
  fireEvent.click(within(confirmation).getByRole('button', { name: labels.confirmDiscard }))
  await waitFor(() => expect(acknowledged).toBe(true))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: labels.discardUnknown })).toBeNull())
  expect(screen.getByRole('alert').textContent).toContain('Room refresh unavailable')
  expect(request.mock.calls.filter(call => call[1] === 'groups.discard')).toHaveLength(1)

  allowRefresh = true
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(screen.queryByText('Room refresh unavailable')).toBeNull())
  expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
  expect(request.mock.calls.filter(call => call[1] === 'groups.discard')).toHaveLength(1)
})

it.each([
  ['rename', 1440],
  ['disband', 1440],
  ['discard', 1440],
  ['rename', 850],
  ['disband', 850],
  ['discard', 850]
] as const)(
  'hides an open %s dialog at width %i with its room, then restores it without writing',
  async (kind, width) => {
    viewport.width = width

    const action = {
      kind: 'discard',
      member_id: members[0].member_id,
      task_id: 'unknown-task',
      execution_generation: 7
    }

    request.mockImplementation(async (_route, method) => {
      if (method === 'groups.state') {
        return {
          room: { room_id: binding.roomId, name: 'Content team', members },
          driver_status: { pending_actions: kind === 'discard' ? [action] : [] }
        }
      }

      if (method === 'groups.log') {
        return { events: log }
      }

      return {}
    })
    const view = render(<CanonicalGroupWorkspace binding={binding} />)
    await compose()

    if (kind === 'discard') {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
      await screen.findByRole('dialog', { name: labels.discardUnknown })
    } else {
      fireEvent.click(screen.getByRole('button', { name: labels.groupInfo }))
      const info = screen.getByRole('complementary', { name: labels.groupInfo })

      if (kind === 'rename') {
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
        fireEvent.click(within(info).getAllByRole('button', { name: 'Rename' }).at(-1)!)
        fireEvent.change(await screen.findByRole('textbox', { name: 'New name' }), {
          target: { value: 'Unsubmitted new title' }
        })
      } else {
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
        fireEvent.click(within(info).getByRole('button', { name: /disband/i }))
        await screen.findByRole('dialog', { name: /disband/i })
      }
    }

    view.rerender(<CanonicalGroupWorkspace binding={binding} visible={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    view.rerender(<CanonicalGroupWorkspace binding={binding} visible />)

    const restored = await screen.findByRole('dialog', {
      name: kind === 'rename' ? 'Rename' : kind === 'discard' ? labels.discardUnknown : /disband/i
    })

    if (kind === 'rename') {
      expect((within(restored).getByRole('textbox', { name: 'New name' }) as HTMLInputElement).value).toBe(
        'Unsubmitted new title'
      )
    } else if (kind === 'discard') {
      expect(within(restored).getByRole('button', { name: labels.confirmDiscard })).toBeTruthy()
    } else {
      expect(within(restored).getByRole('button', { name: /disband/i })).toBeTruthy()
    }

    expect(request.mock.calls.every(call => ['groups.state', 'groups.log'].includes(call[1]))).toBe(true)
  }
)

it.each(['roomId', 'profile', 'connectionId'] as const)(
  'isolates draft, search and group information after the %s changes',
  async key => {
    serve()
    const view = render(<CanonicalGroupWorkspace binding={binding} />)
    fireEvent.change(await compose(), { target: { value: 'Previous room draft' } })
    fireEvent.click(screen.getByRole('button', { name: labels.groupInfo }))
    fireEvent.click(screen.getByRole('button', { name: labels.searchMessages }))
    fireEvent.change(screen.getByRole('textbox', { name: labels.searchMessages }), { target: { value: 'launch' } })
    const next: CanonicalGroupBinding = { ...binding, [key]: `different-${key}` }
    view.rerender(<CanonicalGroupWorkspace binding={next} />)
    const input = await compose()
    expect(input.value).toBe('')
    expect(screen.queryByRole('textbox', { name: labels.searchMessages })).toBeNull()
    expect(screen.queryByRole('complementary', { name: labels.groupInfo })).toBeNull()
    fireEvent.change(input, { target: { value: 'Message for the new owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.send')).toBe(true))
    const sent = request.mock.calls.find(call => call[1] === 'groups.send')!
    expect(sent[0]).toMatchObject({ connectionId: next.connectionId, targetProfile: next.profile })
    expect(sent[2]).toMatchObject({
      room_id: next.roomId,
      profile: next.profile,
      payload: { text: 'Message for the new owner' }
    })
  }
)
