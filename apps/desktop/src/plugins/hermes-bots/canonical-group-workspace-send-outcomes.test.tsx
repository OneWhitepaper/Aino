import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
const respondModels = vi.hoisted(() => vi.fn())
vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const gateway = createGroupGateway()
  const { en } = await import('@/i18n/en')
  const { CANONICAL_GROUP_LOCALES } = await import('./canonical-group-locales')
  const { ConfirmDialog } = await import('@/components/ui/confirm-dialog')
  const { captureGroupRequests } = await import('./canonical-group-contract-test-utils')
  const { useLayoutEffect } = await import('react')

  return {
    ...(await pluginSdkMock(gateway.host)),
    respondPluginGroupModelRequests: respondModels,
    atom,
    useValue: useStore,
    // This suite exercises the desktop layout; browser tests verify its geometry.
    useResizeObserver: (callback: (entries: readonly ResizeObserverEntry[]) => void) => {
      useLayoutEffect(() => callback([{ contentRect: { width: 1440 } } as ResizeObserverEntry]), [callback])
    },
    ConfirmDialog,
    useQuery: (await import('@tanstack/react-query')).useQuery,
    useI18n: () => ({ t: en }),
    usePluginI18n: () => (key: string) =>
      CANONICAL_GROUP_LOCALES.en[key.replace('canonical.', '') as keyof typeof CANONICAL_GROUP_LOCALES.en] ?? key,
    Button: (p: ComponentProps<'button'>) => <button {...p} />,
    Input: (p: ComponentProps<'input'>) => <input {...p} />,
    RowButton: (p: ComponentProps<'button'>) => <button type="button" {...p} />,
    host: { ...gateway.host, requestProfile: captureGroupRequests(request).request }
  }
})
import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import { attemptCanonicalGroupSend, prepareCanonicalGroupSend, readCanonicalGroupSend } from './canonical-group-send'
import { CanonicalGroupWorkspace } from './canonical-group-workspace'
import {
  canonicalGroupComposerDraftKey,
  clearGroupComposerDrafts,
  groupComposerDraftSnapshot,
  updateGroupComposerDraft
} from './group-panes'

const originalDesktop = window.hermesDesktop
beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, writable: true, value: undefined })
})
afterEach(() => {
  cleanup()
  clearGroupComposerDrafts()
  vi.useRealTimers()
  request.mockReset()
  respondModels.mockReset()
  localStorage.clear()
  window.hermesDesktop = originalDesktop
  vi.unstubAllGlobals()
})

// What gateway/session_group_controls.py answers for groups.send.
const receipt = (params: { event_id?: string }) => ({
  event: {},
  client_event_id: params.event_id,
  accepted: true,
  driver_started: true
})

// Send outcomes. Seams: `host.requestProfile` is the gateway transport; `window.hermesDesktop.preparedSubmissions`
// is the native journal's IPC (an in-memory compare-and-set owner here), or absent for the browser-storage
// journal. A refusal carries `admitted: false` only when the gateway refused before the user event committed
// (HostedRoomService.send).
const refusal = (reason: string, admitted?: false) =>
  Object.assign(new Error(reason), { code: 4001, data: { reason, ...(admitted === false ? { admitted } : {}) } })

const frame = (message: string, code: number, data?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, data })

const MAYBE = 'This message may already have been sent. Retry sends the same message; it will not be posted twice.'
const REFUSED = 'The gateway refused this message. Edit it and send again.'

const FINISHED_ELSEWHERE =
  'Another Desktop window already finished with this message. Check the conversation before sending it again.'

