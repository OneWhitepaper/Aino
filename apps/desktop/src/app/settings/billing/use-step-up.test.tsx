import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

const apiMocks = vi.hoisted(() => ({
  stepUp: vi.fn()
}))

const gatewayMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: unknown) => void>>()

  const gateway = {
    on: vi.fn((eventName: string, handler: (event: unknown) => void) => {
      let set = handlers.get(eventName)

      if (!set) {
        set = new Set()
        handlers.set(eventName, set)
      }

      set.add(handler)

      return () => set?.delete(handler)
    })
  }

  return {
    count: (eventName: string) => handlers.get(eventName)?.size ?? 0,
    emit: (eventName: string, event: unknown) => {
      handlers.get(eventName)?.forEach(handler => handler(event))
    },
    gateway,
    reset: () => {
      handlers.clear()
      gateway.on.mockClear()
    }
  }
})

vi.mock('@/store/gateway', async () => {
  const { atom } = (await vi.importActual('nanostores')) as { atom: (value: unknown) => unknown }

  return {
    $gateway: atom(gatewayMock.gateway)
  }
})

vi.mock('./api', () => ({
  useBillingApi: () => ({
    stepUp: apiMocks.stepUp
  })
}))

import { useStepUpFlow } from './use-step-up'

function createWrapper(client: QueryClient, locale: 'en' | 'zh' = 'en') {
  return function wrapper({ children }: PropsWithChildren) {
    return createElement(I18nProvider, {
      configClient: null,
      initialLocale: locale,
      children: createElement(QueryClientProvider, { client }, children)
    })
  }
}

beforeEach(() => {
  apiMocks.stepUp.mockReset()
  gatewayMock.reset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useStepUpFlow', () => {
  it('subscribes for verification, opens the verification URL, cleans up, and invalidates on completion', async () => {
    let resolveStepUp: (value: unknown) => void = () => {}

    const stepUpPromise = new Promise(resolve => {
      resolveStepUp = resolve
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    apiMocks.stepUp.mockReturnValue(stepUpPromise)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        openExternal: vi.fn()
      }
    })

    const { result, unmount } = renderHook(() => useStepUpFlow(), { wrapper: createWrapper(client) })

    act(() => {
      void result.current.start()
    })

    expect(result.current.phase).toBe('waiting')
    expect(gatewayMock.count('billing.step_up.verification')).toBe(1)

    act(() => {
      gatewayMock.emit('billing.step_up.verification', {
        payload: {
          user_code: 'ABCD-1234',
          verification_url: 'https://portal.nousresearch.com/device'
        },
        type: 'billing.step_up.verification'
      })
    })

    expect(result.current.phase).toBe('verifying')
    expect(result.current.verification).toEqual({
      code: 'ABCD-1234',
      url: 'https://portal.nousresearch.com/device'
    })

    result.current.openVerification()
    expect(window.hermesDesktop?.openExternal).toHaveBeenCalledWith('https://portal.nousresearch.com/device')

    await act(async () => {
      resolveStepUp({ data: { granted: true, ok: true }, ok: true })
      await stepUpPromise
    })

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing', 'state'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing', 'subscription'] })
    })

    unmount()
    expect(gatewayMock.count('billing.step_up.verification')).toBe(0)
  })

  it('localizes a declined verification result in Simplified Chinese', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    apiMocks.stepUp.mockResolvedValue({ data: { granted: false, ok: true }, ok: true })

    const { result } = renderHook(() => useStepUpFlow(), { wrapper: createWrapper(client, 'zh') })

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.message).toEqual({
      kind: 'error',
      text: '验证完成，但未允许此终端使用远程消费。',
      title: '验证未获批准'
    })
  })

  it('localizes an approved verification result in Simplified Chinese', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    apiMocks.stepUp.mockResolvedValue({ data: { granted: true, ok: true }, ok: true })

    const { result } = renderHook(() => useStepUpFlow(), { wrapper: createWrapper(client, 'zh') })

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.message).toEqual({
      kind: 'success',
      text: '此终端已允许使用远程消费。',
      title: '验证完成'
    })
  })
})
