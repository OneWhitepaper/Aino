import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { CreateAgentModelSummary } from './create-agent-model-summary'
import { translateBots } from './i18n-test-helper'
import type { ProfileRoute } from './types'

const { effectiveModel } = vi.hoisted(() => ({ effectiveModel: vi.fn() }))
vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, profiles: { ...sdk.host.profiles, effectiveModel } },
    usePluginI18n: () => translateBots
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  effectiveModel.mockImplementation(async (_name, route) => ({ label: `${route.connectionId} model` }))
})
afterEach(cleanup)

const local: ProfileRoute = { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' }

it('reads the effective inherited model from the selected source and never reuses the previous source label', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const view = (route: ProfileRoute) => (
    <QueryClientProvider client={client}>
      <CreateAgentModelSummary cloneFrom="default" model="" open provider="" route={route} />
    </QueryClientProvider>
  )

  const rendered = render(view(local))
  expect(await screen.findByText('local model')).toBeTruthy()
  const studio: ProfileRoute = { ...local, connectionId: 'studio', mode: 'remote' }
  rendered.rerender(view(studio))
  expect(screen.queryByText('local model')).toBeNull()
  expect(await screen.findByText('studio model')).toBeTruthy()
  expect(effectiveModel).toHaveBeenCalledWith('default', studio)
})

it('shows a staged explicit model without claiming inheritance or reading the default', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateAgentModelSummary cloneFrom="default" model="custom-model" open provider="custom" route={local} />
    </QueryClientProvider>
  )
  expect(screen.getByText('custom-model')).toBeTruthy()
  expect(screen.queryByText('Inherit current default')).toBeNull()
  await waitFor(() => expect(effectiveModel).not.toHaveBeenCalled())
})
