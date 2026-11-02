import type { PlatformModel, PlatformModelPricing } from '../shared/platform-contract'
import { PLATFORM_IMAGE_QUALITIES } from '../shared/platform-contract'

// Parse only public fields; arbitrary server fields never reach the renderer.
function invalid(): never {
  throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' })
}

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid()
  }

  return value as Record<string, unknown>
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : invalid()
}

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid()
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : invalid()
}

function nullable<T>(value: unknown, parse: (v: unknown) => T): T | null {
  return value === null ? null : parse(value)
}

function array<T>(value: unknown, parse: (v: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalid()
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  return choices.includes(value as T) ? (value as T) : invalid()
}

function prices(value: Record<string, unknown>) {
  return {
    input: nullable(value.input, str),
    output: nullable(value.output, str),
    cache_read: nullable(value.cache_read, str),
    cache_write: nullable(value.cache_write, str)
  }
}

function pricing(value: unknown): PlatformModelPricing {
  const p = obj(value)

  return {
    ...prices(p),
    currency: str(p.currency),
    unit: str(p.unit),
    effective_user_rate: str(p.effective_user_rate),
    detail_available: bool(p.detail_available),
    tiers: array(p.tiers, value => {
      const t = obj(value)

      return {
        ...prices(t),
        min_tokens: num(t.min_tokens),
        max_tokens: nullable(t.max_tokens, num),
        label: str(t.label),
        cache_write_1h: nullable(t.cache_write_1h, str)
      }
    }),
    time_pricing: nullable(p.time_pricing, value => {
      const t = obj(value)

      return {
        timezone: str(t.timezone),
        weekdays_only: bool(t.weekdays_only),
        periods: array(t.periods, value => {
          const p = obj(value)

          return { start_time: str(p.start_time), end_time: str(p.end_time), multiplier: str(p.multiplier) }
        })
      }
    }),
    group_peak: nullable(p.group_peak, value => {
      const p = obj(value)

      return { start: str(p.start), end: str(p.end), multiplier: str(p.multiplier) }
    })
  }
}

export function parsePlatformModel(value: unknown): PlatformModel {
  const m = obj(value),
    c = obj(m.capabilities)

  const id = str(m.id),
    model = str(m.model)

  if (!id || !model) {
    return invalid()
  }

  const apiMode = choice(m.api_mode, [
    'chat_completions',
    'responses',
    'anthropic_messages',
    'images_generations'
  ] as const)

  const purpose = m.purpose === undefined ? 'chat' : choice(m.purpose, ['chat', 'image'] as const)
  const imageGeneration = c.image_generation === undefined ? false : bool(c.image_generation)

  const qualities =
    c.image_quality_options === undefined
      ? []
      : array(c.image_quality_options, value => choice(value, PLATFORM_IMAGE_QUALITIES))

  if (
    (apiMode === 'images_generations') !== (purpose === 'image') ||
    (purpose === 'image' && !imageGeneration) ||
    (purpose !== 'image' && qualities.length > 0) ||
    new Set(qualities).size !== qualities.length
  ) {
    return invalid()
  }

  return {
    id,
    model,
    display_name: str(m.display_name),
    provider_label: str(m.provider_label),
    api_mode: apiMode,
    purpose,
    state: choice(m.state, ['available', 'insufficient_balance', 'quota_exhausted', 'unavailable'] as const),
    reason_code: nullable(m.reason_code, str),
    is_default: bool(m.is_default),
    context_window: nullable(m.context_window, num),
    max_output_tokens: nullable(m.max_output_tokens, num),
    capabilities: {
      tools: bool(c.tools),
      vision: bool(c.vision),
      reasoning: bool(c.reasoning),
      image_generation: imageGeneration,
      ...(qualities.length ? { image_quality_options: qualities } : {})
    },
    billing_source: choice(m.billing_source, ['balance', 'subscription'] as const),
    pricing: pricing(m.pricing)
  }
}
