import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { getLocalHardware } from '@/hermes'
import type * as HermesApi from '@/hermes'

import { SystemResourcesSettings } from './system-resources-settings'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<typeof HermesApi>()),
  getLocalHardware: vi.fn()
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

  return render(
    <QueryClientProvider client={client}>
      <SystemResourcesSettings />
    </QueryClientProvider>
  )
}

it('shows measured memory, leaves unsupported GPU usage unavailable, and stops polling when closed', async () => {
  vi.spyOn(window.document, 'hasFocus').mockReturnValue(true)
  vi.mocked(getLocalHardware).mockResolvedValue({
    ram_total_bytes: 16 * 2 ** 30,
    ram_available_bytes: 4 * 2 ** 30,
    gpu_name: 'Test GPU',
    gpu_util_percent: null,
    vram_used_bytes: null,
    vram_total_bytes: 8 * 2 ** 30,
    vram_usable_bytes: 8 * 2 ** 30,
    vram_label: '8 GB',
    uma: false
  })
  const view = mount()
  expect(await screen.findByText('12.0 GB / 16.0 GB')).toBeTruthy()
  expect(screen.queryByText('0%')).toBeNull()
  vi.useFakeTimers()
  view.unmount()
  const requests = vi.mocked(getLocalHardware).mock.calls.length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(getLocalHardware).toHaveBeenCalledTimes(requests)
})

it('offers retry after a failed resource request without a permanent spinner', async () => {
  vi.mocked(getLocalHardware)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      ram_total_bytes: 8 * 2 ** 30,
      ram_available_bytes: 4 * 2 ** 30,
      gpu_name: null,
      gpu_util_percent: null,
      vram_used_bytes: null,
      vram_total_bytes: 0,
      vram_usable_bytes: 0,
      vram_label: '',
      uma: false
    })
  mount()
  const retry = await screen.findByRole('button', { name: 'Retry' })
  fireEvent.click(retry)
  expect(await screen.findByText('4.0 GB / 8.0 GB')).toBeTruthy()
})

it('reports shared memory once when separate GPU counters are unavailable', async () => {
  vi.mocked(getLocalHardware).mockResolvedValue({
    ram_total_bytes: 24 * 2 ** 30,
    ram_available_bytes: 8 * 2 ** 30,
    gpu_name: 'Apple M5 Pro',
    gpu_util_percent: null,
    vram_used_bytes: null,
    vram_total_bytes: 24 * 2 ** 30,
    vram_usable_bytes: 6 * 2 ** 30,
    vram_label: '24 GB',
    uma: true
  })
  mount()

  expect(await screen.findByText('Apple M5 Pro')).toBeTruthy()
  expect(screen.getByRole('meter', { name: 'Unified memory' })).toBeTruthy()
  expect(screen.getByText('16.0 GB / 24.0 GB')).toBeTruthy()
  expect(screen.queryByText('\u2014 / 24.0 GB')).toBeNull()
})
