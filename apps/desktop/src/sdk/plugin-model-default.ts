import type { ProfileScope } from '@/hermes'
import { resolveModelDefault } from '@/lib/model-default'
import { platformDefaultScope, type PlatformDefaultScope } from '@/lib/platform-model-scope'
import {
  platformModelCatalog,
  PlatformSelectionError,
  readPlatformDefault,
  writePlatformDefault
} from '@/store/platform-models'

/** Old Bots created before Aino preferences were cloned can have an empty
 * profile. Repair only that absent snapshot from this connection's explicitly
 * saved primary Aino default; provider credentials remain profile-owned. */
export async function resolvePluginBotDefault(
  scope: ProfileScope,
  managedRoute: PlatformDefaultScope['route'],
  assertAccount: () => void
) {
  try {
    return await resolveModelDefault(scope, managedRoute)
  } catch (error) {
    assertAccount()

    if (!(error instanceof PlatformSelectionError) || error.code !== 'model_unavailable') {
      throw error
    }

    const catalog = platformModelCatalog()
    const account = catalog.account.get()
    const owner = catalog.owner.state.get().owner
    const target = platformDefaultScope(scope)

    if (target.route.profile === 'default' || !account?.account?.id || owner?.user_id !== account.account.id) {
      throw error
    }

    const read = (captured: PlatformDefaultScope) =>
      readPlatformDefault(account.account!.id, captured, account.mode, owner.platform_origin)

    // A missing snapshot is different from an explicit, currently unavailable model.
    if (read(target)) {
      throw error
    }

    const source = platformDefaultScope({ ...target.route, profile: 'default' })
    const preferred = read(source)

    if (!preferred) {
      throw error
    }

    const resolved = await resolveModelDefault(source.route, managedRoute)
    assertAccount()

    // Provider pins resolve without a platform identity and cannot be inherited here.
    if (resolved.platform?.modelId !== preferred || read(source) !== preferred || read(target)) {
      throw error
    }

    writePlatformDefault(account.account.id, preferred, target, account.mode, owner.platform_origin)

    return resolved
  }
}