function room(sendReply: (params: Record<string, unknown>, attempt: number) => unknown) {
  let attempt = 0
  request.mockImplementation(async (_route, method, params) => {
    if (method === 'groups.state') {
      return { room: { name: 'Room' }, driver_status: { working: true } }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    if (method === 'groups.stop') {
      return { cancelled: 0 }
    }

    return method === 'groups.send' ? sendReply(params, ++attempt) : {}
  })
}

/** The native journal owner: one atomic compare-and-set per call, as electron/prepared-submissions.ts. */
function nativeJournal(beforeMutation?: (call: number, entry: string | null) => Promise<void> | void) {
  const journal: Record<string, unknown> = {}
  let calls = 0
  window.hermesDesktop = {
    preparedSubmissions: {
      read: async () => JSON.stringify(journal),
      compareAndSet: async (key: string, expected: string | null, entry: string | null) => {
        await beforeMutation?.(++calls, entry)
        const current = Object.hasOwn(journal, key) ? JSON.stringify(journal[key]) : null

        if (current !== (expected === null ? null : JSON.stringify(JSON.parse(expected)))) {
          return { applied: false, current }
        }

        if (entry === null) {
          delete journal[key]
        } else {
          journal[key] = JSON.parse(entry)
        }

        return { applied: true, current: entry }
      }
    }
  } as unknown as typeof window.hermesDesktop

  return journal
}

const sentIds = () =>
  request.mock.calls.filter(call => call[1] === 'groups.send').map(call => call[2].event_id as string)

const editor = (scope: HTMLElement) => within(scope).getByRole('textbox') as HTMLTextAreaElement

async function openRoom(binding: { connectionId: string; profile: string; roomId: string }) {
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  await within(view.container).findByText('Room')

  return view.container
}

async function typeAndSend(scope: HTMLElement, text: string) {
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  fireEvent.change(editor(scope), { target: { value: text } })
  fireEvent.click(within(scope).getByRole('button', { name: 'Send' }))
}

// AM1: a valid receipt is delivered even when its journal cleanup fails, and that intent is never
// reused for a new message.
it('treats a receipt whose journal cleanup failed as delivered, and sends a new identical message under its own identity', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  let failedOnce = false

  const journal = nativeJournal((_call, entry) => {
    if (entry === null && !failedOnce) {
      failedOnce = true

      throw new Error('EIO: journal unavailable')
    }
  })

  room(params => receipt(params))
  const scope = await openRoom({ connectionId: 'local', profile: 'team', roomId: 'cleanup-retry' })
  await typeAndSend(scope, 'Continue')
  await waitFor(() => expect(editor(scope).value).toBe(''))
  expect(within(scope).queryByRole('alert')).toBeNull()
  expect(warn).toHaveBeenCalled()
  await typeAndSend(scope, 'Continue')
  await waitFor(() => expect(sentIds()).toHaveLength(2))
  expect(new Set(sentIds()).size).toBe(2)
  await waitFor(() => expect(Object.keys(journal)).toHaveLength(0))
  warn.mockRestore()
})

// AM2: a refused first request proves nothing once another window has dispatched the same intent,
// also for a window opened after the refused one closed.
it("keeps the identity while another window's request of the intent may have posted, also after the refused window closed", async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'closed-dispatcher' }
  let refuseA!: () => void

  room((_params, attempt) =>
    attempt === 1
      ? new Promise((_resolve, reject) => {
          refuseA = () => reject(refusal('permission_denied', false))
        })
      : attempt === 2
        ? Promise.reject(new Error('request timed out: groups.send'))
        : Promise.reject(refusal('invalid_params', false))
  )
  const a = render(<CanonicalGroupWorkspace binding={binding} />)
  await within(a.container).findByText('Room')
  await typeAndSend(a.container, 'Please do this once')
  await waitFor(() => expect(sentIds()).toHaveLength(1))
  const b = await openRoom(binding)
  fireEvent.click(await within(b).findByRole('button', { name: 'Retry' }))
  await within(b).findByText('request timed out: groups.send')
  const before = JSON.stringify(await readCanonicalGroupSend(binding))
  a.unmount()
  refuseA()
  // The closed window still settles its refusal in the journal.
  await waitFor(async () => expect(JSON.stringify(await readCanonicalGroupSend(binding))).not.toBe(before))

  const c = await openRoom(binding)
  const retry = (await within(c).findByRole('button', { name: 'Retry' })) as HTMLButtonElement
  await waitFor(() => expect(retry.disabled).toBe(false))
  fireEvent.click(retry)
  await waitFor(() => expect(sentIds()).toHaveLength(3))
  await within(c).findByText(MAYBE)
  expect(editor(c).disabled).toBe(true)
  expect(new Set(sentIds()).size).toBe(1)
  expect((await readCanonicalGroupSend(binding))?.params.event_id).toBe(sentIds()[0])
})

