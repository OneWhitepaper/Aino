import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { PaletteContribution } from '@/app/command-palette/contrib'
import { $workspaceIsPage } from '@/app/routes'
import { findGroupOfPane, group, split } from '@/components/pane-shell/tree/model'
import { $layoutTree } from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'
import type { HermesApiRequest } from '@/global'
import { $notifications } from '@/store/notifications'
import * as profile from '@/store/profile'
import { $connection, $selectedStoredSessionId } from '@/store/session'

vi.mock('@/contrib/plugins', () => ({ discoverBundledPlugins: () => undefined }))
vi.mock('@/contrib/runtime-loader', () => ({ discoverRuntimePlugins: () => undefined }))
vi.mock('./wiring', () => ({ ContribWiring: () => null, WiredPane: () => null }))

await import('./controller')

const selectPaths = vi.fn(async () => ['/tmp/writer.tar.gz'])

const api = vi.fn(async ({ path }: HermesApiRequest) => {
  if (path === '/api/profiles/import') {
    return {
      desktop: { version: 1, layoutTree: group(['files'], { id: 'imported-layout' }) },
      name: 'imported-bot',
      ok: true,
      path: '/tmp/imported-bot'
    }
  }

  if (path === '/api/profiles') {
    return { profiles: [] }
  }

  return {}
})

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api, selectPaths } })
  $connection.set({ mode: 'local' } as never)
  $selectedStoredSessionId.set('existing-chat')
  window.location.hash = '#/existing-chat'
  $workspaceIsPage.set(false)
  $notifications.set([])
})

afterEach(() => {
  vi.restoreAllMocks()
  $connection.set(null)
  $selectedStoredSessionId.set(null)
  $workspaceIsPage.set(false)
  window.location.hash = '#/'
  Reflect.deleteProperty(window, 'hermesDesktop')
})

const runImport = () =>
  (
    registry.getArea('palette').find(contribution => contribution.id === 'profile.import')!.data as PaletteContribution
  ).run()

it('opens imported Bots in management while retaining the current chat and window layout', async () => {
  const conversation = group(['workspace'], { id: 'existing-layout', active: 'workspace' })

  const layout = split('row', [
    group(['sessions'], { id: 'existing-sidebar' }),
    conversation,
    group(['files', 'review', 'terminal'], { id: 'existing-tools', toolPanel: true, minimized: true })
  ])

  $layoutTree.set(layout)
  const currentProfile = profile.$activeGatewayProfile.get()
  const selectProfile = vi.spyOn(profile, 'selectProfile').mockImplementation(() => undefined)
  const freshRequests = profile.$freshSessionRequest.get()

  runImport()

  await waitFor(() => expect(window.location.hash).toBe('#/profiles'))
  expect($workspaceIsPage.get()).toBe(true)
  expect($layoutTree.get()).toBe(layout)
  expect(findGroupOfPane($layoutTree.get()!, 'workspace')).toBe(conversation)
  expect(profile.$activeGatewayProfile.get()).toBe(currentProfile)
  expect($selectedStoredSessionId.get()).toBe('existing-chat')
  expect(profile.$freshSessionRequest.get()).toBe(freshRequests)
  expect(selectProfile).not.toHaveBeenCalled()
  expect(api).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'local', path: '/api/profiles/import' }))
  expect(api.mock.calls.some(([request]) => request.path === '/api/profiles/active')).toBe(false)
})

it('refuses remote native imports before choosing a local archive or leaving the current chat', async () => {
  $connection.set({ mode: 'remote' } as never)

  runImport()

  await waitFor(() => expect($notifications.get().some(notification => notification.kind === 'error')).toBe(true))
  expect(selectPaths).not.toHaveBeenCalled()
  expect(api).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('#/existing-chat')
  expect($selectedStoredSessionId.get()).toBe('existing-chat')
})
