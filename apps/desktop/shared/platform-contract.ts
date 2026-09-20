export type PlatformAccountPhase = 'signed_out' | 'loading' | 'signed_in' | 'offline' | 'reauth_required'

export interface PlatformAccountSnapshot {
  revision: number
  phase: PlatformAccountPhase
  account: null | { id: string; display_name: string; phone_masked: string; email: string }
  mode: 'production' | 'development'
  remember_state: 'encrypted' | 'session_only'
  error: null | { code: string; retry_after?: number }
}

export interface PlatformCaptchaProof {
  turnstile_token?: string
  tencent_captcha_ticket?: string
  tencent_captcha_randstr?: string
}

export interface PlatformPublicCapabilities {
  desktop_api_version: number
  registration_enabled: boolean
  phone_login_enabled: boolean
  phone_registration_enabled: boolean
  phone_binding_enabled: boolean
  phone_regions: string[]
  phone_code_length: number
  invitation_code_enabled: boolean
  promo_code_enabled: boolean
  login_agreement_enabled: boolean
  login_agreement_mode: string
  login_agreement_revision: string
  login_agreement_documents: Array<{ id: string; title: string; content_md: string }>
  captcha: {
    provider: 'disabled' | 'turnstile' | 'aliyun' | 'tencent'
    site_key: string
    scene_id: string
    prefix: string
    region: string
  }
}

export interface PhoneChallengeDTO {
  challenge_id: string
  expires_in: number
  retry_after: number
  delivery: string
}
export interface PhoneVerifyDTO {
  phone: string
  challenge_id: string
  code: string
  register_if_new: boolean
  agreement_revision: string
  invitation_code?: string
  promo_code?: string
  remember: boolean
}
export type PlatformAuthResult = { status: 'signed_in'; snapshot: PlatformAccountSnapshot } | { status: 'requires_2fa' }

export type PlatformAccountIpcResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; retry_after?: number } }

export function unwrapPlatformAccountIpc<T>(result: PlatformAccountIpcResult<T>): T {
  if (result.ok === true) {
    return result.value
  }

  const error = {
    name: 'PlatformAccountError',
    message: result.error.code,
    code: result.error.code,
    ...(result.error.retry_after === undefined
      ? {}
      : { retryAfter: result.error.retry_after, retry_after: result.error.retry_after })
  }

  throw error
}

export interface PlatformAccountBridge {
  status(): Promise<PlatformAccountSnapshot>
  capabilities(): Promise<PlatformPublicCapabilities>
  retry(): Promise<PlatformAccountSnapshot>
  requestPhoneCode(input: { phone: string; captcha_proof?: PlatformCaptchaProof }): Promise<PhoneChallengeDTO>
  verifyPhoneCode(input: PhoneVerifyDTO): Promise<PlatformAuthResult>
  loginExisting(input: {
    email: string
    password: string
    captcha_proof?: PlatformCaptchaProof
    remember: boolean
  }): Promise<PlatformAuthResult>
  completeSecondFactor(input: { totp_code: string }): Promise<PlatformAccountSnapshot>
  updateProfile(input: { display_name: string }): Promise<PlatformAccountSnapshot>
  requestBindingCode(input: { phone: string }): Promise<PhoneChallengeDTO>
  submitStepUp(input: { totp_code: string; expected_user_id?: string; expected_generation?: number }): Promise<PlatformAccountSnapshot>
  bindPhone(input: { phone: string; challenge_id: string; code: string }): Promise<PlatformAccountSnapshot>
  logout(): Promise<PlatformAccountSnapshot>
  onChanged(listener: (snapshot: PlatformAccountSnapshot) => void): () => void
}

export interface PlatformModel {
  id: string
  model: string
  display_name: string
  provider_label: string
  api_mode: 'chat_completions' | 'responses' | 'anthropic_messages'
  state: 'available' | 'insufficient_balance' | 'quota_exhausted' | 'unavailable'
  reason_code: string | null
  is_default: boolean
  context_window: number | null
  max_output_tokens: number | null
  capabilities: { tools: boolean; vision: boolean; reasoning: boolean }
  billing_source: 'balance' | 'subscription'
  pricing: PlatformModelPricing
}

export interface PlatformModelPricing {
  currency: string
  unit: string
  input: string | null
  output: string | null
  cache_read: string | null
  cache_write: string | null
  effective_user_rate: string
  detail_available: boolean
  tiers: Array<{
    min_tokens: number
    max_tokens: number | null
    label: string
    input: string | null
    output: string | null
    cache_read: string | null
    cache_write: string | null
    cache_write_1h: string | null
  }>
  time_pricing: null | {
    timezone: string
    weekdays_only: boolean
    periods: Array<{ start_time: string; end_time: string; multiplier: string }>
  }
  group_peak: null | { start: string; end: string; multiplier: string }
}

export interface PlatformModelsBridge {
  owner(expectedAccountRevision: number): Promise<{ platform_origin: string; user_id: string }>
  bind(input: BindPlatformModelInput & { session_ticket: string }): Promise<BindPlatformModelResult>
  clear(input: { connection_id: string; profile: string; session_id: string }): Promise<void>
  list(): Promise<PlatformModel[]>
}