// AM3: a refused intent's words stay durable until the user replaces them with a new Send.
it("hands a refused converged intent back for editing without losing either window's words", async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'converged-refusal' }
  room((params, attempt) => (attempt === 1 ? Promise.reject(refusal('invalid_params', false)) : receipt(params)))
  const scope = await openRoom(binding)
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  const other = await prepareCanonicalGroupSend(binding, { text: 'Too long for the gateway', attachments: [] })
  await typeAndSend(scope, 'My own words')
  await within(scope).findByText(REFUSED)
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('Too long for the gateway')
  expect((await readCanonicalGroupSend(binding))?.params.payload.text).toBe('Too long for the gateway')

  fireEvent.change(editor(scope), { target: { value: 'Shorter' } })
  fireEvent.click(within(scope).getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(editor(scope).value).toBe('My own words'))
  const sends = request.mock.calls.filter(call => call[1] === 'groups.send').map(call => call[2])
  expect(sends.map(sent => sent.payload.text)).toEqual(['Too long for the gateway', 'Shorter'])
  expect(sends[0].event_id).toBe(other.params.event_id)
  expect(sends[1].event_id).not.toBe(other.params.event_id)
  expect(await readCanonicalGroupSend(binding)).toBeUndefined()
})

// AM3: another window retrying the refused intent before this window's edit is saved keeps both
// this window's held words and its edit.
it("keeps this window's held words when another window retries the refused intent it is editing", async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'converged-retry' }
  room((params, attempt) => (attempt === 1 ? Promise.reject(refusal('invalid_params', false)) : receipt(params)))
  const scope = await openRoom(binding)
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  const other = await prepareCanonicalGroupSend(binding, { text: 'Too long for the gateway', attachments: [] })
  await typeAndSend(scope, 'My own words')
  await within(scope).findByText(REFUSED)
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  // The other window sends its intent again before this window saves an edit.
  expect(await attemptCanonicalGroupSend(binding, other.params.event_id)).toBe(1)

  fireEvent.change(editor(scope), { target: { value: 'Shorter' } })
  fireEvent.click(within(scope).getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(sentIds()).toHaveLength(2))
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(new Set(sentIds())).toEqual(new Set([other.params.event_id]))
  expect(editor(scope).value).toBe('My own words\n\nShorter')
})

// AM3: also when its room closed before the refusal arrived.
it('keeps a first Send refused after its room closed for the next open, as an editable draft', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'closed-mid-send' }
  let refuse!: () => void
  room((_params, attempt) =>
    attempt === 1
      ? new Promise((_resolve, reject) => {
          refuse = () => reject(refusal('invalid_params', false))
        })
      : Promise.reject(refusal('invalid_params', false))
  )
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  await within(view.container).findByText('Room')
  await typeAndSend(view.container, 'Typed before closing')
  await waitFor(() => expect(sentIds()).toHaveLength(1))
  view.unmount()
  refuse()
  await waitFor(async () => expect((await readCanonicalGroupSend(binding))?.attempts).toBe(0))

  const scope = await openRoom(binding)
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('Typed before closing')
  expect(within(scope).queryByRole('button', { name: 'Retry' })).toBeNull()
  expect(within(scope).queryByText(/unconfirmed send was restored/)).toBeNull()
  // Sending the draft replaces the handed-back intent rather than resending it.
  fireEvent.click(within(scope).getByRole('button', { name: 'Send' }))
  await within(scope).findByText(REFUSED)
  expect(new Set(sentIds()).size).toBe(2)
  expect((await readCanonicalGroupSend(binding))?.attempts).toBe(0)
})

// Both surfaces Desktop dials: the session gateway (4001 + reason) and `hermes serve`
// (tui_gateway/methods_groups.py: 4111 room errors, 4123 no worker, 5112 anything else).
it.each([
  ['the gateway refuses the payload', refusal('invalid_params', false)],
  ['hermes serve finds the room ended', frame('hosted room not found', 4111, { admitted: false })],
  ['hermes serve has no Group Chat worker', frame('Group Chat worker is unavailable.', 4123, { admitted: false })],
  ['hermes serve refuses the payload', frame('user payload text must be a bounded string', 5112, { admitted: false })]
])('hands the words back for editing when %s before admitting the Send', async (_case, refused) => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'refused-before-admission' }
  room((params, attempt) => (attempt === 1 ? Promise.reject(refused) : receipt(params)))
  const scope = await openRoom(binding)
  await typeAndSend(scope, 'Ended elsewhere')
  await within(scope).findByText(REFUSED)
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('Ended elsewhere')
  // The hint explains the refusal; the raw reason never shows as a second, unexplained error.
  expect(within(scope).queryByText(refused.message)).toBeNull()
  expect(within(scope).getByRole('button', { name: 'Send' })).toBeTruthy()
  // The words stay journaled until a new Send replaces them.
  expect(await readCanonicalGroupSend(binding)).toMatchObject({
    attempts: 0,
    params: { payload: { text: 'Ended elsewhere' } }
  })
})

