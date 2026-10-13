import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'

import { PRIMARY_SESSION_VIEW, type SessionView } from '@/app/chat/session-view'
import type { HermesGateway } from '@/hermes'
import { createClientSessionState } from '@/lib/chat-runtime'
import { createComposerAttachmentScope } from '@/store/composer'
import { setPrimaryGateway } from '@/store/gateway'
import { $startWorkSessionRequest } from '@/store/projects'
import { $currentCwd, $newChatWorkspaceTarget, setNewChatWorkspaceTarget } from '@/store/session'
import { $sessionStates, publishSessionState, setSessionTileDelegate } from '@/store/session-states'

import { canSelectDraftProject, captureProjectSelection } from './project-selection'

afterEach(() => {
  setPrimaryGateway(null)
  $sessionStates.set({})
  $startWorkSessionRequest.set(null)
})

it('binds a known unsent tile in place and never mistakes a loading stored chat for a draft', async () => {
  const request = vi.fn(async () => ({ cwd: '/selected', branch: 'main' }))
  setPrimaryGateway({ connectionState: 'open', request } as unknown as HermesGateway)
  const draftState = { ...createClientSessionState('tile-stored'), isUnsentDraft: true, cwd: '/before' }
  publishSessionState('tile-runtime', draftState)

  const view: SessionView = {
    ...PRIMARY_SESSION_VIEW,
    kind: 'tile',
    $runtimeId: atom<string | null>('tile-runtime'),
    $storedId: atom<string | null>('tile-stored'),
    $busy: atom(false),
    $messages: atom([]),
    $messagesEmpty: atom(true)
  }

  setSessionTileDelegate({
    archiveSession: vi.fn(),
    branchSessionAtMessage: vi.fn(),
    branchSession: vi.fn(),
    deleteSession: vi.fn(),
    executeSlash: vi.fn(),
    interruptSession: vi.fn(),
    resumeTile: vi.fn(),
    submitToSession: vi.fn(),
    updateSession: (id, update) => {
      const next = update($sessionStates.get()[id]!)
      publishSessionState(id, next)

      return next
    }
  })
  $currentCwd.set('/foreground')
  const attachments = createComposerAttachmentScope()
  attachments.add({
    id: 'folder:src',
    kind: 'folder',
    label: 'src',
    path: '/before/src',
    detail: 'src',
    refText: '@folder:src'
  })

  expect(canSelectDraftProject(view)).toBe(true)
  await captureProjectSelection(view, attachments).select('/selected')
  expect(attachments.$attachments.get()[0]).toMatchObject({ path: '/before/src', refText: '@folder:/before/src' })
  expect($sessionStates.get()['tile-runtime'].cwd).toBe('/selected')
  expect($currentCwd.get()).toBe('/foreground')
  expect($startWorkSessionRequest.get()).toBeNull()
  expect(request).toHaveBeenCalledWith(
    'session.cwd.set',
    expect.objectContaining({
      session_id: 'tile-runtime',
      cwd: '/selected'
    }),
    undefined,
    undefined
  )
  const refsBeforeFailure = attachments.$attachments.get()
  request.mockRejectedValueOnce(new Error('cwd unavailable'))
  await expect(captureProjectSelection(view, attachments).select('/failed')).rejects.toThrow('cwd unavailable')
  expect(attachments.$attachments.get()).toBe(refsBeforeFailure)
  expect($sessionStates.get()['tile-runtime'].cwd).toBe('/selected')

  let complete!: (result: { cwd: string; branch: string }) => void
  request.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = resolve
      })
  )
  attachments.update({
    ...attachments.$attachments.get()[0]!,
    path: '/selected/src',
    detail: 'src',
    refText: '@folder:src'
  })
  const pending = captureProjectSelection(view, attachments).select('/late')
  setNewChatWorkspaceTarget('/different-foreground')
  complete({ cwd: '/late', branch: 'main' })
  await pending
  expect(attachments.$attachments.get()[0]?.refText).toBe('@folder:/selected/src')
  expect($newChatWorkspaceTarget.get()).toBe('/different-foreground')

  publishSessionState('tile-runtime', { ...draftState, isUnsentDraft: false })
  expect(canSelectDraftProject(view)).toBe(false)
  await captureProjectSelection(view, attachments).select('/another')
  expect($sessionStates.get()['tile-runtime'].cwd).toBe('/before')
  expect($startWorkSessionRequest.get()).toMatchObject({ path: '/another', openTab: true })
})

it('discards a picker result after the user replaces the draft', () => {
  setNewChatWorkspaceTarget('/first')
  const selection = captureProjectSelection(PRIMARY_SESSION_VIEW, createComposerAttachmentScope())
  setNewChatWorkspaceTarget('/newer')
  selection.select('/late-picker')
  expect($newChatWorkspaceTarget.get()).toBe('/newer')
  expect($startWorkSessionRequest.get()).toBeNull()
})

it('keeps attached folders anchored to their original path across draft project changes and clearing', async () => {
  const attachments = createComposerAttachmentScope()
  attachments.add({
    id: 'folder:docs',
    occurrenceId: 'original-folder-occurrence',
    kind: 'folder',
    label: 'my docs',
    path: '/original/my docs',
    detail: 'my docs',
    refText: '@folder:`my docs`'
  })
  const occurrence = attachments.$attachments.get()[0]!.occurrenceId

  const view: SessionView = {
    ...PRIMARY_SESSION_VIEW,
    $runtimeId: atom(null),
    $storedId: atom(null),
    $messagesEmpty: atom(true),
    $busy: atom(false)
  }

  setNewChatWorkspaceTarget('/original')
  await captureProjectSelection(view, attachments).select('/different')
  expect(attachments.$attachments.get()[0]).toMatchObject({
    occurrenceId: occurrence,
    path: '/original/my docs',
    refText: '@folder:`/original/my docs`'
  })
  await captureProjectSelection(view, attachments).select('/original')
  expect(attachments.$attachments.get()[0]?.refText).toBe('@folder:`my docs`')
  await captureProjectSelection(view, attachments).select(null)
  expect(attachments.$attachments.get()[0]?.refText).toBe('@folder:`/original/my docs`')
})
