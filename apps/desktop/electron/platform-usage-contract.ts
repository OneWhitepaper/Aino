import type { PlatformUsagePage, PlatformUsageQuery, PlatformUsageRow } from '../shared/platform-contract'

function invalid(code = 'invalid_response'): never {
  throw Object.assign(new Error(code), { code })
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid()
  }

  return value as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= 1024 ? value : invalid()
}

function nullableText(value: unknown): string | null {
  return value == null ? null : text(value)
}

function integer(value: unknown, min = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min ? value : invalid()
}

export function parsePlatformUsageQuery(raw: unknown): PlatformUsageQuery {
  const input = object(raw)
  const page = integer(input.page, 1)
  const pageSize = integer(input.page_size, 1)

  if (page > 10000 || pageSize > 100) {
    return invalid('invalid_platform_input')
  }

  const query: PlatformUsageQuery = { page, page_size: pageSize }

  for (const key of [
    'model',
    'timezone',
    'session_id',
    'desktop_turn_id',
    'desktop_call_id',
    'desktop_purpose',
    'start_date',
    'end_date'
  ] as const) {
    if (input[key] === undefined) {
      continue
    }

    const value = text(input[key])

    if (
      !value ||
      value.length > 255 ||
      [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ) {
      return invalid('invalid_platform_input')
    }

    query[key] = value
  }

  return query
}

export function parsePlatformUsagePage(value: unknown): PlatformUsagePage {
  const data = object(value)

  if (!Array.isArray(data.items) || data.items.length > 100) {
    return invalid()
  }

  const items = data.items.map((value): PlatformUsageRow => {
    const row = object(value)
    const status = row.settlement_status

    if (
      typeof status !== 'string' ||
      !['pending', 'settled', 'not_charged', 'unknown'].includes(status) ||
      row.currency !== 'USD'
    ) {
      return invalid()
    }

    const amount = nullableText(row.actual_cost_decimal)

    if (amount !== null && !/^\d{1,12}(\.\d{1,8})?$/.test(amount)) {
      return invalid()
    }

    if ((status === 'settled' || status === 'not_charged') && amount === null) {
      return invalid()
    }

    if (status === 'not_charged' && amount !== null && /[1-9]/.test(amount)) {
      return invalid()
    }

    const created = text(row.created_at)

    if (!Number.isFinite(Date.parse(created))) {
      return invalid()
    }

    const id = typeof row.id === 'string' && /^\d+$/.test(row.id) ? row.id : String(integer(row.id, 1))

    return {
      id,
      request_id: text(row.request_id ?? ''),
      model: text(row.model),
      session_id: nullableText(row.session_id),
      desktop_turn_id: nullableText(row.desktop_turn_id),
      desktop_call_id: nullableText(row.desktop_call_id),
      desktop_purpose: nullableText(row.desktop_purpose),
      actual_cost_decimal: status === 'settled' || status === 'not_charged' ? amount : null,
      currency: 'USD',
      settlement_status: status as PlatformUsageRow['settlement_status'],
      created_at: created,
      input_tokens: row.input_tokens == null ? null : integer(row.input_tokens),
      output_tokens: row.output_tokens == null ? null : integer(row.output_tokens),
      cache_creation_tokens: row.cache_creation_tokens == null ? null : integer(row.cache_creation_tokens),
      cache_read_tokens: row.cache_read_tokens == null ? null : integer(row.cache_read_tokens)
    }
  })

  const result: PlatformUsagePage = {
    items,
    page: integer(data.page, 1),
    page_size: integer(data.page_size, 1),
    total: integer(data.total)
  }

  if (data.supported_desktop_purposes !== undefined) {
    if (!Array.isArray(data.supported_desktop_purposes) || data.supported_desktop_purposes.length > 64) {
      return invalid()
    }

    result.supported_desktop_purposes = data.supported_desktop_purposes.map(value => {
      const purpose = text(value)

      return /^[a-z][a-z0-9_]{0,31}$/.test(purpose) ? purpose : invalid()
    })
  }

  return result
}