// AM4: the same reasons and codes also follow a committed user event, without `admitted: false`.
it('explains a model preparation failure beside the retained draft instead of blaming the gateway', async () => {
  const hint = 'The selected model is unavailable. Choose an available model and send again.'
  const failure = Object.assign(new Error(hint), {
    code: 'model_unavailable',
    data: { admitted: false, preparation_message: hint }
  })
  const binding = { connectionId: 'local', profile: 'team', roomId: 'model-not-ready' }
  room((params, attempt) => (attempt === 1 ? Promise.reject(failure) : receipt(params)))
  const scope = await openRoom(binding)
  await typeAndSend(scope, 'Keep my question')

  await within(scope).findByText(hint)
  expect(within(scope).queryByText(REFUSED)).toBeNull()
  expect(editor(scope).value).toBe('Keep my question')
  expect(await readCanonicalGroupSend(binding)).toMatchObject({ attempts: 0 })
  fireEvent.click(within(scope).getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(sentIds()).toHaveLength(2))
  await waitFor(() => expect(editor(scope).value).toBe(''))
})

it.each([
  ['an invalid_params from the gateway', refusal('invalid_params')],
  ['a room error from hermes serve', frame('hosted room not found', 4111)],
  ['a failure from hermes serve', frame('storage is full', 5112)]
])('keeps the identity of a first Send after %s that does not prove nothing was admitted', async (_case, failed) => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'post-commit' }
  room((params, attempt) => (attempt === 1 ? Promise.reject(failed) : receipt(params)))
  const scope = await openRoom(binding)
  await typeAndSend(scope, 'Second')
  await within(scope).findByText(MAYBE)
  expect(editor(scope).disabled).toBe(true)
  expect(editor(scope).value).toBe('Second')
  const retry = within(scope).getByRole('button', { name: 'Retry' }) as HTMLButtonElement
  await waitFor(() => expect(retry.disabled).toBe(false))
  fireEvent.click(retry)
  await waitFor(() => expect(sentIds()).toHaveLength(2))
  expect(new Set(sentIds()).size).toBe(1)
})

it.each([
  [
    'names another intent',
    (params: Record<string, unknown>) => ({ accepted: true, client_event_id: `${params.event_id}-other` })
  ],
  ['is not accepted', (params: Record<string, unknown>) => ({ accepted: false, client_event_id: params.event_id })],
  ['is empty', () => undefined]
])('does not treat a reply that %s as delivered', async (_case, reply) => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'malformed' }
  room(reply)
  const scope = await openRoom(binding)
  await typeAndSend(scope, 'Needs a real receipt')
  await within(scope).findByText(MAYBE)
  expect(editor(scope).value).toBe('Needs a real receipt')
  expect((await readCanonicalGroupSend(binding))?.params.payload.text).toBe('Needs a real receipt')
})

// AM6: Stop covers a Send already initiated when it was pressed.
it('does not dispatch a Send still preparing when Stop is pressed, and keeps its words', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'stop-while-preparing' }
  let entered!: () => void
  let release!: () => void

  const preparing = new Promise<void>(resolve => {
    entered = resolve
  })

  const gate = new Promise<void>(resolve => {
    release = resolve
  })

  nativeJournal(async call => {
    if (call === 1) {
      entered()
      await gate
    }
  })
  room(params => receipt(params))
  const scope = await openRoom(binding)
  await typeAndSend(scope, 'Long task')
  await preparing
  const stop = within(scope).getByRole('button', { name: 'Stop this round' }) as HTMLButtonElement
  expect(stop.disabled).toBe(false)
  fireEvent.click(stop)
  await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.stop')).toBe(true))
  release()
  await within(scope).findByText('Stopped before sending. Your message is still here.')
  await within(scope).findByText(CANONICAL_GROUP_LOCALES.en.stopped)
  // Nothing was sent, so the first fence covers it: no second Stop.
  expect(request.mock.calls.filter(call => call[1] === 'groups.stop')).toHaveLength(1)
  expect(sentIds()).toEqual([])
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('Long task')
  expect((await readCanonicalGroupSend(binding))?.params.payload.text).toBe('Long task')

  fireEvent.click(within(scope).getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(sentIds()).toHaveLength(1))
  await waitFor(() => expect(editor(scope).value).toBe(''))
})

