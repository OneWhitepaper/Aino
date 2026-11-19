import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CustomEndpointValidationResponse } from '@/types/hermes'

import { type EndpointForm, useCustomEndpointEditor } from './use-custom-endpoint-editor'

const api = vi.hoisted(() => ({
  activateCustomEndpoint: vi.fn(),
  deleteCustomEndpoint: vi.fn(),
  getCustomEndpoints: vi.fn(),
  saveCustomEndpoint: vi.fn(),
  validateCustomEndpoint: vi.fn()
}))

vi.mock('@/hermes', () => api)
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/store/confirm', () => ({ confirm: vi.fn() }))
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))

const emptyResponse = { current: { base_url: '', model: '', provider: '' }, endpoints: [] }
const scope = { connectionId: 'local', profile: 'writer' }

const draft = {
  name: 'Fixture gateway',
  baseUrl: 'https://fixture.example',
  apiKey: 'fixture-key',
  model: 'model-alias',
  apiMode: '' as const
}

const verifiedResponse = {
  ok: true,
  reachable: true,
  message: '',
  models: ['model-alias', 'another-model'],
  model_details: [{ id: 'model-alias', canonical_model: 'canonical-model', reasoning_effort: 'high' }],
  resolved_base_url: 'https://fixture.example/v1',
  detected_api_mode: 'codex_responses' as const,
  // A legacy probe label is deliberately different from the verified model transport.
  transport_checked: 'chat_completions' as const
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => (resolve = finish))

  return { promise, resolve }
}

async function editor() {
  const onConfigSaved = vi.fn()

  const hook = renderHook(({ owner }) => useCustomEndpointEditor({ scope: owner, onConfigSaved }), {
    initialProps: { owner: scope }
  })

  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  act(() => hook.result.current.updateForm(draft))

  return { ...hook, onConfigSaved }
}

