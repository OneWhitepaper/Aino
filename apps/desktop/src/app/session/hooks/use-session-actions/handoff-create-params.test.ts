import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/model-default', () => ({
  resolveModelDefault: vi.fn(async () => ({ model: 'other', provider: 'other' }))
}))
vi.mock('@/lib/code-model-capability', () => ({ assertCodeModelCompatible: vi.fn(async () => 'compatible') }))
vi.mock('@/store/profile', async original => ({
  ...(await original<Record<string, unknown>>()),
  ensureGatewayProfile: vi.fn(),
  ensureGatewayAgent: vi.fn()
}))

import { assertCodeModelCompatible } from '@/lib/code-model-capability'
import { resolveModelDefault } from '@/lib/model-default'
import { getDraftExecutionMode, setDraftExecutionMode } from '@/store/execution-mode'
import { setCurrentCwdExplicit, setCurrentModelTransient, setCurrentProviderTransient } from '@/store/session'

import { desktopSessionCreateParams } from './create-params'

beforeEach(() => {
  vi.clearAllMocks()
  setDraftExecutionMode('work')
  setCurrentCwdExplicit(true)
  setCurrentModelTransient('visible-model')
  setCurrentProviderTransient('custom:fixture')
})

it('retains the current model and uses the explicit opposite mode without switching the source', async () => {
  const prepared = await desktopSessionCreateParams(
    '/repo',
    { connectionId: 'local', profile: 'default' },
    'default',
    false,
    true,
    { executionMode: 'code', retainModelSelection: true }
  )

  expect(prepared.params).toMatchObject({ model: 'visible-model', provider: 'custom:fixture', execution_mode: 'code' })
  expect(resolveModelDefault).not.toHaveBeenCalled()
  expect(assertCodeModelCompatible).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'visible-model', provider: 'custom:fixture' })
  )
  expect(getDraftExecutionMode()).toBe('work')
})
