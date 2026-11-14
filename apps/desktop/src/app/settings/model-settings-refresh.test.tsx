import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'

import { useSettingsAuxiliaryData } from './model-settings-refresh'

it('uses config-only main assignment until the catalog is ready without exposing a prior settings owner', () => {
  const configured = { provider: 'custom:relay', model: 'my-model' }
  const applied = { provider: 'official', model: 'new-default' }

  const { result, rerender } = renderHook(
    ({ owner, main }) => useSettingsAuxiliaryData(owner, main),
    { initialProps: { owner: 'account-a/default', main: null as typeof applied | null } }
  )

  act(() => result.current.setAuxiliary({ main: configured, tasks: [] }))
  expect(result.current.mainModel).toEqual(configured)
  rerender({ owner: 'account-a/default', main: applied })
  expect(result.current.mainModel).toEqual(applied)
  rerender({ owner: 'account-b/default', main: null })
  expect(result.current.auxiliary).toBeUndefined()
  expect(result.current.mainModel).toBeNull()
})
