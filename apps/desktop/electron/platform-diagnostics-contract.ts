import { gunzipSync } from 'node:zlib'

import type { PlatformDiagnosticReceipt } from '../shared/platform-contract'

import { PlatformClientError } from './platform-client'
import { parsePlatformDeviceId } from './platform-device-contract'

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

export function parseDiagnosticReceipt(value: unknown): PlatformDiagnosticReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformClientError('invalid_response')
  }

  const row = value as Record<string, unknown>

  for (const name of ['created_at', 'expires_at']) {
    if (typeof row[name] !== 'string' || !Number.isFinite(Date.parse(row[name]))) {
      throw new PlatformClientError('invalid_response')
    }
  }

  if (
    !Number.isSafeInteger(row.size_bytes) ||
    (row.size_bytes as number) < 1 ||
    (row.size_bytes as number) > MAX_BUNDLE_BYTES
  ) {
    throw new PlatformClientError('invalid_response')
  }

  return {
    id: parsePlatformDeviceId(row.id, 'invalid_response'),
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    size_bytes: row.size_bytes as number
  }
}
