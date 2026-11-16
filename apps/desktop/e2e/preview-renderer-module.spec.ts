import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { chromium, expect, test } from '@playwright/test'
import { createServer } from 'vite'

test('the preview pane loads as a browser module without native approval dependencies', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-renderer-vite-'))

  const server = await createServer({
    configFile: false,
    root: path.resolve(import.meta.dirname, '..'),
    cacheDir,
    // Exercise Vite's real client imports without running the app's optional
    // React compiler over its entire dependency prebundle.
    optimizeDeps: { entries: [path.resolve(import.meta.dirname, '../src/app/chat/right-rail/preview-pane.tsx')] },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '../src'),
        '@hermes/shared': path.resolve(import.meta.dirname, '../../shared/src'),
        '@hermes/plugin-sdk': path.resolve(import.meta.dirname, '../src/sdk/index.ts')
      }
    },
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
    plugins: [
      {
        name: 'preview-renderer-import-fixture',
        configureServer(vite) {
          vite.middlewares.use('/__preview_renderer_import__.html', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html')
            response.end(
              await vite.transformIndexHtml(
                '/__preview_renderer_import__.html',
                '<!doctype html><html><head><title>Preview renderer module</title></head><body>Preview renderer module</body></html>'
              )
            )
          })
        }
      }
    ]
  })

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

  try {
    await server.listen()
    browser = await chromium.launch({ executablePath: process.env.HERMES_E2E_CHROMIUM || undefined })
    const page = await browser.newPage()
    const errors: string[] = []

    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${server.resolvedUrls!.local[0]}__preview_renderer_import__.html`)

    const exported = await page.evaluate(async modulePath => {
      const module = await import(modulePath)

      return typeof module.PreviewPane
    }, '/src/app/chat/right-rail/preview-pane.tsx')

    expect(exported).toBe('function')
    expect(errors).toEqual([])
  } finally {
    await browser?.close()
    await server.close()
    await fs.rm(cacheDir, { recursive: true, force: true })
  }
})
