import { runInNewContext } from 'node:vm'

import { expect, test, vi } from 'vitest'

import { prepareSmokeWindow } from '../../tests/install/e2e-assets/desktop-smoke.ts'

import type { ElectronApplication, Page } from './e2e-driver-deps.ts'

function renderer(name: string, authorized: boolean, persistentZoom = true) {
  const zoomWrites: number[] = []
  const listeners = new Map<string, (error: Error) => void>()

  const zoom = {
    setPercent: (percent: number): void => { zoomWrites.push(percent) },
    get: async (): Promise<{ percent: number }> => {
      if (!authorized) { throw new Error('account_workspace_unavailable') }

      return { percent: 100 }
    }
  }

  const realm = {
    document: { querySelector: (): object => ({}) },
    hermesDesktop: persistentZoom ? { zoom } : {},
  }

  const page = {
    evaluate: async (callback: () => unknown): Promise<unknown> => runInNewContext(`(${callback.toString()})()`, realm),
    waitForLoadState: async (): Promise<void> => {},
    url: (): string => `app:///${name}`,
    on: (event: string, listener: (error: Error) => void): void => { listeners.set(event, listener) },
  } as unknown as Page

  return { page, zoomWrites, listeners }
}

function desktop(initialPage: Page) {
  const zoomLevels: number[] = []

  const browserWindow = vi.fn(async (_page: Page) => ({
    evaluate: async (callback: (window: { webContents: object }) => unknown): Promise<unknown> => callback({
      webContents: {
        getZoomFactor: (): number => 1,
        setZoomLevel: (level: number): void => { zoomLevels.push(level) },
      }
    }),
  }))

  const app = {
    firstWindow: async (): Promise<Page> => initialPage,
    windows: (): Page[] => [initialPage],
    browserWindow,
  } as unknown as ElectronApplication

  return { app, browserWindow, zoomLevels }
}

test('packaged smoke signs in before using workspace IPC and prepares the replacement renderer', async (): Promise<void> => {
  const login = renderer('login', false)
  const workspace = renderer('account-workspace', true)
  const { app, browserWindow } = desktop(login.page)
  const log = vi.fn()
  const account = { signIn: vi.fn(async (_app: ElectronApplication, _page: Page): Promise<Page> => workspace.page) }

  const page = await prepareSmokeWindow(app, account, log)

  expect(account.signIn).toHaveBeenCalledWith(app, login.page)
  expect(page).toBe(workspace.page)
  expect(login.zoomWrites).toEqual([])
  expect(workspace.zoomWrites).not.toEqual([])
  expect(browserWindow).toHaveBeenCalledWith(workspace.page)
  workspace.listeners.get('pageerror')?.(new Error('workspace-renderer-error'))
  expect(log).toHaveBeenCalledWith('workspace-renderer-error')
})

test('packaged smoke without account login still prepares older renderers without a zoom bridge', async (): Promise<void> => {
  const workspace = renderer('legacy-workspace', true, false)
  const { app, browserWindow, zoomLevels } = desktop(workspace.page)

  const page = await prepareSmokeWindow(app, undefined, vi.fn())

  expect(page).toBe(workspace.page)
  expect(browserWindow).toHaveBeenCalledWith(workspace.page)
  expect(zoomLevels).toEqual([0])
})
