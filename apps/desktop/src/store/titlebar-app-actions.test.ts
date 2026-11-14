import { describe, expect, it } from 'vitest'

import { titlebarAppActionsClusterCounts } from './titlebar-app-actions'

describe('titlebarAppActionsClusterCounts', () => {
  it('adds contributions to the cluster they belong to without reserving removed controls', () => {
    const base = titlebarAppActionsClusterCounts()

    expect(base).toEqual({ left: 3, right: 5 })
    expect(titlebarAppActionsClusterCounts(1, 2)).toEqual({ left: base.left + 1, right: base.right + 2 })
  })

  it('releases instrumentation space in Simple mode while keeping navigation and notifications', () => {
    expect(titlebarAppActionsClusterCounts(0, 0, 'simple')).toEqual({ left: 3, right: 1 })
  })
})
