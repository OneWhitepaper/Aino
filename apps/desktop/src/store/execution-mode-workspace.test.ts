import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeSessionInfo } from '@/test/session-info'

import { $freshDraftKey, stashSessionDraft, takeSessionDraft } from './composer'
import * as modes from './execution-mode'
import { writeModeWorkspace } from './execution-mode/workspaces'
import { $activeGatewayProfile, $newChatConnectionId, $newChatProfile, $newChatRoute } from './profile'
import { $projectScope } from './project-scope'
import {
  $currentCwd,
  $selectedStoredSessionId,
  $sessions,
  $workspaceCwdOwner,
  setConnection,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentProvider,
  setNewChatWorkspaceTarget
} from './session'

beforeEach(() => {
  localStorage.clear()
  modes.$executionModeRequest.set(null)
  $newChatProfile.set(null)
  $newChatRoute.set(null)
  $newChatConnectionId.set(null)
  $activeGatewayProfile.set('default')
  setConnection({
    mode: 'local',
    connectionId: `mode-${crypto.randomUUID()}`,
    profile: 'default',
    registryScoped: true
  } as never)
  $selectedStoredSessionId.set(null)
  $workspaceCwdOwner.set(null)
  $sessions.set([])
  $freshDraftKey.set('__new__:work')
  modes.setDraftExecutionMode('work')
})

function draft(mode: 'work' | 'code', key: string, cwd: string, project: string, model: string) {
  modes.$executionModeRequest.set(null)
  modes.setDraftExecutionMode(mode)
  $freshDraftKey.set(key)
  $currentCwd.set(cwd)
  $projectScope.set(project)
  setNewChatWorkspaceTarget(cwd || null)
  setCurrentModel(model)
  setCurrentProvider('custom:fixture')
  setCurrentModelSource('manual')
}

describe('mode workspace ownership', () => {
  it('restores independent draft pointers, explicit workspace and model after two switches', () => {
    draft('work', '__new__:work', '', '__no_project__', 'writer')
    stashSessionDraft('__new__:work', 'Unsent report', [{ id: 'a', kind: 'file', label: 'Report', path: '/report.md' }])
    modes.requestExecutionMode('code')
    draft('code', '__new__:code', '/repo', 'p_code', 'coder')
    stashSessionDraft('__new__:code', 'Unsent patch', [])
    modes.requestExecutionMode('work')
    expect(modes.getExecutionWorkspace('work')).toMatchObject({
      sessionId: null,
      projectScope: '__no_project__',
      draft: {
        key: '__new__:work',
        cwd: '',
        workspaceTarget: null,
        model: { model: 'writer', provider: 'custom:fixture', source: 'manual' }
      }
    })
    expect(modes.getExecutionWorkspace('code')).toMatchObject({
      sessionId: null,
      projectScope: 'p_code',
      draft: { key: '__new__:code', cwd: '/repo', workspaceTarget: '/repo', model: { model: 'coder' } }
    })
    expect(takeSessionDraft('__new__:work')).toMatchObject({ text: 'Unsent report', attachments: [{ id: 'a' }] })
    expect(takeSessionDraft('__new__:code')?.text).toBe('Unsent patch')
  })

  it('selects saved Code history without replacing the inactive Work draft or model', () => {
    draft('work', '__new__:work', '/docs', 'p_docs', 'writer')
    modes.rememberExecutionWorkspace()
    $sessions.set([makeSessionInfo({ id: 'code-chat', execution_mode: 'code' })])
    $selectedStoredSessionId.set('code-chat')
    $workspaceCwdOwner.set('code-chat')
    modes.rememberSessionExecutionMode('code-chat', 'code')
    modes.rememberExecutionWorkspace()
    modes.requestExecutionMode('work')
    expect(modes.getExecutionWorkspace('work')?.draft?.model.model).toBe('writer')
    expect(modes.getExecutionWorkspace('work')?.sessionId).toBeNull()
    expect(modes.getExecutionWorkspace('code')?.sessionId).toBe('code-chat')
  })

  it('ignores a background mode publication for the foreground draft', () => {
    draft('code', '__new__:code', '/repo', 'p_code', 'coder')
    modes.rememberSessionExecutionMode('background-work', 'work')
    expect(modes.getDraftExecutionMode()).toBe('code')
  })

  it('isolates explicit draft owners, including same profile on another source', () => {
    draft('work', '__new__:work', '/docs', 'p_docs', 'writer')
    modes.rememberExecutionWorkspace()
    $newChatProfile.set('default')
    $newChatConnectionId.set('another-service')
    expect(modes.getExecutionWorkspace('work')).toBeNull()
    $newChatConnectionId.set(null)
    $newChatProfile.set(null)
    expect(modes.getExecutionWorkspace('work')?.draft?.key).toBe('__new__:work')
    $activeGatewayProfile.set('other')
    expect(modes.getExecutionWorkspace('work')).toBeNull()
  })

  it('reloads mode and workspace pointers from persistence', async () => {
    draft('code', '__new__:reload', '/repo', 'p_code', 'coder')
    modes.rememberExecutionWorkspace()
    const scope = modes.$executionModeScope.get()
    vi.resetModules()
    const modulePath = './execution-mode/workspaces'
    const reloaded = await import(/* @vite-ignore */ modulePath)
    expect(reloaded.readModeWorkspace(scope, 'code')?.draft?.key).toBe('__new__:reload')
    expect(reloaded.readModePreference(scope)).toBe('code')
  })
})

it('coalesces two mode requests before navigation without copying the outgoing draft into Code', () => {
  draft('work', '__new__:rapid', '/docs', 'p_docs', 'writer')
  modes.requestExecutionMode('code')
  modes.requestExecutionMode('work')
  expect(modes.getExecutionWorkspace('code')).toBeNull()
  expect(modes.getExecutionWorkspace('work')?.draft?.key).toBe('__new__:rapid')
})

it('does not assign an unhydrated historical selection to the inactive draft workspace', () => {
  draft('work', '__new__:hydrate', '/docs', 'p_docs', 'writer')
  modes.rememberExecutionWorkspace()
  $selectedStoredSessionId.set('pending-code')
  $workspaceCwdOwner.set('pending-code')
  modes.rememberExecutionWorkspace()
  expect(modes.getExecutionWorkspace('work')?.sessionId).toBeNull()
  expect(modes.getExecutionWorkspace('work')?.draft?.key).toBe('__new__:hydrate')
})

it('recovers an already persisted opposite-mode pointer to its original draft', () => {
  draft('work', '__new__:repair', '/docs', 'p_docs', 'writer')
  modes.rememberExecutionWorkspace()
  const saved = modes.getExecutionWorkspace('work')!
  writeModeWorkspace(modes.$executionModeScope.get(), 'work', { ...saved, sessionId: 'actually-code' })
  $sessions.set([makeSessionInfo({ id: 'actually-code', execution_mode: 'code' })])
  expect(modes.getExecutionWorkspace('work')).toEqual({ ...saved, sessionId: null })
})

it('ignores a detached runtime publication after the selection has become a fresh Work draft', () => {
  draft('work', '__new__:detached', '', '__no_project__', 'writer')
  modes.rememberSessionExecutionMode(null, 'code')
  expect(modes.getDraftExecutionMode()).toBe('work')
})
