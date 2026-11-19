import { afterEach, expect, it, vi } from 'vitest'

const scope = JSON.stringify(['production', 'alice', 'local', 'default'])
afterEach(() => localStorage.removeItem('aino.desktop.mode-workspaces.v1'))

it.each([null, [], { [scope]: null }])('ignores malformed persisted workspace roots (%j)', async value => {
  localStorage.setItem('aino.desktop.mode-workspaces.v1', JSON.stringify(value))
  vi.resetModules()
  const modes = await import('./workspaces')
  expect(modes.readModePreference(scope)).toBe('work')
  expect(modes.readModeWorkspace(scope, 'code')).toBeNull()
})

it('retains a valid history pointer but rejects an invalid draft identity/model', async () => {
  localStorage.setItem(
    'aino.desktop.mode-workspaces.v1',
    JSON.stringify({
      [scope]: {
        mode: 'code',
        filter: 'current',
        code: { sessionId: 'saved-code', projectScope: 'p_code', draft: { key: 'stored-session-id' } }
      }
    })
  )
  vi.resetModules()
  const modes = await import('./workspaces')
  expect(modes.readModeWorkspace(scope, 'code')).toEqual({
    sessionId: 'saved-code',
    projectScope: 'p_code',
    draft: null
  })
})
