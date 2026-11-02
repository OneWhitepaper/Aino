import { afterEach, expect, it } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { platformAccountActions } from '@/api/platform'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { $activeGatewayProfile } from '@/store/profile'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { savePlatformDraftDefault } from './platform-draft-model'
import { platformModelCatalog, readPlatformDefault, writePlatformDefault } from './platform-models'
import {
  $activeSessionId,
  $currentModel,
  $currentPlatformOwner,
  $currentProvider,
  $selectedStoredSessionId,
  markComposerSelectionManual,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentPlatformOwner,
  setCurrentProvider
} from './session'

const ORIGIN = 'http://127.0.0.1:7001'
const route = { connectionId: 'source-a', profile: 'work' }

afterEach(() => {
  Reflect.deleteProperty(window, 'hermesDesktop')
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  setCurrentModel('')
  setCurrentProvider('')
  setCurrentModelSource('')
  setCurrentPlatformOwner('')
  $activeGatewayProfile.set('default')
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  localStorage.clear()
  clearGatewayManagedCapabilities()
})

async function installBackend(beforeSave: () => Promise<void> = async () => {}) {
  const records = new Map([
    [
      'source-a:work',
      {
        model: {
          provider: 'custom:mine',
          default: 'byok-model',
          name: 'legacy-model',
          api_key: '${SAVED_API_KEY}',
          base_url: 'https://model.example/v1'
        },
        custom_providers: [{ id: 'mine', api_key: '${SAVED_API_KEY}', base_url: 'https://model.example/v1' }],
        approvals: { mode: 'auto' }
      }
    ],
    ['source-b:work', { model: { provider: 'other', default: 'foreign-model' } }]
  ])

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => {}
      },
      platformModels: {
        list: async () => [platformModel('chosen'), platformModel('previous')],
        owner: async () => ({ user_id: 'user-a', platform_origin: ORIGIN })
      },
      api: async (request: {
        path: string
        method?: string
        connectionId?: string
        profile?: string
        body?: { config: { model: Record<string, string> } }
      }) => {
        const key = `${request.connectionId}:${request.profile}`
        const record = records.get(key)

        if (!record) {
          throw new Error(`Unexpected owner: ${key}`)
        }

        if (request.path === '/api/config' && request.method === 'PUT') {
          await beforeSave()
          record.model = { ...record.model, ...request.body?.config.model }

          return { ok: true }
        }

        if (request.path === '/api/model/info') {
          return { model: record.model.default, provider: record.model.provider }
        }

        throw new Error(`Unexpected API: ${request.path}`)
      }
    }
  })
  setApiRequestConnection(route.connectionId)
  setApiRequestProfile(route.profile)
  $activeGatewayProfile.set(route.profile)
  recordGatewayReadyCapability(route, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()

  return { records, account: platformSnapshot(), scope: platformDefaultScope(route) }
}

it('activates the selected Aino default without deleting credentials, unrelated config or another owner', async () => {
  const { records, account, scope } = await installBackend()
  const previous = structuredClone(records.get('source-a:work'))
  setCurrentProvider('custom:mine')
  setCurrentModel('byok-model')

  await savePlatformDraftDefault(account, scope, 'chosen', { activate: true })

  expect(records.get('source-a:work')).toEqual({
    ...previous,
    model: { ...previous?.model, default: '', name: '', provider: '' }
  })
  expect(records.get('source-b:work')?.model).toEqual({ provider: 'other', default: 'foreign-model' })
  expect(readPlatformDefault('user-a', scope, 'development', ORIGIN)).toBe('chosen')
  expect([$currentProvider.get(), $currentModel.get(), $currentPlatformOwner.get()]).toEqual([
    'aino',
    'chosen',
    'user-a'
  ])
})

it('retains the saved preference and current model when the authoritative configuration write fails', async () => {
  const { records, account, scope } = await installBackend(async () => {
    throw new Error('write refused')
  })

  writePlatformDefault('user-a', 'previous', scope, 'development', ORIGIN)
  setCurrentProvider('custom:mine')
  setCurrentModel('byok-model')

  await expect(savePlatformDraftDefault(account, scope, 'chosen', { activate: true })).rejects.toThrow('write refused')

  expect(records.get('source-a:work')?.model.default).toBe('byok-model')
  expect(readPlatformDefault('user-a', scope, 'development', ORIGIN)).toBe('previous')
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:mine', 'byok-model'])
})

it.each(['manual selection', 'live session', 'owner switch'])(
  'saves to the captured owner without overwriting a newer %s',
  async mode => {
    const gate = deferred()
    const started = deferred()

    const { records, account, scope } = await installBackend(async () => {
      started.resolve()
      await gate.promise
    })

    const saving = savePlatformDraftDefault(account, scope, 'chosen', { activate: true })
    await started.promise

    if (mode === 'manual selection') {
      markComposerSelectionManual()
    }

    if (mode === 'live session') {
      $activeSessionId.set('live-session')
    }

    setCurrentProvider('custom:newer')
    setCurrentModel('manual-model')

    if (mode === 'owner switch') {
      setApiRequestConnection('source-b')
    }

    gate.resolve()
    await saving

    expect(records.get('source-a:work')?.model.default).toBe('')
    expect(records.get('source-b:work')?.model.default).toBe('foreign-model')
    expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:newer', 'manual-model'])
  }
)

it('rejects an account change during activation without saving or publishing the old selection', async () => {
  const gate = deferred()
  const started = deferred()

  const { account, scope } = await installBackend(async () => {
    started.resolve()
    await gate.promise
  })

  writePlatformDefault('user-a', 'previous', scope, 'development', ORIGIN)
  setCurrentProvider('custom:new-account')
  setCurrentModel('new-account-model')
  const saving = savePlatformDraftDefault(account, scope, 'chosen', { activate: true })
  await started.promise
  platformAccountActions(window.hermesDesktop.platformAccount).snapshot.set(platformSnapshot('user-b', 2))
  gate.resolve()
  await expect(saving).rejects.toThrow()
  expect(readPlatformDefault('user-a', scope, 'development', ORIGIN)).toBe('previous')
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:new-account', 'new-account-model'])
})