it('fences no second time behind a Send the gateway refused before admitting it', async () => {
  let refuse!: () => void
  room(
    () =>
      new Promise((_resolve, reject) => {
        refuse = () => reject(refusal('invalid_params', false))
      })
  )
  const scope = await openRoom({ connectionId: 'local', profile: 'team', roomId: 'stop-refused' })
  await typeAndSend(scope, 'Never admitted')
  await waitFor(() => expect(sentIds()).toHaveLength(1))
  fireEvent.click(within(scope).getByRole('button', { name: 'Stop this round' }))
  await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.stop')).toBe(true))
  refuse()
  await within(scope).findByText(CANONICAL_GROUP_LOCALES.en.stopped)
  expect(request.mock.calls.filter(call => call[1] === 'groups.stop')).toHaveLength(1)
})

it('never resends an intent another window already finished with', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'finished-elsewhere' }
  await prepareCanonicalGroupSend(binding, { text: 'From before a reload', attachments: [] })
  room(params => receipt(params))
  const scope = await openRoom(binding)
  const retry = (await within(scope).findByRole('button', { name: 'Retry' })) as HTMLButtonElement
  await waitFor(() => expect(retry.disabled).toBe(false))
  localStorage.clear() // the other window received its receipt and retired the slot
  fireEvent.click(retry)
  await within(scope).findByText(FINISHED_ELSEWHERE)
  expect(sentIds()).toEqual([])
  // Its words are not offered again as a new message: that could post them twice.
  expect(editor(scope).value).toBe('')
})

it('does not resend words handed back for editing once another window finished with their intent', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'edited-elsewhere' }
  room((params, attempt) => (attempt === 1 ? Promise.reject(refusal('invalid_params', false)) : receipt(params)))
  const scope = await openRoom(binding)
  await typeAndSend(scope, 'Handed back')
  await within(scope).findByText(REFUSED)
  localStorage.clear() // another window sent the intent again and retired it on its receipt
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  fireEvent.click(within(scope).getByRole('button', { name: 'Send' }))
  await within(scope).findByText(FINISHED_ELSEWHERE)
  expect(sentIds()).toHaveLength(1)
  expect(editor(scope).value).toBe('Handed back')
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  fireEvent.click(within(scope).getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(sentIds()).toHaveLength(2))
  expect(new Set(sentIds()).size).toBe(2)
})

it('offers a read-only retry when the Send journal cannot be read, then restores its pending intent', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'unreadable' }
  const entry = await prepareCanonicalGroupSend(binding, { text: 'Saved before the failure', attachments: [] })
  const saved = localStorage.getItem('hermes.desktop.canonicalGroupSends.v1')!
  const compareAndSet = vi.fn()
  const read = vi.fn().mockRejectedValueOnce(new Error('EACCES: journal unreadable')).mockResolvedValue(saved)
  window.hermesDesktop = { preparedSubmissions: { read, compareAndSet } } as unknown as typeof window.hermesDesktop
  room(params => receipt(params))
  render(<CanonicalGroupWorkspace binding={binding} />)
  await screen.findByText(/Saved messages couldn’t be loaded/)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Try loading again' }))
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(entry.params.payload.text)
  )
  expect(screen.queryByText(/Saved messages couldn’t be loaded/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  expect(compareAndSet).not.toHaveBeenCalled()
})

