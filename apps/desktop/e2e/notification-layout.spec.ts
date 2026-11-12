import path from 'node:path'

import { createServer, type ViteDevServer } from 'vite'

import { expect, type Page, test } from './test'

let server: ViteDevServer
let origin: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: path.resolve(import.meta.dirname, '../vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false }
  })
  await server.listen()
  origin = server.resolvedUrls!.local[0]
})

test.afterAll(async () => {
  await server?.close()
})

async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect()

      return { x, y, width, height }
    }

    const history = document.querySelector('[aria-label="History"]')!

    return {
      content: rect(document.querySelector('main')!),
      draft: rect(document.querySelector('textarea')!),
      history: rect(history),
      scrollTop: history.scrollTop,
      pageWidth: document.documentElement.scrollWidth
    }
  })
}

for (const placement of ['workspace', 'toolbar']) {
  test(`${placement} notifications never move content or lose the draft`, async ({ page }) => {
    for (const width of [1440, 720, 360]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`${origin}e2e/fixtures/notification-layout.html${placement === 'toolbar' ? '?toolbar' : ''}`)
      const draft = page.getByRole('textbox', { name: 'Draft' })

      await expect(draft).toHaveValue('Preserved draft')
      await page.getByLabel('History').evaluate(element => {
        element.scrollTop = 120
      })
      const before = await geometry(page)

      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByText('Your changes are saved', { exact: true }).last()).toBeVisible()
      expect(await geometry(page)).toEqual(before)
      await page.getByRole('button', { name: 'Details', exact: true }).click()
      const card = page.getByRole('dialog', { name: 'Notifications and status' })

      await expect(card).toBeVisible()
      expect(await geometry(page)).toEqual(before)
      const bounds = (await card.boundingBox())!

      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(800)
      await page.getByRole('button', { name: 'Close', exact: true }).click()
      await draft.fill('Still editing')
      await expect(draft).toHaveValue('Still editing')
      expect(await geometry(page)).toEqual(before)
    }
  })
}
