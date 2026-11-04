import { PlatformClientError } from './platform-client'
import type { PlatformDiagnosticReceipt } from './platform-contract'
import { parsePlatformDeviceId } from './platform-device-contract'

const MAX_BUNDLE_BYTES = 8 * 1024 * 1024

export function parseDiagnosticReceipt(value: unknown): PlatformDiagnosticReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new PlatformClientError('invalid_response') }

  const row = value as Record<string, unknown>

  for (const name of ['created_at', 'expires_at']) {
    if (typeof row[name] !== 'string' || !Number.isFinite(Date.parse(row[name]))) { throw new PlatformClientError('invalid_response') }
  }

  if (!Number.isSafeInteger(row.size_bytes) || (row.size_bytes as number) < 1 || (row.size_bytes as number) > MAX_BUNDLE_BYTES) {
    throw new PlatformClientError('invalid_response')
  }

  return { id: parsePlatformDeviceId(row.id, 'invalid_response'), created_at: row.created_at as string,
    expires_at: row.expires_at as string, size_bytes: row.size_bytes as number }
}
