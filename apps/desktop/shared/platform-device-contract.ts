import { PlatformClientError } from './platform-client'
import type { PlatformDevice } from './platform-contract'

export function parsePlatformDeviceId(value: unknown, code = 'invalid_platform_input'): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new PlatformClientError(code)
  }

  return value.toLowerCase()
}

export function parsePlatformDevices(value: unknown): PlatformDevice[] {
  if (!Array.isArray(value)) {
    throw new PlatformClientError('invalid_response')
  }

  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.revoked !== 'boolean') {
      throw new PlatformClientError('invalid_response')
    }

    for (const field of ['last_used_at', 'expires_at']) {
      if (typeof row[field] !== 'string' || !Number.isFinite(Date.parse(row[field]))) {
        throw new PlatformClientError('invalid_response')
      }
    }

    if (row.status !== undefined && row.status !== 'active' && row.status !== 'expired' && row.status !== 'revoked') {
      throw new PlatformClientError('invalid_response')
    }

    return {
      device_id: parsePlatformDeviceId(row.device_id, 'invalid_response'),
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
      revoked: row.revoked,
      ...(row.status !== undefined ? { status: row.status } : {})
    }
  })
}
