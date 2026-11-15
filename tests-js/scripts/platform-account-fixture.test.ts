import { expect, test } from 'vitest'

import { type ElectronApplication, type Page } from './e2e-driver-deps.ts'
import { signInPlatformFixture, startPlatformServer } from './platform-account-fixture.ts'

test('account fixture requires a matching issued challenge and consumes it once', async () => {
  const server = await startPlatformServer()
  const verify = { phone: '+8613800138000', challenge_id: 'native-challenge', code: '246810', agreement_revision: 'native-terms-1' }

  const post = (route: string, body: object) => fetch(`${server.origin}/api/v1/auth/phone/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })

  try {
    expect((await post('verify', verify)).status).toBe(401)
    expect((await post('send-code', { phone: verify.phone })).status).toBe(200)
    expect((await post('verify', { ...verify, code: '000000' })).status).toBe(401)
    expect((await post('verify', verify)).status).toBe(200)
    expect((await post('verify', verify)).status).toBe(401)
  } finally {
    await server.close()
  }
})

test('required existing login never submits credentials and rejects a lost or offline persisted session', async () => {
  const mutations: string[] = []

  const renderer = (phase: string, member: boolean) => ({
    getByRole: (role: string) => ({
      isVisible: async () => role === 'button' ? member : !member,
      fill: async () => { mutations.push('fill'); throw new Error('Unexpected login form mutation') },
      check: async () => { mutations.push('check'); throw new Error('Unexpected login form mutation') },
      uncheck: async () => { mutations.push('uncheck'); throw new Error('Unexpected login form mutation') },
      click: async () => { mutations.push('click'); throw new Error('Unexpected login form mutation') },
    }),
    evaluate: async () => ({ phase, userId: '17', mode: 'production', rememberState: 'encrypted', hasError: phase !== 'signed_in' }),
  }) as unknown as Page

  const app = {} as ElectronApplication
  const restored = renderer('signed_in', true)
  const strict = { requireExisting: true }

  expect(await signInPlatformFixture(app, restored, strict)).toBe(restored)
  await expect(signInPlatformFixture(app, renderer('signed_out', false), strict)).rejects.toThrow('Persisted platform session')
  await expect(signInPlatformFixture(app, renderer('offline', true), strict)).rejects.toThrow('Persisted platform session')
  expect(mutations).toEqual([])
})

test('a restarted account fixture validates the saved token and refuses missing or unrelated credentials', async () => {
  const old = await startPlatformServer()
  let token = ''

  try {
    await fetch(`${old.origin}/api/v1/auth/phone/send-code`, { method: 'POST' })

    const reply = await fetch(`${old.origin}/api/v1/auth/phone/verify`, { method: 'POST',
      body: JSON.stringify({ challenge_id: 'native-challenge', code: '246810', agreement_revision: 'native-terms-1' }) })

    token = (await reply.json()).data.access_token
  } finally { await old.close() }

  const current = await startPlatformServer()

  try {
    expect((await fetch(`${current.origin}/api/v1/user/profile`)).status).toBe(401)
    expect((await fetch(`${current.origin}/api/v1/user/profile`, { headers: { Authorization: 'Bearer unrelated' } })).status).toBe(401)
    const profile = await fetch(`${current.origin}/api/v1/user/profile`, { headers: { Authorization: `Bearer ${token}` } })
    expect(profile.status).toBe(200)
    expect((await profile.json()).data.id).toBe(17)
    expect(current.requests.filter(request => request.path.startsWith('/api/v1/auth/'))).toEqual([])
  } finally { await current.close() }
})

test('the released desktop model query returns the same catalog as the queryless route', async () => {
  const server = await startPlatformServer()

  try {
    const current = await fetch(`${server.origin}/api/v1/desktop/models`)
    const released = await fetch(`${server.origin}/api/v1/desktop/models?include_images=true`)
    expect(current.status).toBe(200)
    expect(released.status).toBe(200)
    const catalog = await current.json()
    expect(Array.isArray(catalog.data)).toBe(true)
    expect(await released.json()).toEqual(catalog)
    expect(server.requests.map(request => request.path)).toContain('/api/v1/desktop/models?include_images=true')
  } finally { await server.close() }
})
