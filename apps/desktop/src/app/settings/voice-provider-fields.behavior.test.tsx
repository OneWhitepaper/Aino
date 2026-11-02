import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesConfigRecord } from '@/types/hermes'

import { VoiceProviderFields } from './voice-provider-fields'

const mocks = vi.hoisted(() => ({
  cache: vi.fn(),
  getSchema: vi.fn(),
  getVoices: vi.fn(),
  save: vi.fn(),
  config: {
    tts: { openai: { model: 'tts-1', voice: 'alloy' }, elevenlabs: { voice_id: 'old', model_id: 'old-model' } }
  } as HermesConfigRecord
}))

vi.mock('@/hermes', () => ({
  getHermesConfigSchema: (...args: unknown[]) => mocks.getSchema(...args),
  getElevenLabsVoices: (...args: unknown[]) => mocks.getVoices(...args),
  profileScopeKey: (scope?: { connectionId?: string; profile?: string }) =>
    `${scope?.connectionId ?? ''}::${scope?.profile ?? 'default'}`,
  saveHermesConfigRecord: (...args: unknown[]) => mocks.save(...args)
}))

vi.mock('../hooks/use-config-record', () => ({
  useHermesConfigRecord: () => ({ data: mocks.config, writeScope: undefined }),
  hermesConfigCacheWriter: () => mocks.cache
}))

vi.mock('./config-field', () => ({
  ConfigField: ({
    schemaKey,
    value,
    onChange,
    enumOptions
  }: {
    schemaKey: string
    value: unknown
    onChange: (value: string) => void
    enumOptions: string[]
  }) => (
    <label>
      {schemaKey}
      <input aria-label={schemaKey} onChange={event => onChange(event.target.value)} value={String(value ?? '')} />
      <output data-testid={schemaKey}>{enumOptions?.join(',')}</output>
    </label>
  )
}))

vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))

beforeEach(() => {
  mocks.getSchema.mockResolvedValue({ fields: {} })
  mocks.getVoices.mockResolvedValue({
    available: true,
    voices: [{ voice_id: 'scoped-voice', label: 'Selected profile voice' }]
  })
  mocks.save.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

const scope = { connectionId: 'gateway-b', profile: 'voice-bot' }

function renderFields(providerKey = 'openai') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <VoiceProviderFields profile={scope} providerKey={providerKey} section="tts" />
    </QueryClientProvider>
  )
}

describe('voice provider fields', () => {
  it('loads schema and ElevenLabs account voices from the selected owner', async () => {
    renderFields('elevenlabs')
    await waitFor(() => expect(mocks.getVoices).toHaveBeenCalled())

    expect(mocks.getVoices).toHaveBeenCalledWith(scope)
    expect(mocks.getSchema).toHaveBeenCalledWith(scope)
    await waitFor(() => expect(screen.getByTestId('tts.elevenlabs.voice_id').textContent).toContain('scoped-voice'))
  })

  it('serializes saves so a slow older edit cannot overwrite the newest voice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let finishFirst!: (value: { ok: boolean }) => void
    mocks.save.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishFirst = resolve
        })
    )
    renderFields()
    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.change(screen.getByLabelText('tts.openai.voice'), { target: { value: 'coral' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(mocks.save).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('tts.openai.voice'), { target: { value: 'nova' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(mocks.save).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishFirst({ ok: true })
      await Promise.resolve()
    })
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[1]).toEqual([{ tts: { openai: { voice: 'nova' } } }, scope])
    expect(mocks.cache.mock.calls.at(-1)?.[0]).toMatchObject({ tts: { openai: { voice: 'nova' } } })
  })
})
