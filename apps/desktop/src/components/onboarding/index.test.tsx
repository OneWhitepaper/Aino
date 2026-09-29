import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $desktopOnboarding, type DesktopOnboardingState, type OnboardingContext } from '@/store/onboarding'
import { makeOAuthProvider } from '@/test/oauth-provider'
import type { OAuthProvider } from '@/types/hermes'

import { ApiKeyForm, Picker } from '.'

function setProviders(providers: OAuthProvider[]) {
  $desktopOnboarding.set({
    configured: false,
    flow: { status: 'idle' },
    mode: 'oauth',
    providers,
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false,
    freeTierReady: false
  } satisfies DesktopOnboardingState)
}

const ctx: OnboardingContext = { requestGateway: async () => undefined as never }

afterEach(() => {
  cleanup()

  try {
    window.localStorage.clear()
  } catch {
    // jsdom localStorage should always be present; ignore if not.
  }

  $desktopOnboarding.set({
    configured: null,
    flow: { status: 'idle' },
    mode: 'oauth',
    providers: null,
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false,
    freeTierReady: false
  })
})

describe('onboarding Picker', () => {
  it('features Nous Portal and hides other providers behind a disclosure', () => {
    setProviders([makeOAuthProvider('anthropic', 'Anthropic Claude'), makeOAuthProvider('nous', 'Nous Portal')])
    render(<Picker ctx={ctx} />)

    expect(screen.getByText('Nous Portal')).toBeTruthy()
    expect(screen.getByText('Recommended')).toBeTruthy()
    // Fireworks stays behind the disclosure with the other alternatives; only
    // Nous Portal is visible before the user expands the list.
    expect(screen.queryByText('Fireworks AI')).toBeNull()
    expect(screen.queryByText('Anthropic API Key')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Other providers' }))

    expect(screen.getByText('Fireworks AI')).toBeTruthy()
    expect(screen.getByText('Anthropic API Key')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy()
  })

  it('shows every provider directly when Nous Portal is absent', () => {
    setProviders([
      makeOAuthProvider('anthropic', 'Anthropic Claude'),
      makeOAuthProvider('openai-codex', 'OpenAI Codex / ChatGPT')
    ])
    render(<Picker ctx={ctx} />)

    expect(screen.getByText('Fireworks AI')).toBeTruthy()
    expect(screen.getByText('Anthropic API Key')).toBeTruthy()
    expect(screen.getByText('ChatGPT or Codex Subscription')).toBeTruthy()
    expect(screen.queryByText('Other sign-in options')).toBeNull()
    expect(screen.queryByText('Recommended')).toBeNull()
  })

  it('offers "choose later" on first run and persists the skip', () => {
    setProviders([makeOAuthProvider('nous', 'Nous Portal')])
    render(<Picker ctx={ctx} />)

    const skip = screen.getByRole('button', { name: "I'll choose a provider later" })

    fireEvent.click(skip)

    expect($desktopOnboarding.get().firstRunSkipped).toBe(true)
    expect(window.localStorage.getItem('hermes-onboarding-skipped-v1')).toBe('1')
  })

  it('hides "choose later" in manual (add-provider) mode', () => {
    setProviders([makeOAuthProvider('nous', 'Nous Portal')])
    $desktopOnboarding.set({ ...$desktopOnboarding.get(), manual: true })
    render(<Picker ctx={ctx} />)

    expect(screen.queryByRole('button', { name: "I'll choose a provider later" })).toBeNull()
  })

  it('localizes the fallback description for a dynamically discovered provider', () => {
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <ApiKeyForm
          canGoBack={false}
          onBack={() => undefined}
          onSave={async () => ({ ok: true })}
          options={[
            {
              docsUrl: '',
              envKey: 'WIDGETAI_API_KEY',
              id: 'widgetai',
              name: 'WidgetAI'
            }
          ]}
        />
      </I18nProvider>
    )

    expect(screen.getByText('直接访问 WidgetAI 的 API。')).toBeTruthy()
    expect(screen.queryByText('Direct API access to WidgetAI.')).toBeNull()
  })

  it('localizes the local endpoint title without changing its technical option id', () => {
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <ApiKeyForm
          canGoBack={false}
          initialEnvKey="OPENAI_BASE_URL"
          onBack={() => undefined}
          onSave={async () => ({ ok: true })}
          options={[
            {
              docsUrl: '',
              envKey: 'OPENAI_BASE_URL',
              id: 'local',
              name: 'Local / custom endpoint'
            }
          ]}
        />
      </I18nProvider>
    )

    expect(screen.getByText('本地 / 自定义端点')).toBeTruthy()
    expect(screen.queryByText('Local / custom endpoint')).toBeNull()
    expect(screen.getByPlaceholderText('API 密钥（可选 — 仅当端点需要时填写）')).toBeTruthy()
  })
})
