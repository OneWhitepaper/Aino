import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const desktop = fileURLToPath(new URL('..', import.meta.url))

test('the installable Windows distribution admits Windows 10 22H2 and retains shared state access', () => {
  const config = JSON.parse(execFileSync(process.execPath, ['-e',
    "const c=require('./electron-builder.config.cjs'); console.log(JSON.stringify({win:c.win,msix:c.msix}))"
  ], { cwd: desktop, encoding: 'utf8', env: { ...process.env,
    HERMES_DESKTOP_VARIANT: 'bundled', HERMES_BUILD_COMMIT: '', HERMES_PAYLOAD_TAG: '',
    _HERMES_CHANNEL_REQUEST_JSON: '', AZURE_SIGN_PUBLISHER: 'CN=Aino Compatibility Fixture' } }))
  assert.ok(config.win.target.includes('msix'))
  assert.equal(config.msix.minVersion, '10.0.19045.0')
  assert.ok(config.msix.capabilities.includes('unvirtualizedResources'))
  assert.equal(config.msix.customExtensionsPath, 'build/msix-extensions.xml')
})
