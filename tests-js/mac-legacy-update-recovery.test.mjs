import { expect, test, vi } from 'vitest'
import updateUi from '../tests/install/e2e-assets/update-ui.cjs'

function scenario({ text = 'macOS update verification timed out.', allow = true } = {}) {
  let closes = 0
  let clicks = 0
  const closed = async () => {
    closes++
    if (closes === 1) throw new Error('Electron process did not close after update hand-off')
  }
  const page = {
    getByText: (value, options) => ({ isVisible: async () => options.exact && value === text }),
    getByRole: (role, options) => ({ click: async () => {
      expect(role).toBe('button')
      expect(options).toEqual({ name: 'Try again', exact: true })
      clicks++
    } }),
  }
  return { page, closed, allow, log: vi.fn(), shot: vi.fn(), counts: () => ({ closes, clicks }) }
}

test('legacy recovery uses the visible retry once and reports that the first apply failed', async () => {
  const f = scenario()
  const result = await updateUi.waitForMacUpdateClose(f.page, f.closed, { ...f, timeoutMs: 420000 })
  expect(result).toEqual({ applyAttempts: 2, verificationTimeoutObserved: true })
  expect(f.counts()).toEqual({ closes: 2, clicks: 1 })
  expect(f.shot).toHaveBeenCalledWith(f.page, '06-legacy-verification-timeout')
})

test.each([{ allow: false }, { text: 'Signature invalid' }])('does not retry a strict gate or an unrelated error: %j', async options => {
  const f = scenario(options)
  await expect(updateUi.waitForMacUpdateClose(f.page, f.closed, { ...f, timeoutMs: 420000 })).rejects.toThrow('Electron process did not close')
  expect(f.counts()).toEqual({ closes: 1, clicks: 0 })
})