it('names the Bot behind each pending action and shows what an approval would allow before offering it', async () => {
  const members = [
    { member_id: 'ops', profile: 'ops', handle: 'ops', display_name: 'Ops Bot' },
    { member_id: 'qa', profile: 'qa', handle: 'qa', display_name: 'QA Bot' },
    { member_id: 'guard', profile: 'guard', handle: 'guard', display_name: 'Guard Bot' }
  ]

  const actions = [
    {
      kind: 'approval',
      member_id: 'ops',
      task_id: 'clean',
      execution_generation: 3,
      request_id: 'r-clean',
      approval: {
        request_id: 'r-clean',
        command: 'rm -rf build',
        description: 'Clear the build folder',
        choices: ['once', 'deny']
      }
    },
    {
      kind: 'approval',
      member_id: 'qa',
      task_id: 'vague',
      execution_generation: 1,
      request_id: 'r-vague',
      approval: { description: 'Use a tool', choices: ['once', 'deny'] }
    },
    // A plugin `approve` rule (tools/approval.py request_tool_approval): a tool label and the plugin's words.
    {
      kind: 'approval',
      member_id: 'guard',
      task_id: 'pwd',
      execution_generation: 4,
      request_id: 'r-pwd',
      approval: {
        request_id: 'r-pwd',
        command: '<terminal> (plugin approval rule)',
        description: 'Approve running pwd',
        choices: ['once']
      }
    },
    { kind: 'retry', member_id: 'qa', task_id: 'late', execution_generation: 2 }
  ]

  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? { room: { name: 'Room', members }, driver_status: { pending_actions: actions } }
      : method === 'groups.log'
        ? { events: [] }
        : { approved: true }
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'approvals' }} />)

  const clean = (await screen.findByText('rm -rf build')).closest('[data-task-id]') as HTMLElement
  expect(within(clean).getByText('Ops Bot is asking for approval. You decide.')).toBeTruthy()
  expect(within(clean).getByText('Clear the build folder')).toBeTruthy()
  const vague = screen.getByText('QA Bot is asking for approval. You decide.').closest('[data-task-id]') as HTMLElement
  expect(within(vague).getByText('Action details are unavailable. Check again before allowing this.')).toBeTruthy()
  expect(within(vague).queryByRole('button', { name: 'Allow once' })).toBeNull()
  expect(within(vague).getByRole('button', { name: 'Deny' })).toBeTruthy()
  expect(screen.getByText('QA Bot’s turn has not finished. Retry it?')).toBeTruthy()
  expect(screen.queryByText('ops')).toBeNull()

  // As in the chat approval card, the plugin's words stand in for its tool label.
  const guarded = screen
    .getByText('Guard Bot is asking for approval. You decide.')
    .closest('[data-task-id]') as HTMLElement

  expect(within(guarded).getByText('Approve running pwd')).toBeTruthy()
  expect(within(guarded).queryByText(/plugin approval rule/)).toBeNull()
  expect(within(guarded).queryByText('Action details are unavailable. Check again before allowing this.')).toBeNull()
  // Only the choices the gateway offered.
  expect(within(guarded).queryByRole('button', { name: 'Deny' })).toBeNull()

  for (const [index, card, member, task, generation, requestId] of [
    [1, clean, 'ops', 'clean', 3, 'r-clean'],
    [2, guarded, 'guard', 'pwd', 4, 'r-pwd']
  ] as const) {
    const allow = within(card).getByRole('button', { name: 'Allow once' }) as HTMLButtonElement
    await waitFor(() => expect(allow.disabled).toBe(false))
    fireEvent.click(allow)
    await waitFor(() => expect(request.mock.calls.filter(call => call[1] === 'groups.approve')).toHaveLength(index))
    expect(request.mock.calls.filter(call => call[1] === 'groups.approve')[index - 1][2]).toEqual({
      room_id: 'approvals',
      member_id: member,
      task_id: task,
      execution_generation: generation,
      request_id: requestId,
      choice: 'once',
      profile: 'team'
    })
  }
})

const ABANDON = 'Abandon retry'
const ABANDON_CHANGED = 'This pending message changed. Close this dialog and review it before trying again.'

async function abandonDialog(scope: HTMLElement) {
  fireEvent.click(await within(scope).findByRole('button', { name: ABANDON }))

  return screen.findByRole('dialog', { name: ABANDON })
}

it('requires confirmation to abandon a legacy send and never returns its uncertain words as a new draft', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'abandon-legacy' }
  const journal = nativeJournal()
  room(receipt)
  const prepared = await prepareCanonicalGroupSend(binding, { text: 'Uncertain legacy message' })
  const legacy = { binding: prepared.binding, params: prepared.params }
  journal[Object.keys(journal)[0]] = legacy
  const key = canonicalGroupComposerDraftKey(binding)
  updateGroupComposerDraft(key, draft => ({ ...draft, main: 'Uncertain legacy message' }))
  const scope = await openRoom(binding)
  let dialog = await abandonDialog(scope)
  expect(within(dialog).getByText(/may already have been posted or may arrive later/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await readCanonicalGroupSend(binding)).toEqual(legacy)
  expect(editor(scope).disabled).toBe(true)
  expect(editor(scope).value).toBe('Uncertain legacy message')
  dialog = await abandonDialog(scope)
  fireEvent.click(within(dialog).getByRole('button', { name: ABANDON }))
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('')
  expect(groupComposerDraftSnapshot(key).main).toBe('')
  expect(await readCanonicalGroupSend(binding)).toBeUndefined()
  expect(sentIds()).toEqual([])
})

