import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it } from 'vitest'

import { beginBackendTransition, resetBackendTransitionsForTests } from '@/store/backend-transition'
import { setConnection, setGatewayState } from '@/store/session'

import { ComposerScopeProvider, MAIN_COMPOSER_SCOPE } from '../scope'

import { controlsDisabled, useComposerConnection } from './use-composer-connection'

afterEach(() => {
  resetBackendTransitionsForTests()
  setConnection(null)
})

it.each(['starting', 'restarting', 'stopping'] as const)(
  'a local %s transition never holds a same-named remote composer',
  kind => {
    setGatewayState('open')
    beginBackendTransition('default', kind, { source: 'switch' })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ComposerScopeProvider value={{ ...MAIN_COMPOSER_SCOPE, connectionId: 'remote-box', profile: 'default' }}>
        {children}
      </ComposerScopeProvider>
    )

    const { result } = renderHook(() => useComposerConnection(false, 'default'), { wrapper })

    expect(result.current.backendTransition).toBeNull()
    expect(controlsDisabled(result.current.disabled, result.current.backendTransition)).toBe(false)
  }
)

it('does not hold a legacy remote composer for a same-named local transition', () => {
  setGatewayState('open')
  setConnection({ mode: 'remote', profile: 'default', baseUrl: 'https://remote.invalid' } as never)
  beginBackendTransition('default', 'starting', { source: 'switch' })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ComposerScopeProvider value={{ ...MAIN_COMPOSER_SCOPE, connectionId: null, profile: 'default' }}>
      {children}
    </ComposerScopeProvider>
  )

  const { result } = renderHook(() => useComposerConnection(false, 'default'), { wrapper })

  expect(result.current.backendTransition).toBeNull()
  expect(controlsDisabled(result.current.disabled, result.current.backendTransition)).toBe(false)
})
