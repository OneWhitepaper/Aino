import { PlatformClientError } from './platform-client'
import type { PlatformDevice, PlatformDeviceInfo } from './platform-contract'

function deviceInfoText(value: unknown, limit: number, code: string): string {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value) || Array.from(value).length > limit || !value.trim()) {
    throw new PlatformClientError(code)
  }

  return value.trim()
}

export function parsePlatformDeviceInfo(value: unknown, code = 'invalid_response'): PlatformDeviceInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformClientError(code)
  }

  const info = value as Record<string, unknown>
  const name = deviceInfoText(info.installation_name, 80, code)
  const version = deviceInfoText(info.client_version, 64, code)

  if (
    !['macos', 'windows', 'linux'].includes(info.os as string) ||
    !['desktop', 'desktop_dev', 'browser'].includes(info.client_type as string)
  ) {
    throw new PlatformClientError(code)
  }

  return {
    installation_name: name,
    os: info.os as PlatformDeviceInfo['os'],
    client_type: info.client_type as PlatformDeviceInfo['client_type'],
    client_version: version
  }
}

export function parsePlatformDeviceId(value: unknown, code = 'invalid_platform_input'): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new PlatformClientError(code)
  }

  return value.toLowerCase()
}

function deviceDetails(row: {
  device_info?: unknown
  credential_type?: unknown
}): Pick<PlatformDevice, 'device_info' | 'credential_type'> {
  const type = row.credential_type

  if (type !== undefined && type !== 'device' && type !== 'lease') {
    throw new PlatformClientError('invalid_response')
  }

  return {
    ...(row.device_info !== undefined && row.device_info !== null
      ? { device_info: parsePlatformDeviceInfo(row.device_info) }
      : {}),
    ...(type !== undefined ? { credential_type: type as PlatformDevice['credential_type'] } : {})
  }
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
      if (field === 'expires_at' && row[field] === null) {
        continue
      }

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
      ...(row.status !== undefined ? { status: row.status } : {}),
      ...deviceDetails(row)
    }
  })
}