it.each(['attempts', 'payload', 'event_id', 'binding'] as const)(
  'rejects abandonment when the confirmed %s changes, including repeated confirmation',
  async change => {
    const binding = { connectionId: 'local', profile: 'team', roomId: `abandon-race-${change}` }
    const journal = nativeJournal()
    room(receipt)
    const prepared = await prepareCanonicalGroupSend(binding, { text: 'Keep uncertain words' })
    const scope = await openRoom(binding)
    const dialog = await abandonDialog(scope)
    const changed = JSON.parse(JSON.stringify(prepared))

    if (change === 'attempts') {
      changed.attempts++
    }

    if (change === 'payload') {
      changed.params.payload.text = 'Different payload'
    }

    if (change === 'event_id') {
      changed.params.event_id = 'replacement'
    }

    if (change === 'binding') {
      changed.binding.profile = 'other-owner'
    }

    journal[Object.keys(journal)[0]] = changed
    fireEvent.click(within(dialog).getByRole('button', { name: ABANDON }))
    await within(dialog).findByText(ABANDON_CHANGED)
    expect(Object.values(journal)).toEqual([changed])
    fireEvent.click(within(dialog).getByRole('button', { name: ABANDON }))
    await waitFor(() =>
      expect((within(dialog).getByRole('button', { name: ABANDON }) as HTMLButtonElement).disabled).toBe(false)
    )
    expect(Object.values(journal)).toEqual([changed])
    expect((within(scope).getByRole('textbox', { hidden: true }) as HTMLTextAreaElement).disabled).toBe(true)
    expect(sentIds()).toEqual([])
  }
)

it('uses one atomic snapshot comparison if another window retries while abandonment reaches the journal owner', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'abandon-atomic-race' }
  let deletes = 0

  const journal = nativeJournal((_call, entry) => {
    if (entry === null) {
      deletes++
      const current = Object.values(journal)[0] as { attempts: number }
      current.attempts++
    }
  })

  room(receipt)
  await prepareCanonicalGroupSend(binding, { text: 'Concurrent retry' })
  const scope = await openRoom(binding)
  const dialog = await abandonDialog(scope)
  fireEvent.click(within(dialog).getByRole('button', { name: ABANDON }))
  await within(dialog).findByText(ABANDON_CHANGED)
  expect(deletes).toBe(1)
  expect((await readCanonicalGroupSend(binding))?.attempts).toBe(1)
  expect(sentIds()).toEqual([])
})

it.each(['room', 'account'] as const)('invalidates an open abandon confirmation when the %s changes', async change => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'abandon-owner' }
  nativeJournal()
  room(receipt)
  const prepared = await prepareCanonicalGroupSend(binding, { text: 'Belongs to old owner' })
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  const dialog = await abandonDialog(view.container)
  const confirm = within(dialog).getByRole('button', { name: ABANDON })

  if (change === 'room') {
    view.rerender(<CanonicalGroupWorkspace binding={{ ...binding, roomId: 'other' }} />)
  } else {
    act(() => clearGroupComposerDrafts())
  }

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(confirm)
  expect(await readCanonicalGroupSend(binding)).toEqual(prepared)
  expect(sentIds()).toEqual([])
})

it('preserves held words when abandoning the uncertain send from another window', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'abandon-held' }
  nativeJournal()
  room(() => Promise.reject(new Error('lost ACK')))
  const scope = await openRoom(binding)
  await prepareCanonicalGroupSend(binding, { text: 'Other window uncertain words' })
  await typeAndSend(scope, 'My own words')
  await within(scope).findByText('lost ACK')
  const dialog = await abandonDialog(scope)
  fireEvent.click(within(dialog).getByRole('button', { name: ABANDON }))
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('My own words')
  expect(sentIds()).toHaveLength(1)
  expect(await readCanonicalGroupSend(binding)).toBeUndefined()
})

