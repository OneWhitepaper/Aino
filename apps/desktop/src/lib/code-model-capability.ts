import type { ModelOptionProvider } from '@hermes/shared'

import type { ProfileScope } from '@/api/client'
import { getCustomEndpoints } from '@/api/config'
import { getGlobalModelOptions } from '@/api/models'
import { codeModelCapabilityCopy } from '@/i18n/code-model-capability'
import { getRuntimeI18nLocale } from '@/i18n/runtime'
import type { CustomEndpoint } from '@/types/hermes'

import type { PlatformModel } from '../../shared/platform-contract'

import { readCodeModelRuntimeCapabilities } from './code-model-capability-runtime'
import { findCatalogProvider, modelProviderMatches } from './model-options'
import { platformDefaultScope } from './platform-model-scope'

export type CodeModelCapability = 'compatible' | 'adapted' | 'work-only' | 'unverified'

interface ModelRouteMetadata {
  provider?: string | null
  model?: string | null
  api_mode?: unknown
}

export interface CodeModelCapabilityInput {
  provider: string
  model: string
  providers?: readonly ModelOptionProvider[]
  endpoints?: readonly CustomEndpoint[]
  sessionInfo?: ModelRouteMetadata | null
  /** Must be taken from the captured account's catalog, never a previous account's row. */
  platformModel?: Pick<PlatformModel, 'id' | 'api_mode'> | null
  /** Only runtime.describe from this route's owning backend can enable its bridge. */
  runtimeCapabilities?: readonly string[]
}

const PROTOCOLS: Record<string, CodeModelCapability> = {
  responses: 'compatible',
  codex_responses: 'compatible',
  chat_completions: 'adapted',
  anthropic_messages: 'adapted',
  bedrock_converse: 'work-only',
  images_generations: 'work-only'
}

function modelProtocol(input: CodeModelCapabilityInput): unknown {
  const { provider, model, sessionInfo, platformModel } = input

  if (!provider || !model) {
    return undefined
  }

  if (provider === 'aino') {
    return platformModel?.id === model ? platformModel.api_mode : undefined
  }

  const row = findCatalogProvider(input.providers ?? [], provider)
  const matches = (candidate: string) => candidate === provider || (row && modelProviderMatches(row, candidate))

  if (sessionInfo?.model === model && sessionInfo.provider && matches(sessionInfo.provider) && sessionInfo.api_mode) {
    return sessionInfo.api_mode
  }

  if (row?.api_mode) {
    return row.api_mode
  }

  // Names and URL host guesses are not route identity. A custom:<id> must not
  // borrow the protocol of an official provider with the same display name.
  const endpoint = input.endpoints?.find(
    entry =>
      matches(`custom:${entry.id}`) ||
      (matches(entry.id) && (!row || row.is_user_defined || row.source === 'user-config' || entry.id === 'custom'))
  )

  return endpoint?.api_mode
}

export function codeModelNeedsBridge(input: CodeModelCapabilityInput): boolean {
  const mode = modelProtocol(input)

  return typeof mode === 'string' && PROTOCOLS[mode] === 'adapted'
}

/** Eligibility is protocol metadata, never a tool-use certification or permission to change routes. */
export function codeModelCapability(input: CodeModelCapabilityInput): CodeModelCapability {
  const mode = modelProtocol(input)
  const capability = typeof mode === 'string' ? (PROTOCOLS[mode] ?? 'unverified') : 'unverified'

  return capability === 'adapted' && !input.runtimeCapabilities?.includes('code-model-protocol-bridge-v1')
    ? 'work-only'
    : capability
}

export interface CodeModelPreflightInput extends CodeModelCapabilityInput {
  scope: ProfileScope
  /** Recheck the captured selection and owner after every asynchronous read. */
  isCurrent?: () => boolean
}

export class CodeModelCompatibilityError extends Error {
  readonly settingsPath: string

  constructor(
    readonly reason: 'work-only' | 'changed',
    scope?: ProfileScope
  ) {
    const copy = codeModelCapabilityCopy(getRuntimeI18nLocale())
    super(reason === 'changed' ? copy.changed : copy.workOnlyHint)
    this.name = 'CodeModelCompatibilityError'
    this.settingsPath = codeModelSettingsPath(scope)
  }
}

/** Read-only preflight reusable by ordinary creation and reviewed cross-mode handoffs.
 * Missing metadata stays unverified; no inference probe, model substitution or config write. */
export async function assertCodeModelCompatible(input: CodeModelPreflightInput): Promise<CodeModelCapability> {
  const scope = platformDefaultScope(input.scope).route
  let selection: CodeModelCapabilityInput = input
  let capability = codeModelCapability(input)

  if (capability === 'unverified' && input.provider !== 'aino' && input.model && input.provider) {
    const [catalog, endpoints] = await Promise.allSettled([
      input.providers
        ? Promise.resolve({ providers: [...input.providers] })
        : Promise.resolve().then(() => getGlobalModelOptions(undefined, scope)),
      Promise.resolve().then(() => getCustomEndpoints(scope))
    ])

    selection = {
      ...input,
      providers: catalog.status === 'fulfilled' ? catalog.value?.providers : input.providers,
      endpoints: endpoints.status === 'fulfilled' ? endpoints.value?.endpoints : input.endpoints
    }
    capability = codeModelCapability(selection)
  }

  if (input.isCurrent?.() === false) {
    throw new CodeModelCompatibilityError('changed', scope)
  }

  if (codeModelNeedsBridge(selection)) {
    // A menu snapshot cannot authorize a later send on a reconnected/older backend.
    const runtimeCapabilities = await readCodeModelRuntimeCapabilities(scope)
    capability = codeModelCapability({ ...selection, runtimeCapabilities })
  }

  if (input.isCurrent?.() === false) {
    throw new CodeModelCompatibilityError('changed', scope)
  }

  if (capability === 'work-only') {
    throw new CodeModelCompatibilityError('work-only', scope)
  }

  return capability
}

/** Settings opens on the route that supplied the model, including background tiles. */
export function codeModelSettingsPath(scope?: ProfileScope): string {
  const route = platformDefaultScope(scope).route
  const params = new URLSearchParams({ tab: 'providers', profile: route.profile })

  if (route.connectionId) {
    params.set('owner', route.connectionId)
  }

  return `/settings?${params.toString()}`
}
