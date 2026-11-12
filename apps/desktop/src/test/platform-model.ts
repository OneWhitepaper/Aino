import type { PlatformAccountSnapshot, PlatformModel } from '../../shared/platform-contract'

export function platformSnapshot(id = 'user-a', revision = 1): PlatformAccountSnapshot {
  return {
    revision,
    phase: 'signed_in',
    account: { id, display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }
}

export function platformModel(id = 'catalog-a'): PlatformModel {
  return {
    id,
    model: 'wire-model',
    display_name: 'Fixture Model',
    provider_label: 'Fixture',
    api_mode: 'chat_completions',
    state: 'available',
    reason_code: null,
    is_default: true,
    context_window: 10000,
    max_output_tokens: 1000,
    capabilities: { tools: true, vision: false, reasoning: false },
    billing_source: 'balance',
    pricing: {
      currency: 'USD',
      unit: 'million_tokens',
      input: '1.20',
      output: '2.40',
      cache_read: null,
      cache_write: null,
      effective_user_rate: '1',
      detail_available: true,
      tiers: [],
      time_pricing: null,
      group_peak: null
    }
  }
}
