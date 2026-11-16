import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('links the real browser preview renderer without requiring native Node capabilities', async () => {
  await expect(
    build({
      entryPoints: [fileURLToPath(new URL('../src/app/chat/right-rail/preview-pane.tsx', import.meta.url))],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      packages: 'external',
      logLevel: 'silent',
      loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
      plugins: [
        {
          name: 'browser-host-capabilities',
          setup(builder) {
            builder.onResolve({ filter: /^node:/ }, args => ({
              errors: [{ text: `Browser preview cannot load native capability ${args.path}` }]
            }))
          }
        }
      ]
    })
  ).resolves.toMatchObject({ errors: [] })
})
