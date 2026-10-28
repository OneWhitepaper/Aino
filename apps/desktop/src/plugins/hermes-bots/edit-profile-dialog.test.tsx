import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $botMeta } from './data'
import { EditProfileDialog } from './edit-profile-dialog'
import { translateBots } from './i18n-test-helper'
import type * as ProfileConfig from './profile-config'

const mocks = vi.hoisted(() => ({ request: vi.fn(), notify: vi.fn(), notifyError: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, request: mocks.request, notify: mocks.notify, notifyError: mocks.notifyError },
    usePluginI18n: () => translateBots
  }
})

vi.mock('./avatar-picker', () => ({ AvatarPicker: () => null }))
vi.mock('./profile-config', async importOriginal => ({
  ...(await importOriginal<typeof ProfileConfig>()),
  AdvancedProfileConfig: () => null
}))

function Editor() {
  const [open, setOpen] = useState(true)

  return (
    <EditProfileDialog
      bot={{ name: 'default', title: 'Aino', description: 'Original introduction' }}
      onClose={() => setOpen(false)}
      open={open}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  $botMeta.set({})
})

afterEach(cleanup)

it('keeps the internal profile identifier in advanced details rather than the main introduction', () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Editor />
    </QueryClientProvider>
  )

  expect(screen.getByRole('dialog').textContent).not.toContain('default')
  fireEvent.click(screen.getByRole('button', { name: /^Advanced/ }))
  expect(screen.getByText('default')).not.toBeNull()
})

describe('saving a bot introduction', () => {
  it.each(['rejected', 'not-applied'])('retains edits when the description save is %s', async failure => {
    mocks.request.mockImplementation(async () => {
      if (failure === 'rejected') {
        throw new Error('Description could not be saved')
      }

      return { applied: { description: false } }
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Editor />
      </QueryClientProvider>
    )

    const description = screen.getAllByRole('textbox')[1]

    fireEvent.change(description, { target: { value: 'Updated Aino introduction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
    })
    expect((description as HTMLTextAreaElement).value).toBe('Updated Aino introduction')
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(mocks.notify.mock.calls.some(([notice]) => notice.kind === 'success')).toBe(false)

    mocks.request.mockResolvedValue({ applied: { description: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