it('preserves a newer local draft written while the abandon confirmation is open', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'abandon-newer-draft' }
  room(() => Promise.reject(new Error('lost ACK')))
  const scope = await openRoom(binding)
  await typeAndSend(scope, 'Uncertain words')
  await within(scope).findByText('lost ACK')
  const dialog = await abandonDialog(scope)
  const key = canonicalGroupComposerDraftKey(binding)
  updateGroupComposerDraft(key, draft => ({ ...draft, main: 'Newer words from another pane' }))
  fireEvent.click(within(dialog).getByRole('button', { name: ABANDON }))
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('Newer words from another pane')
  expect(sentIds()).toHaveLength(1)
  expect(await readCanonicalGroupSend(binding)).toBeUndefined()
})

it('preserves a separate same-text draft replying to another thread when abandoning a restored send', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'abandon-other-reply' }
  room(receipt)
  await prepareCanonicalGroupSend(binding, { text: 'Thanks', thread_id: 'old-thread' })
  const key = canonicalGroupComposerDraftKey(binding)
  const reply = { name: 'New recipient', quote: 'New discussion', thread: 'new-thread' }
  updateGroupComposerDraft(key, draft => ({ ...draft, main: 'Thanks', canonicalReply: reply }))
  const scope = await openRoom(binding)
  const dialog = await abandonDialog(scope)
  fireEvent.click(within(dialog).getByRole('button', { name: ABANDON }))
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('Thanks')
  expect(groupComposerDraftSnapshot(key).canonicalReply).toEqual(reply)
  expect(sentIds()).toEqual([])
})

it('keeps held and current same-text drafts when they target different reply threads', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'abandon-held-replies' }
  room(receipt)
  await prepareCanonicalGroupSend(binding, { text: 'Uncertain message' })
  const key = canonicalGroupComposerDraftKey(binding)
  const heldReply = { name: 'Held recipient', quote: 'Held discussion', thread: 'held-thread' }
  updateGroupComposerDraft(key, draft => ({
    ...draft,
    main: 'Thanks',
    canonicalReply: { name: 'Current recipient', quote: 'Current discussion', thread: 'current-thread' },
    canonicalHeld: { text: 'Thanks', attachments: [], reply: heldReply }
  }))
  const scope = await openRoom(binding)
  const dialog = await abandonDialog(scope)
  fireEvent.click(within(dialog).getByRole('button', { name: ABANDON }))
  await waitFor(() => expect(editor(scope).disabled).toBe(false))
  expect(editor(scope).value).toBe('Thanks\n\nThanks')
  expect(groupComposerDraftSnapshot(key).canonicalReply).toEqual(heldReply)
  expect(sentIds()).toEqual([])
})

it('jumps from the approval count to the waiting card without answering it', async () => {
  const approval = {
    kind: 'approval',
    member_id: 'ops',
    task_id: 'approval-jump',
    execution_generation: 1,
    approval: { command: 'make release', choices: ['once', 'deny'] }
  }

  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? { room: { name: 'Team' }, driver_status: { pending_actions: [approval] } }
      : method === 'groups.log'
        ? { events: [] }
        : {}
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'approval-jump' }} />)
  const jump = await screen.findByRole('button', { name: '1 waiting for approval' })
  const card = screen.getByText('make release').closest<HTMLElement>('[data-pending-action]')!
  card.scrollIntoView = vi.fn()
  fireEvent.click(jump)
  expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  expect(window.document.activeElement).toBe(card)
  expect(request.mock.calls.some(call => call[1] === 'groups.approve')).toBe(false)
})

it('clears the stop notice only once the gateway reports no work still stopping', async () => {
  let working = true
  let stopping = 1
  request.mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      return { room: { name: 'Team' }, driver_status: { working, counts: { stopping } } }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    if (method === 'groups.stop') {
      working = false

      return { cancelled: 1 }
    }

    return {}
  })
  const binding = { connectionId: 'local', profile: 'team', roomId: 'settled-stop' }
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Stop this round' }))
  await screen.findByText(CANONICAL_GROUP_LOCALES.en.stopped)
  stopping = 0
  // Resuming the retained pane triggers the next authoritative read immediately.
  view.rerender(<CanonicalGroupWorkspace binding={binding} visible={false} />)
  view.rerender(<CanonicalGroupWorkspace binding={binding} visible />)
  await waitFor(() => expect(screen.queryByText(CANONICAL_GROUP_LOCALES.en.stopped)).toBeNull())
})
