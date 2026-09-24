import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { PlatformModelList } from '@/components/platform-model-list'
import { useI18n } from '@/i18n'
import { Cpu } from '@/lib/icons'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { $activeConnectionId } from '@/store/connections'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { savePlatformDraftDefault } from '@/store/platform-draft-model'
import { platformModelCatalog, readPlatformDefault } from '@/store/platform-models'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { SectionHeading } from './primitives'

export function PlatformModelSettings({ scopeProfile }: { scopeProfile?: string }) {
  const { t } = useI18n()
  const catalog = platformModelCatalog()
  const account = useStore(catalog.account)
  const state = useStore(catalog.state)
  const activeProfile = useStore($activeGatewayProfile)
  useStore($connection)
  useStore($activeConnectionId)
  const scope = platformDefaultScope(scopeProfile ?? activeProfile)
  const managedCapabilities = useStore($gatewayManagedCapabilities)
  const managedCapability = managedModelRouteCapabilityFrom(managedCapabilities, scope.route)
  const [, refreshPreference] = useState(0)
  const selectionKey = JSON.stringify([account?.account?.id, account?.mode, scope.key])
  useEffect(() => {
    if (state.phase === 'idle') {
      void catalog.load()
    }
  }, [catalog, state.phase, account?.revision])

  if (account?.phase !== 'signed_in') {
    return null
  }

  return (
    <section>
      <SectionHeading icon={Cpu} title={t.platformModels.builtIn} />
      <p className="mb-3 text-xs text-muted-foreground">{t.platformModels.defaultModel}</p>
      <PlatformModelList
        key={selectionKey}
        managedCapability={managedCapability}
        onSelect={async model => {
          const saving = savePlatformDraftDefault(account, scope, model.id)
          refreshPreference(value => value + 1)
          await saving

          return true
        }}
        selectedId={readPlatformDefault(account.account?.id ?? '', scope, account.mode) ?? undefined}
      />
    </section>
  )
}
