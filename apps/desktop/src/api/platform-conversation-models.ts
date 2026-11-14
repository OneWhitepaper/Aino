import type { ModelOptionsResult } from '@hermes/shared'

import { platformModelSupportsPurpose } from '@/lib/platform-model-purpose'
import { requestGatewayForAgent } from '@/store/gateway'
import { samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog, PlatformSelectionError } from '@/store/platform-models'

import { hasPlatformModelIdentity } from '../../shared/platform-contract'

export interface ConversationModelRow {
  model_id: string
  model_source: 'aino' | 'provider'
  provider?: string
  name?: string
  owner?: { user_id: string; platform_origin: string }
}

export interface ConversationModelRequest {
  action: 'list' | 'select'
  query?: string
  provider?: string
}

export interface ConversationModelResult {
  status: 'available' | 'selected' | 'not_found' | 'ambiguous' | 'unavailable'
  models?: ConversationModelRow[]
  selection?: ConversationModelRow
}

interface ModelRoute {
  connectionId?: string | null
  profile: string
}

const normalized = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

function matchingModels(rows: ConversationModelRow[], query: string) {
  const key = normalized(query)

  if (!key) {
    return []
  }

  const exact = rows.filter(row => [row.model_id, row.name ?? ''].some(value => normalized(value) === key))

  return exact.length
    ? exact
    : rows.filter(row => [row.model_id, row.name ?? ''].some(value => normalized(value).includes(key)))
}

function accountCatalogRows(catalog: ReturnType<typeof platformModelCatalog>, ready: boolean): ConversationModelRow[] {
  const account = catalog.account.get()
  const state = catalog.state.get()
  const owner = catalog.owner.state.get().owner

  if (
    !ready ||
    state.phase !== 'ready' ||
    !hasPlatformModelIdentity(account) ||
    owner?.user_id !== account.account.id
  ) {
    return []
  }

  return state.models
    .filter(model => model.state === 'available' && platformModelSupportsPurpose(model, 'chat'))
    .map(model => ({
      model_id: model.id,
      model_source: 'aino',
      provider: 'aino',
      name: model.display_name,
      owner: { user_id: owner.user_id, platform_origin: owner.platform_origin }
    }))
}

function providerCatalogRows(options: ModelOptionsResult | undefined): ConversationModelRow[] {
  return (options?.providers ?? [])
    .filter(provider => provider.authenticated === true && provider.slug !== 'aino')
    .flatMap(provider =>
      (provider.models ?? [])
        .filter(id => !provider.unavailable_models?.includes(id))
        .map(id => ({ model_id: id, model_source: 'provider' as const, provider: provider.slug, name: id }))
    )
}

function catalogAnswer(rows: ConversationModelRow[], request: ConversationModelRequest): ConversationModelResult {
  let matches = request.provider ? rows.filter(row => row.provider === request.provider) : rows

  if (request.query?.trim()) {
    matches = matchingModels(matches, request.query.trim())
  }

  if (request.action === 'list') {
    return { status: rows.length ? 'available' : 'unavailable', models: matches }
  }

  if (!request.query?.trim()) {
    return { status: 'not_found', models: [] }
  }

  // A model family never creates a provider. Actual account models have priority.
  const builtIn = request.provider ? [] : matches.filter(row => row.model_source === 'aino')
  const candidates = builtIn.length ? builtIn : matches

  return candidates.length === 1
    ? { status: 'selected', selection: candidates[0] }
    : { status: candidates.length ? 'ambiguous' : 'not_found', models: candidates }
}

/** Resolve only actual selectable catalog rows. This answers with metadata; it
 * never changes the running turn's route or exposes native credentials. */
export async function answerPlatformConversationModelRequest(
  route: ModelRoute,
  request: ConversationModelRequest
): Promise<ConversationModelResult> {
  const catalog = platformModelCatalog()
  const account = catalog.account.get()

  const [native, configured] = await Promise.allSettled([
    catalog.load(),
    requestGatewayForAgent<ModelOptionsResult>(route.connectionId ?? null, route.profile, 'model.options', {
      explicit_only: true,
      include_unconfigured: false
    })
  ])

  if (catalog.account.get() !== account && !samePlatformAccount(catalog.account.get(), account)) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  return catalogAnswer(
    [
      ...accountCatalogRows(catalog, native.status === 'fulfilled'),
      ...providerCatalogRows(configured.status === 'fulfilled' ? configured.value : undefined)
    ],
    request
  )
}
