import { EventEmitter } from 'node:events'

import type { MessageBoxOptions } from 'electron'
import { expect, it } from 'vitest'

import { notifyHandoffResult } from './handoff-notification'
import type { HandoffResult } from './handoff-result'

class NotificationWindow extends EventEmitter {
  visible = false
  destroyed = false

  isVisible() {
    return this.visible
  }

  isDestroyed() {
    return this.destroyed
  }

  show() {
    this.visible = true
    this.emit('show')
  }

  close() {
    this.destroyed = true
    this.emit('closed')
  }
}

const manualResult: HandoffResult = {
  ok: true,
  manual: true,
  exitCode: 0,
  message: 'Reopen the updated app to finish.',
  branch: 'main',
  warnings: []
}

const failedResult: HandoffResult = {
  ok: false,
  manual: false,
  exitCode: 1,
  message: 'The updated app could not be built.',
  branch: 'main',
  warnings: []
}

it('shows update notices once on a visible parent without waiting for acknowledgement', () => {
  for (const result of [manualResult, failedResult]) {
    for (const initiallyVisible of [false, true]) {
      const window = new NotificationWindow()
      window.visible = initiallyVisible
      const shown: MessageBoxOptions[] = []
      const logs: string[] = []

      const returned = notifyHandoffResult(result, {
        window,
        appName: 'Aino',
        logPath: '/fixture/desktop-update-handoff.log',
        log: message => logs.push(message),
        showMessageBox: (parent, options) => {
          expect(parent).toBe(window)
          expect(parent.isVisible()).toBe(true)
          shown.push(options)

          // A user may leave the notice open while the backend finishes booting.
          return new Promise(() => {})
        }
      })

      expect(returned).toBeUndefined()
      expect(shown).toHaveLength(initiallyVisible ? 1 : 0)
      window.show()
      window.show()
      expect(shown).toHaveLength(1)
      expect(shown[0].type).toBe(result.ok ? 'warning' : 'error')
      expect(shown[0].detail).toContain(result.message)
      expect(logs.some(message => message.includes(result.message))).toBe(true)

      if (!result.ok) {
        expect(shown[0].detail).toContain('/fixture/desktop-update-handoff.log')
      }
    }
  }
})

it('keeps cancelled or failed notices out of the startup failure path', async () => {
  const window = new NotificationWindow()
  const logs: string[] = []
  let presentations = 0

  const options = {
    window,
    appName: 'Aino',
    logPath: '/fixture/desktop-update-handoff.log',
    log: (message: string) => logs.push(message),
    showMessageBox: async () => {
      presentations++
      throw new Error('native notice failed')
    }
  }

  notifyHandoffResult(manualResult, options)
  window.close()
  window.emit('show')
  expect(presentations).toBe(0)
  expect(window.listenerCount('show')).toBe(0)
  expect(window.listenerCount('closed')).toBe(0)

  const liveWindow = new NotificationWindow()
  liveWindow.show()
  notifyHandoffResult(failedResult, { ...options, window: liveWindow })
  await Promise.resolve()
  expect(presentations).toBe(1)
  expect(logs.some(message => message.includes('native notice failed'))).toBe(true)

  notifyHandoffResult(null, { ...options, window: liveWindow })
  notifyHandoffResult({ ...manualResult, manual: false }, { ...options, window: liveWindow })
  expect(presentations).toBe(1)
})
