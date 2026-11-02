import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const localModelsEnabled = vi.hoisted(() => ({ value: false }))

import { modelSourceCopy } from '@/i18n/model-source'

import { ProvidersSettings } from './providers-settings'

vi.mock('@/store/local-models-flag', () => ({ $localModelsEnabled: { get: () => localModelsEnabled.value } }))
vi.mock('./custom-endpoints-settings', () => ({
  CustomEndpointsSettings: ({
    onConfigSaved,
    onMainModelChanged
  }: {
    onConfigSaved?: () => void
    onMainModelChanged?: (provider: string, model: string) => void
  }) => (
    <div data-testid="custom-endpoints-settings">
      <button onClick={onConfigSaved}>Save endpoint</button>
      <button onClick={() => onMainModelChanged?.('custom:relay', 'relay-model')}>Apply endpoint model</button>
    </div>
  )
}))
vi.mock('./third-party-model-settings', () => ({
  ThirdPartyModelSettings: ({ onConfigSaved }: { onConfigSaved?: () => void }) => (
    <button data-testid="third-party-settings" onClick={onConfigSaved}>
      Save service
    </button>
  )
}))
vi.mock('./local-models-settings', () => ({
  LocalModelsSettings: () => <div data-testid="local-models-settings" />
}))
vi.mock('./profile-scope', () => ({ SettingsProfileScope: () => <div data-testid="profile-scope" /> }))

afterEach(cleanup)

describe('ProvidersSettings', () => {
  it('opens official third-party services directly and retains a separate custom API entry', () => {
    localModelsEnabled.value = false
    const onConfigSaved = vi.fn()
    const copy = modelSourceCopy('en')
    render(<ProvidersSettings onConfigSaved={onConfigSaved} view="third-party" />)

    expect(screen.getByRole('button', { name: copy.providerSource }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: copy.customApiTitle }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('custom-endpoints-settings')).toBeNull()
    fireEvent.click(screen.getByTestId('third-party-settings'))
    expect(onConfigSaved).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: copy.customApiTitle }))
    expect(screen.getByTestId('custom-endpoints-settings')).toBeTruthy()
  })

  it('keeps custom endpoint management while omitting account and provider-key panels', () => {
    localModelsEnabled.value = false
    render(<ProvidersSettings view="custom-endpoints" />)

    expect(screen.getByTestId('custom-endpoints-settings')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accounts' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'API keys' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nous Portal' })).toBeNull()
  })

  it('keeps endpoint save and main-model callbacks wired on the existing endpoint destination', () => {
    localModelsEnabled.value = false
    const onConfigSaved = vi.fn()
    const onMainModelChanged = vi.fn()
    render(
      <ProvidersSettings
        onConfigSaved={onConfigSaved}
        onMainModelChanged={onMainModelChanged}
        view="custom-endpoints"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply endpoint model' }))
    expect(onConfigSaved).toHaveBeenCalledTimes(1)
    expect(onMainModelChanged).toHaveBeenCalledWith('custom:relay', 'relay-model')
  })

  it('sends a stale local-model link to custom endpoints when local models are unavailable', () => {
    localModelsEnabled.value = false
    render(<ProvidersSettings view="local" />)

    expect(screen.getByTestId('custom-endpoints-settings')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Local models' })).toBeNull()
  })

  it('retains local runtime links when enabled alongside both API configuration entries', () => {
    localModelsEnabled.value = true
    render(<ProvidersSettings view="local" />)

    expect(screen.getByTestId('local-models-settings')).toBeTruthy()
    expect(screen.getByRole('button', { name: modelSourceCopy('en').providerSource })).toBeTruthy()
    expect(screen.getByRole('button', { name: modelSourceCopy('en').customApiTitle })).toBeTruthy()
  })

  it('opens a newly routed section without destroying an already mounted endpoint editor', () => {
    localModelsEnabled.value = false
    const view = render(<ProvidersSettings view="custom-endpoints" />)
    const editor = screen.getByTestId('custom-endpoints-settings')
    view.rerender(<ProvidersSettings view="third-party" />)

    expect(screen.getByTestId('third-party-settings')).toBeTruthy()
    expect(screen.getByTestId('custom-endpoints-settings')).toBe(editor)
  })
})
