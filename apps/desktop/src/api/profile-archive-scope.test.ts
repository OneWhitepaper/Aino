import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from './client'
import { exportProfileArchive, importProfileArchive } from './profiles'

const api = vi.fn(async (_request: { connectionId?: string; path: string; profile?: string }) => ({}))

beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
  setApiRequestConnection('remote-primary')
  setApiRequestProfile('same-name-on-another-source')
})

afterEach(() => {
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  api.mockClear()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('pins native archives to the selected local owner even with a remote ambient primary', async () => {
  await exportProfileArchive('writer', { output: '/tmp/writer.tar.gz' }, { connectionId: 'local', profile: 'writer' })
  await importProfileArchive('/tmp/writer.tar.gz', undefined, { connectionId: 'local' })

  expect(api.mock.calls[0][0]).toMatchObject({
    connectionId: 'local',
    profile: 'writer',
    path: '/api/profiles/writer/export'
  })
  expect(api.mock.calls[1][0]).toMatchObject({ connectionId: 'local', path: '/api/profiles/import' })
  expect(api.mock.calls[1][0].profile).toBeUndefined()
})