beforeEach(() => {
  api.getCustomEndpoints.mockResolvedValue(emptyResponse)
  api.saveCustomEndpoint.mockResolvedValue({ ...emptyResponse, ok: true, id: 'fixture' })
  api.validateCustomEndpoint.mockResolvedValue(verifiedResponse)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('custom endpoint protocol verification', () => {
  it.each(['chat_completions', 'anthropic_messages'] as const)(
    'saves detected %s unchanged and explains automatic Code adaptation on supported backends',
    async detectedApiMode => {
      api.validateCustomEndpoint.mockResolvedValue({ ...verifiedResponse, detected_api_mode: detectedApiMode })
      const { result } = await editor()
      await act(() => result.current.validate())

      expect(result.current.validation).toMatchObject({
        kind: 'success',
        message: expect.stringMatching(/Code.*automatically adapt/i)
      })
      expect(result.current.validation?.message).toMatch(/supported backend/i)
      expect(result.current.form.apiMode).toBe('')
      await act(() => result.current.save())
      expect(api.saveCustomEndpoint).toHaveBeenCalledWith(expect.objectContaining({ api_mode: detectedApiMode }), scope)
    }
  )

  it('keeps Test in auto mode and saves the verified Responses protocol, canonical URL and aliases', async () => {
    const { result } = await editor()
    await act(() => result.current.validate())

    expect(result.current.form.apiMode).toBe('')
    expect(result.current.form.baseUrl).toBe('https://fixture.example/v1')
    expect(result.current.validation).toMatchObject({
      kind: 'success',
      message: expect.stringContaining('Responses API')
    })
    await act(() => result.current.save())

    expect(api.validateCustomEndpoint).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ api_mode: '', model: 'model-alias', base_url: 'https://fixture.example' }),
      scope
    )
    expect(api.saveCustomEndpoint).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        api_mode: 'codex_responses',
        base_url: 'https://fixture.example/v1',
        model: 'model-alias',
        models: ['model-alias', 'another-model'],
        model_details: [{ id: 'model-alias', canonical_model: 'canonical-model', reasoning_effort: 'high' }]
      }),
      scope
    )
  })

  it('validates a direct auto Save before writing anything', async () => {
    const pending = deferred<CustomEndpointValidationResponse>()
    api.validateCustomEndpoint.mockReturnValue(pending.promise)
    const { result } = await editor()
    let saving!: Promise<boolean>
    act(() => {
      saving = result.current.save()
    })

    expect(api.validateCustomEndpoint).toHaveBeenCalledWith(expect.objectContaining({ api_mode: '' }), scope)
    expect(api.saveCustomEndpoint).not.toHaveBeenCalled()
    expect(result.current.saving).toBe(true)
    await act(async () => {
      pending.resolve(verifiedResponse)
      expect(await saving).toBe(true)
    })
    expect(api.saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ api_mode: 'codex_responses', base_url: 'https://fixture.example/v1' }),
      scope
    )
  })

  it.each<Partial<EndpointForm>>([
    { baseUrl: 'https://changed.example/v1' },
    { apiKey: 'changed-fixture-key' },
    { model: 'changed-model' },
    { id: 'different-saved-key' }
  ])('requires new evidence after changing %j', async patch => {
    const { result } = await editor()
    await act(() => result.current.validate())
    act(() => result.current.updateForm(patch))
    api.validateCustomEndpoint.mockResolvedValue({
      ok: false,
      reachable: true,
      models: ['corrected-model'],
      message: 'Retest this model'
    })
    await act(() => result.current.save())

    expect(api.validateCustomEndpoint).toHaveBeenCalledTimes(2)
    expect(api.saveCustomEndpoint).not.toHaveBeenCalled()
    expect(result.current.validation?.kind).toBe('warning')
    expect(result.current.modelOptions).toContain('corrected-model')
  })

  it('does not restore cached detection when switching to manual and back to auto', async () => {
    const { result } = await editor()
    await act(() => result.current.validate())
    act(() => result.current.updateForm({ apiMode: 'chat_completions' }))
    act(() => result.current.updateForm({ apiMode: '' }))
    api.validateCustomEndpoint.mockResolvedValue({ ...verifiedResponse, detected_api_mode: 'anthropic_messages' })
    await act(() => result.current.save())

    expect(api.validateCustomEndpoint).toHaveBeenCalledTimes(2)
    expect(api.saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ api_mode: 'anthropic_messages' }),
      scope
    )
  })

  it.each(['chat_completions', 'anthropic_messages', 'codex_responses'] as const)(
    'saves the explicit %s protocol without validation or switching',
    async apiMode => {
      const { result } = await editor()
      act(() => result.current.updateForm({ apiMode }))
      await act(() => result.current.save())

      expect(api.validateCustomEndpoint).not.toHaveBeenCalled()
      expect(api.saveCustomEndpoint).toHaveBeenCalledWith(expect.objectContaining({ api_mode: apiMode }), scope)
    }
  )

  it('preserves an explicit mode after a legacy route test without detected evidence', async () => {
    api.validateCustomEndpoint.mockResolvedValue({ ...verifiedResponse, detected_api_mode: undefined })
    const { result } = await editor()
    act(() => result.current.updateForm({ apiMode: 'anthropic_messages' }))
    await act(() => result.current.validate())
    await act(() => result.current.save())

    expect(result.current.form.apiMode).toBe('anthropic_messages')
    expect(api.validateCustomEndpoint).toHaveBeenCalledTimes(1)
    expect(api.saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ api_mode: 'anthropic_messages' }),
      scope
    )
  })

  it.each([undefined, '', 'future_protocol'])(
    'blocks unverified auto Save (%s) and offers manual selection or retesting',
    async detectedApiMode => {
      api.validateCustomEndpoint.mockResolvedValue({ ...verifiedResponse, detected_api_mode: detectedApiMode })
      const { result } = await editor()
      await act(() => result.current.validate())
      expect(result.current.validation).toMatchObject({ kind: 'warning', message: expect.stringMatching(/manual/i) })
      expect(result.current.validation?.message).toMatch(/test/i)
      await act(() => result.current.save())
      expect(api.saveCustomEndpoint).not.toHaveBeenCalled()
      act(() => result.current.updateForm({ apiMode: 'chat_completions' }))
      await act(() => result.current.save())
      expect(api.saveCustomEndpoint).toHaveBeenCalledWith(
        expect.objectContaining({ api_mode: 'chat_completions' }),
        scope
      )
    }
  )

  it('keeps failed model discovery available and refuses to pin its checked transport', async () => {
    api.validateCustomEndpoint.mockResolvedValue({
      ...verifiedResponse,
      ok: false,
      detected_api_mode: undefined,
      message: 'Model request failed'
    })
    const { result } = await editor()
    await act(() => result.current.validate())
    expect(result.current.modelOptions).toContain('another-model')
    await act(() => result.current.save())
    expect(api.saveCustomEndpoint).not.toHaveBeenCalled()
    expect(result.current.validation).toMatchObject({ message: 'Model request failed' })
  })

  it('revalidates a selected model after a catalog-only Test', async () => {
    api.validateCustomEndpoint.mockResolvedValueOnce({ ...verifiedResponse, detected_api_mode: undefined })
    const { result } = await editor()
    act(() => result.current.updateForm({ model: '' }))
    await act(() => result.current.validate())
    expect(result.current.modelOptions).toContain('another-model')
    act(() => result.current.updateForm({ model: 'another-model' }))
    await act(() => result.current.save())

    expect(api.validateCustomEndpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'another-model', api_mode: '' }),
      scope
    )
    expect(api.saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'another-model', api_mode: 'codex_responses' }),
      scope
    )
  })

  it('retires earlier evidence when a fresh Test fails', async () => {
    const { result } = await editor()
    await act(() => result.current.validate())
    api.validateCustomEndpoint.mockRejectedValue(new Error('fixture timeout'))
    await act(() => result.current.validate())
    await act(() => result.current.save())
    expect(api.saveCustomEndpoint).not.toHaveBeenCalled()
    expect(result.current.validation?.kind).toBe('error')
  })

  it('does not publish an auto Save whose draft changes during validation', async () => {
    const pending = deferred<CustomEndpointValidationResponse>()
    api.validateCustomEndpoint.mockReturnValue(pending.promise)
    const { result, onConfigSaved } = await editor()
    let saving!: Promise<boolean>
    act(() => {
      saving = result.current.save()
    })
    act(() => result.current.updateForm({ model: 'new-model' }))
    await act(async () => {
      pending.resolve(verifiedResponse)
      expect(await saving).toBe(false)
    })

    expect(api.saveCustomEndpoint).not.toHaveBeenCalled()
    expect(onConfigSaved).not.toHaveBeenCalled()
    expect(result.current.form.model).toBe('new-model')
    expect(result.current.validation).toBeNull()
  })

  it.each([
    { connectionId: 'remote', profile: 'writer' },
    { connectionId: 'local', profile: 'director' }
  ])('retires pending auto Save when the owner changes to %j', async owner => {
    const pending = deferred<CustomEndpointValidationResponse>()
    api.validateCustomEndpoint.mockReturnValue(pending.promise)
    const { result, rerender, onConfigSaved } = await editor()
    let saving!: Promise<boolean>
    act(() => {
      saving = result.current.save()
    })
    rerender({ owner })
    await act(async () => {
      pending.resolve(verifiedResponse)
      expect(await saving).toBe(false)
    })
    expect(api.saveCustomEndpoint).not.toHaveBeenCalled()
    expect(onConfigSaved).not.toHaveBeenCalled()
    expect(result.current.form.baseUrl).toBe('')
    expect(result.current.validation).toBeNull()
  })

  it('cannot save during Test or reuse a late result from a changed draft', async () => {
    const pending = deferred<CustomEndpointValidationResponse>()
    api.validateCustomEndpoint.mockReturnValueOnce(pending.promise)
    const { result } = await editor()
    let testing!: Promise<void>
    act(() => {
      testing = result.current.validate()
    })
    await act(async () => expect(await result.current.save()).toBe(false))
    act(() => result.current.updateForm({ apiKey: 'new-fixture-key' }))
    await act(async () => {
      pending.resolve(verifiedResponse)
      await testing
    })
    expect(result.current.validation).toBeNull()
    api.validateCustomEndpoint.mockResolvedValue({ ...verifiedResponse, detected_api_mode: 'anthropic_messages' })
    await act(() => result.current.save())

    expect(api.saveCustomEndpoint).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ api_key: 'new-fixture-key', api_mode: 'anthropic_messages' }),
      scope
    )
  })
})
