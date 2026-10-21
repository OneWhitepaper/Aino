import { expect, test } from 'vitest'

import { startPlatformServer } from './platform-account-fixture.ts'

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
