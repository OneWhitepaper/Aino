import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, it, vi } from 'vitest'
import yaml from 'yaml'

const fixture = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  launch: vi.fn(),
  url: 'http://127.0.0.1:19001'
}))

vi.mock('@playwright/test', () => ({ _electron: { launch: fixture.launch } }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof fs>()

  return {
    ...actual,
    existsSync: (file: Parameters<typeof actual.existsSync>[0]) =>
      /[\\/]apps[\\/]desktop[\\/]dist[\\/]/.test(String(file)) || actual.existsSync(file)
  }
})
vi.mock('./test', () => ({ installErrorBannerGuard: () => {} }))
vi.mock('./electron-binary', () => ({ resolveElectronBinary: () => '/unused-electron' }))
vi.mock('./run-tmp-reaper', () => ({ stopSandboxGatewayDaemons: () => {} }))
vi.mock('../../../tests-js/scripts/mock-server', () => ({
  startMockServer: async () => ({ url: fixture.url, close: fixture.close })
}))

import { setupMockBackend } from './fixtures'

it('writes the synthetic key declared by the mock endpoint into the isolated launch profile', async () => {
  fixture.launch.mockResolvedValue({ firstWindow: async () => ({}), close: async () => {} })
  const backend = await setupMockBackend()

  try {
    const config = yaml.parse(fs.readFileSync(path.join(backend.sandbox.hermesHome, 'config.yaml'), 'utf8'))
    const env = Object.fromEntries(
      fs
        .readFileSync(path.join(backend.sandbox.hermesHome, '.env'), 'utf8')
        .trim()
        .split('\n')
        .map(line => line.split('='))
    )
    const provider = config.custom_providers.find((entry: { name: string }) => entry.name === 'Mock')

    expect(provider.base_url).toBe(`${fixture.url}/v1`)
    expect(env[provider.key_env]).toBe('e2e-mock-key')
    expect(env.OPENAI_BASE_URL).toBe(provider.base_url)
  } finally {
    await backend.cleanup()
  }
})
