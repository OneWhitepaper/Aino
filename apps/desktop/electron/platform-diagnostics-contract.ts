import { gunzipSync } from 'node:zlib'

import { PlatformClientError } from '../shared/platform-client'

const MAX_BUNDLE_BYTES = 8 * 1024 * 1024

export function validateDiagnosticBundle(value: unknown): string {
  try {
    if (typeof value !== 'string' || !value.length || value.length > Math.ceil(MAX_BUNDLE_BYTES / 3) * 4) {
      throw new Error('size')
    }

    const bytes = Buffer.from(value, 'base64')

    if (bytes.length > MAX_BUNDLE_BYTES || bytes.toString('base64') !== value) {
      throw new Error('base64')
    }

    const envelope = JSON.parse(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'))

    if (
      envelope?.format !== 'hermes-debug-share/1' ||
      envelope.redacted !== true ||
      typeof envelope.files?.report !== 'string'
    ) {
      throw new Error('envelope')
    }

    return value
  } catch {
    throw new PlatformClientError('invalid_diagnostics_bundle')
  }
}
