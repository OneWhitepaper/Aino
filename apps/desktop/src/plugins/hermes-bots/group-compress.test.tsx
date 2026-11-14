import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createGroupGateway } from './group-test-utils'
import type { ScriptedGateway } from './group-test-utils'
import { translateBots } from './i18n-test-helper'

// #102291: room member sessions are hidden plumbing nothing else can compress.
// The room settings dialog owns a per-member "Compress history" that resumes
// every session the room holds for that member and runs session.compress on
// the LIVE runtime id — never minting a new session as a side effect.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))
const state = { gateway: null as null | ScriptedGateway }

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')
  const base = await pluginSdkMock(host)
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>

  return {
    ...base,
    Button: base.Button,
    RowButton: base.RowButton,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: () => null,
    CopyButton: () => null,
    ToggleRow: () => null,
    ConfirmDialog: () => null,
    Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
    DialogContent: Passthrough,
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
    Input: () => null,
    Tip: Passthrough,
    relativeTime: () => 'now',
    useI18n: () => ({ t: { common: { cancel: 'Cancel', save: 'Save' } } }),
    usePluginI18n: () => translateBots
  }
})
vi.mock('./avatar', () => ({ avatarColor: () => '#888', botAppearance: () => ({}), BotFace: () => null }))
vi.mock('./group-chat-parts', () => ({
  GroupClarifyCard: () => null,
  GroupImageControls: () => null,
  GroupMentionInput: () => null
}))

beforeEach(() => {
  vi.resetModules()
  state.gateway = createGroupGateway()

  for (const key of Object.keys(host)) {
    delete host[key]
  }

  // The scripted gateway answers unknown methods with `{}`; give
  // session.compress the in-process gateway's real result shape.
  const inner = state.gateway.host.request as (method: string, params: Record<string, unknown>) => Promise<unknown>

  state.gateway.host.request = async (method: string, params: Record<string, unknown> = {}) => {
    if (method === 'session.compress') {
      state.gateway!.rpc.push({ method, params, refcountAfter: 0 })

      return { status: 'compressed', before_messages: 1588, after_messages: 134, summary: { headline: '1588 → 134' } }
    }

    return inner(method, params)
  }

  Object.assign(host, state.gateway.host)
})
afterEach(cleanup)

async function seedMemberSession(profile: string, title: string) {
  const request = state.gateway!.host.request as (method: string, params: Record<string, unknown>) => Promise<unknown>
  const created = (await request('session.create', { profile, title, hidden: true })) as { stored_session_id: string }
  state.gateway!.rpc.length = 0

  return created.stored_session_id
}

it('compressGroupMemberHistory resumes each stored session for the member and compresses the live runtime id', async () => {
  const { $groupChats } = await import('./group-chat')
  const { compressGroupMemberHistory } = await import('./group-compress')
  const mason = await seedMemberSession('mason', 'Group: room-1 · t1')
  const critic = await seedMemberSession('critic', 'Group: room-1 · t1')
  $groupChats.set({
    Build: {
      log: [],
      roomId: 'room-1',
      sessions: { 'thread:t1::mason': mason, 'thread:t1::critic': critic },
      watermarks: {}
    }
  })

  const outcome = await compressGroupMemberHistory('Build', { name: 'mason' } as never)

  expect(outcome).toMatchObject({ compressed: 1, pending: 0, skipped: 0, lines: ['1588 → 134'] })
  const methods = state.gateway!.rpc.map(call => call.method)
  expect(methods).toEqual(['session.resume', 'session.compress'])
  const [resume, compress] = state.gateway!.rpc
  expect(resume.params).toMatchObject({ session_id: mason, profile: 'mason', omit_messages: true })
  // The compress targets the runtime id the resume minted, not the stored id.
  expect(compress.params.session_id).toBe(state.gateway!.sessions.get(mason)!.runtime)
  expect(compress.params.session_id).not.toBe(mason)
  expect(methods).not.toContain('session.create')
})

it('the room settings dialog offers Compress history per member and reports the result', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')
  const mason = await seedMemberSession('mason', 'Group: room-1 · t1')
  $groupChats.set({
    Build: { engine: 'desktop', log: [], roomId: 'room-1', sessions: { 'thread:t1::mason': mason }, watermarks: {} }
  })
  const members = [{ name: 'mason' }, { name: 'critic' }] as never

  const { findByRole, getByLabelText, getByRole, queryByLabelText } = render(
    <GroupChatWorkspace group="Build" members={members} />
  )

  // The same named management entrance remains the door to the retained repair.
  const groupInfo = await findByRole('button', { name: 'Group info' })
  expect(queryByLabelText('Compress history: Mason')).toBeNull()
  fireEvent.pointerDown(groupInfo, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  fireEvent.click(getByRole('menuitem', { name: 'Group settings' }))
  fireEvent.click(getByLabelText('Compress history: Mason'))

  await waitFor(() => expect(state.gateway!.rpcFor('session.compress')).toHaveLength(1))
  const notify = state.gateway!.host.notify as ReturnType<typeof vi.fn>
  await waitFor(() => expect(notify).toHaveBeenCalled())
  // Only mason's session was touched — critic never had one and none was created.
  expect(state.gateway!.rpcFor('session.create')).toHaveLength(0)
})

it('labels the per-member repair with that connection current readable name', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $botMeta } = await import('./data')
  const { $groupChats } = await import('./group-chat')
  $groupChats.set({ Repair: { engine: 'desktop', log: [], watermarks: {} } })
  const { GroupChatWorkspace } = await import('./group-chat-view')
  const profile = 'u6d4b-u8bd5'
  $botMeta.set({ [profile]: { title: '另一连接的助手' }, [`studio::${profile}`]: { title: '工作室测试助手' } })
  const members = [{ name: profile, connectionId: 'studio', sourceScoped: true, remoteSource: true }]
  const view = render(<GroupChatWorkspace group="Repair" members={members} />)
  fireEvent.pointerDown(await view.findByRole('button', { name: 'Group info' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse'
  })
  fireEvent.click(view.getByRole('menuitem', { name: 'Group settings' }))

  expect(view.getByRole('button', { name: 'Compress history: 工作室测试助手' })).toBeTruthy()
  expect(view.queryByRole('button', { name: `Compress history: ${profile}` })).toBeNull()
  expect(view.queryByRole('button', { name: 'Compress history: 另一连接的助手' })).toBeNull()
})
