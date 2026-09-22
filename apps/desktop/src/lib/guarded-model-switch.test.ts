import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  notify: vi.fn(() => 'notification-1'),
  notifyError: vi.fn()
}))

vi.mock('@/store/notifications', () => mocks)
vi.mock('@/store/confirm', () => ({ confirm: mocks.confirm }))

import { setRuntimeI18nLocale } from '@/i18n'

import { surfaceModelSwitchConfirm } from './guarded-model-switch'

describe('guarded model switch copy', () => {
  beforeEach(() => {
    setRuntimeI18nLocale('zh')
    mocks.confirm.mockClear()
  })

  afterEach(() => {
    setRuntimeI18nLocale('en')
  })

  it('localizes the fallback confirmation message for Simplified Chinese', async () => {
    await surfaceModelSwitchConfirm({
      failureMessage: '模型切换失败',
      requestConfirmed: async () => undefined
    })

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: '此模型切换需要确认。',
        title: '切换模型？'
      })
    )
  })
})
