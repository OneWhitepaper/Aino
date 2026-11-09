import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const gateway = createGroupGateway()
  const { en } = await import('@/i18n/en')
  const { CANONICAL_GROUP_LOCALES } = await import('./canonical-group-locales')

  return {
    ...(await pluginSdkMock(gateway.host)),
    atom,
    useValue: useStore,
    useI18n: () => ({ t: en }),
    usePluginI18n: () => (key: string) =>
      CANONICAL_GROUP_LOCALES.en[key.replace('canonical.', '') as keyof typeof CANONICAL_GROUP_LOCALES.en] ?? key,
    Button: (p: ComponentProps<'button'>) => <button {...p} />,
    host: { ...gateway.host, requestProfile: request }
  }
})

import { prepareCanonicalGroupSend, readCanonicalGroupSend } from './canonical-group-send'
import { CanonicalGroupWorkspace } from './canonical-group-workspace'
import type { CanonicalGroupBinding } from './canonical-groups'
import { clearGroupComposerDrafts } from './group-panes'

const originalDesktop = window.hermesDesktop
const input = () => screen.getByRole('textbox', { name: 'Group message' }) as HTMLTextAreaElement
const ready = () => waitFor(() => expect(input().disabled).toBe(false))

beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, writable: true, value: undefined })
  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? { room: { name: 'Team', members: [] }, driver_status: {} }
      : method === 'groups.log'
        ? { events: [] }
        : method === 'groups.attachment.upload'
          ? { attachment_id: 'plan-upload', kind: 'file', name: 'plan.txt', mime: 'text/plain', size: 4 }
          : {}
  )
})

afterEach(() => {
  cleanup()
  clearGroupComposerDrafts()
  request.mockReset()
  localStorage.clear()
  window.hermesDesktop = originalDesktop
})

it('keeps the room text and uploaded attachment when its workspace remounts after a mode switch', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'mode-switch', roomName: 'Team' }
  const first = render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  fireEvent.change(input(), { target: { value: '布局验收草稿（不发送）' } })
  fireEvent.change(first.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['plan'], 'plan.txt', { type: 'text/plain' })] }
  })
  await screen.findByText('plan.txt')
  first.unmount()

  render(<CanonicalGroupWorkspace binding={{ ...binding, roomName: 'Renamed team' }} />)
  await ready()
  expect(input().value).toBe('布局验收草稿（不发送）')
  expect(screen.getByText('plan.txt')).toBeTruthy()
  expect(request.mock.calls.some(call => call[1] === 'groups.send')).toBe(false)
})

it('isolates drafts by exact connection, profile and immutable room id', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'isolation', roomName: 'Team' }
  let view = render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  fireEvent.change(input(), { target: { value: 'Original room draft' } })
  view.unmount()

  for (const other of [
    { ...binding, connectionId: 'remote' },
    { ...binding, profile: 'other' },
    { ...binding, roomId: 'another' }
  ] satisfies CanonicalGroupBinding[]) {
    view = render(<CanonicalGroupWorkspace binding={other} />)
    await ready()
    expect(input().value).toBe('')
    fireEvent.change(input(), {
      target: { value: `Other draft ${other.connectionId}/${other.profile}/${other.roomId}` }
    })
    view.unmount()
  }

  view = render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  expect(input().value).toBe('Original room draft')
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(input().value).toBe(''))
  view.unmount()

  render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  expect(input().value).toBe('')
})

it('clears the sent draft after its ACK arrives while the workspace is unmounted', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'parked-send' }
  let acknowledge!: () => void
  const gateway = request.getMockImplementation()!
  request.mockImplementation((route, method, params) =>
    method === 'groups.send'
      ? new Promise<void>(resolve => {
          acknowledge = resolve
        })
      : gateway(route, method, params)
  )
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  fireEvent.change(input(), { target: { value: 'Send this once' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(acknowledge).toBeTypeOf('function'))
  view.unmount()
  await act(async () => acknowledge())
  await waitFor(async () => expect(await readCanonicalGroupSend(binding)).toBeUndefined())

  render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  expect(input().value).toBe('')
})

it("keeps this window's words across remount while retrying another window's exact pending send", async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'competing-send' }
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  fireEvent.change(input(), { target: { value: 'Private draft in this window' } })
  await prepareCanonicalGroupSend(binding, { text: 'Other window event', attachments: [] })
  const gateway = request.getMockImplementation()!
  request.mockImplementation((route, method, params) =>
    method === 'groups.send' ? Promise.reject(new Error('ACK unavailable')) : gateway(route, method, params)
  )
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('ACK unavailable')
  view.unmount()

  render(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect(input().value).toBe('Other window event'))
  request.mockImplementation(gateway)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await ready()
  expect(input().value).toBe('Private draft in this window')
})

it('retires mounted and parked group drafts together at the existing account boundary', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'account-draft' }
  render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  fireEvent.change(input(), { target: { value: 'Previous account words' } })

  act(() => clearGroupComposerDrafts())
  await ready()
  expect(input().value).toBe('')
  cleanup()
  render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  expect(input().value).toBe('')
})

it('ignores an old upload acknowledgement after the room was remounted and its new draft sent', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'late-upload' }
  let finishUpload!: (attachment: { attachment_id: string; kind: string; name: string; mime: string }) => void
  const gateway = request.getMockImplementation()!
  request.mockImplementation((route, method, params) =>
    method === 'groups.attachment.upload'
      ? new Promise(resolve => {
          finishUpload = resolve
        })
      : gateway(route, method, params)
  )
  let view = render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['old'], 'late.txt', { type: 'text/plain' })] }
  })
  await waitFor(() => expect(finishUpload).toBeTypeOf('function'))
  view.unmount()

  view = render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  fireEvent.change(input(), { target: { value: 'New text after returning' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(input().value).toBe(''))
  await act(async () =>
    finishUpload({ attachment_id: 'late-upload', kind: 'file', name: 'late.txt', mime: 'text/plain' })
  )
  view.unmount()

  render(<CanonicalGroupWorkspace binding={binding} />)
  await ready()
  expect(input().value).toBe('')
  expect(screen.queryByText('late.txt')).toBeNull()
})
