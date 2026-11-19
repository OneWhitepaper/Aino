import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ProfileStore from '@/store/profile'

vi.mock('@/lib/model-default', () => ({ resolveModelDefault: async () => ({ platform: null }) }))
vi.mock('@/store/profile', async importOriginal => ({
  ...(await importOriginal<typeof ProfileStore>()),
  ensureGatewayProfile: async () => undefined,
  ensureGatewayAgent: async () => undefined
}))

import { setDraftExecutionMode } from '@/store/execution-mode'
import { $activeGatewayProfile, $newChatProfile, $newChatRoute } from '@/store/profile'
import {
  markComposerSelectionManual,
  setCurrentCwd,
  setCurrentCwdExplicit,
  setCurrentModel,
  setCurrentProvider
} from '@/store/session'

import { desktopSessionCreateParams } from './create-params'

describe('Code session creation', () => {
  beforeEach(() => {
    $activeGatewayProfile.set('default')
    $newChatProfile.set(null)
    $newChatRoute.set(null)
    setDraftExecutionMode('work')
    setCurrentCwd('')
    setCurrentCwdExplicit(false)
  })

  it('starts Code without a project and lets the owning gateway allocate its workspace', async () => {
    setDraftExecutionMode('code')
    const { params } = await desktopSessionCreateParams('')
    expect(params).toMatchObject({ execution_mode: 'code', row_cwd: '' })
    expect(params).not.toHaveProperty('cwd')
  })

  it('sends the shared model selection and explicit folder with Code mode', async () => {
    setDraftExecutionMode('code')
    setCurrentCwd('/projects/example')
    setCurrentCwdExplicit(true)
    setCurrentModel('provider-model')
    setCurrentProvider('custom:my-provider')
    markComposerSelectionManual()

    const { params } = await desktopSessionCreateParams('/projects/example')

    expect(params).toMatchObject({
      execution_mode: 'code',
      cwd: '/projects/example',
      cwd_explicit: true,
      model: 'provider-model',
      provider: 'custom:my-provider'
    })
  })

  it('does not treat an inherited default folder as explicit Code consent', async () => {
    setDraftExecutionMode('code')
    const { params } = await desktopSessionCreateParams('/runtime/default')
    expect(params).toMatchObject({ execution_mode: 'code', row_cwd: '' })
    expect(params).not.toHaveProperty('cwd')
  })

  it('keeps Work requests compatible with backends that predate modes', async () => {
    const { params } = await desktopSessionCreateParams('')
    expect(params).not.toHaveProperty('execution_mode')
  })

  it('keeps Bot-owned creation on Work while the ordinary chat preference is Code', async () => {
    setDraftExecutionMode('code')
    const { params } = await desktopSessionCreateParams('', null, 'bot', false, false)
    expect(params).not.toHaveProperty('execution_mode')
  })
})