export interface BindPlatformModelInput {
  connection_id: string
  profile: string
  session_id: string
  model_id: string
  expected_account_revision: number
}

export type BindPlatformModelResult =
  | { ok: true; ready: true; model_id: string; billing_source: 'aino'; expires_at: string }
  | { ok: false; error: { code: string } }

export interface PlatformCaptchaBridge {
  getChallenge(): Promise<{ nonce: string; issued_at: number; expires_at: number }>
  submit(input: { nonce: string; proof: PlatformCaptchaProof }): Promise<void>
}

export interface PlatformUsageQuery {
  page: number
  page_size: number
  session_id?: string
  desktop_turn_id?: string
  desktop_call_id?: string
  desktop_purpose?: string
  start_date?: string
  end_date?: string
}

export interface PlatformUsageRow {
  id: string
  request_id: string
  model: string
  session_id: string | null
  desktop_turn_id: string | null
  desktop_call_id: string | null
  desktop_purpose: string | null
  actual_cost_decimal: string | null
  currency: 'USD'
  settlement_status: 'pending' | 'settled' | 'not_charged' | 'unknown'
  created_at: string
}

export interface PlatformUsagePage {
  items: PlatformUsageRow[]
  page: number
  page_size: number
  total: number
}

export interface PlatformBillingBridge {
  scope(input: PlatformBillingOwner): Promise<PlatformBillingScope>
  summary(input: PlatformBillingOwner): Promise<PlatformWalletSummary>
  checkoutInfo(input: PlatformBillingOwner): Promise<PlatformCheckoutInfo>
  quote(input: PaymentQuoteInput & PlatformBillingOwner): Promise<PaymentQuote>
  createOrder(input: PlatformCreateOrderInput & PlatformBillingOwner): Promise<PlatformOrder>
  getOrder(input: PlatformOrderReference & PlatformBillingOwner): Promise<PlatformOrder>
  listOrders(input: PlatformOrderQuery & PlatformBillingOwner): Promise<PlatformOrderPage>
  cancelOrder(input: PlatformOrderReference & PlatformBillingOwner): Promise<PlatformOrder>
  openCheckout(input: PlatformOrderReference & PlatformBillingOwner): Promise<void>
  listUsage(input: PlatformUsageQuery & { expected_user_id: string }): Promise<PlatformUsagePage>
}

export interface PlatformDevice {
  device_id: string
  last_used_at: string
  expires_at: string
  revoked: boolean
}

export interface PlatformDeviceOwner {
  expected_user_id: string
  expected_generation: number
}

export interface PlatformDevicesBridge {
  list(input: PlatformDeviceOwner): Promise<PlatformDevice[]>
  revoke(input: PlatformDeviceOwner & { device_id: string }): Promise<{ revoked: true }>
}

export interface PaymentQuoteInput {
  amount: string
  payment_type: 'alipay' | 'wxpay'
  order_type: 'balance'
}

export interface PaymentQuote {
  requested_amount: string
  pay_amount: string
  payment_currency: string
  credit_amount: string
  credit_currency: 'USD'
  fee_amount: string
}

export interface PlatformCreateOrderInput extends PaymentQuoteInput {
  client_order_id: string
  expected_quote?: PaymentQuote
}

export interface PlatformOrderReference { order_id: string }
export interface PlatformOrderQuery { page: number; page_size: number }

export type PlatformOrderStatus =
  | 'PENDING' | 'PAID' | 'RECHARGING' | 'COMPLETED' | 'EXPIRED'
  | 'CANCELLED' | 'FAILED' | 'REFUND_REQUESTED' | 'REFUNDING'
  | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'REFUND_FAILED'

export interface PlatformOrder {
  order_id: string
  out_trade_no: string
  client_order_id: string | null
  status: PlatformOrderStatus
  payment_type: string
  requested_amount: string | null
  pay_amount: string
  payment_currency: string
  credit_amount: string
  credit_currency: 'USD'
  fee_amount: string | null
  created_at: string
  expires_at: string
  can_cancel: boolean
  confirmation_required: boolean
  payment_unknown: boolean
  checkout: null | { qr_code: string | null; pay_url: string | null; expires_at: string }
}

export interface PlatformOrderPage {
  items: PlatformOrder[]
  page: number
  page_size: number
  total: number
}

export interface PlatformBillingOwner {
  expected_user_id: string
}

export interface PlatformBillingScope {
  origin: string
  user_id: string
  generation: number
}

export interface PlatformWalletSummary {
  currency: 'USD'
  balance: string
  frozen_balance: string
  available_balance: string
  payment_enabled: boolean
  active_subscriptions: Array<{ id: string; name: string; expires_at: string; remaining: string | null; unit: string }>
  updated_at: string
}

export interface PlatformCheckoutInfo {
  payment_enabled: boolean
  balance_disabled: boolean
  methods: Array<{
    id: 'alipay' | 'wxpay'
    display_name: string
    currency: string
    min_amount: string
    max_amount: string
    available: boolean
  }>
  help_text: string
}
