import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { deferred } from '@/test/deferred'

import { useKeychainEncryption } from './keychain-encryption-setting'

vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('shows the real native policy after a partial rewrite fails', async () => {
  const get = vi.fn().mockResolvedValueOnce({ on: false }).mockResolvedValue({ on: true })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      getSecretStorageEncryption: get,
      setSecretStorageEncryption: vi.fn().mockRejectedValue(new Error('second store is busy'))
    }
  })
  const { result } = renderHook(useKeychainEncryption)
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
  await act(async () => {
    await result.current.set(true)
  })
  expect(result.current.on).toBe(true)
  expect(result.current.busy).toBe(false)
  expect(get).toHaveBeenCalledTimes(2)
})

it('does not let the initial policy read overwrite a newer user change', async () => {
  const initial = deferred<{ on: boolean }>()
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      getSecretStorageEncryption: vi.fn().mockReturnValue(initial.promise),
      setSecretStorageEncryption: vi.fn().mockResolvedValue({ on: true })
    }
  })
  const { result } = renderHook(useKeychainEncryption)
  await act(async () => {
    await result.current.set(true)
  })
  await act(async () => {
    initial.resolve({ on: false })
  })
  expect(result.current.on).toBe(true)
})
