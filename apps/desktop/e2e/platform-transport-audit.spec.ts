import { EventEmitter } from 'node:events'

import { observeDebuggerDetach } from './platform-real-api'
import { expect, test } from './test'

test('transport observer accepts retirement only after webContents destruction', async () => {
  const app = new EventEmitter()
  const errors: string[] = []
  let destroyed = false
  const contents = Object.assign(new EventEmitter(), { debugger: new EventEmitter(), isDestroyed: () => destroyed })
  observeDebuggerDetach(contents, app, error => errors.push(error))

  contents.debugger.emit('detach')
  destroyed = true
  contents.emit('destroyed')
  await new Promise<void>(resolve => setImmediate(resolve))

  expect(errors).toEqual([])
})

test('transport observer rejects detach while webContents remains alive', async () => {
  const app = new EventEmitter()
  const errors: string[] = []
  const contents = Object.assign(new EventEmitter(), { debugger: new EventEmitter(), isDestroyed: () => false })
  observeDebuggerDetach(contents, app, error => errors.push(error))

  contents.debugger.emit('detach')
  await new Promise<void>(resolve => setImmediate(resolve))

  expect(errors).toEqual(['unexpected-detach'])
})
