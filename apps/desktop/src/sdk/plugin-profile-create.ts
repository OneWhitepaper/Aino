import { getGlobalModelInfo } from '@/hermes'
import { availablePlatformDefault } from '@/lib/model-default'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog, PlatformSelectionError, readPlatformDefault, writePlatformDefault } from '@/store/platform-models'

import { hasPlatformModelIdentity } from '../../shared/platform-contract'

import type { PluginSessionCreateRoute } from './plugin-session-create'

/** Cloning a profile copies its runtime config on the server. Its Aino preference
 * lives in this account's desktop storage, so copy that part only after creation succeeds. */
export async function requestPluginProfileCreate<T>(
  route: PluginSessionCreateRoute,
  params: Record<string, unknown>,
  send: () => Promise<T>
): Promise<T> {
  const catalog = platformModelCatalog()
  const account = catalog.account.get()
  const name = typeof params.name === 'string' ? params.name.trim() : ''

  if (window.hermesDesktop?.accountAdapter !== 'platform' || !hasPlatformModelIdentity(account) || !name) {
    return send()
  }

  await catalog.owner.load()

  if (!samePlatformAccount(catalog.account.get(), account)) { throw new PlatformSelectionError('platform_account_changed') }
  const owner = catalog.owner.state.get().owner

  if (!owner || owner.user_id !== account.account.id) { return send() }
  const connection = route.connectionId ? { connectionId: route.connectionId } : {}
  const destination = platformDefaultScope({ ...connection, profile: name })
  const cloneFrom = typeof params.clone_from === 'string' ? params.clone_from.trim() : ''
  const explicitModel = ['model', 'provider', 'model_source', 'model_id'].some(key => Boolean(params[key]))
  let preferred: string | null = null

  if (cloneFrom && !explicitModel) {
    const source = platformDefaultScope({ ...connection, profile: cloneFrom })
    const saved = readPlatformDefault(account.account.id, source, account.mode, owner.platform_origin)

    const configured = await getGlobalModelInfo(source.route)

    // A retained preference behind a third-party pin is not the active default.
    if (!configured.model && !configured.provider) {
      preferred = saved

      if (!preferred) {
        // A workspace may follow the API's designated default without a local
        // preference. Freeze that effective default too: future catalog changes
        // must not silently retarget an independently configured Bot.
        await catalog.load()
        const state = catalog.state.get()
        preferred = state.phase === 'ready' ? availablePlatformDefault(state.models, null)?.id ?? null : null
      }
    }
  }

  if (!samePlatformAccount(catalog.account.get(), account)) { throw new PlatformSelectionError('platform_account_changed') }
  const result = await send()
  const created = result as { ok?: boolean; name?: string } | null

  // No write on failure or account switch. A fresh profile cannot legitimately
  // have a previous preference: clear leftovers when there is nothing to inherit.
  if (created?.ok === true && created.name === name && samePlatformAccount(catalog.account.get(), account)) {
    writePlatformDefault(account.account.id, preferred, destination, account.mode, owner.platform_origin)
  }

  return result
}
