import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { $pluginRecords } from '@/contrib/plugins-store'
import type { DesktopConnectionConfig } from '@/global'
import { useI18n } from '@/i18n'
import { Monitor } from '@/lib/icons'
import { clearProfileBackend } from '@/sdk/profile-backend'
import { notifyError } from '@/store/notifications'

import { ListRow, SettingsSection } from './primitives'

export function GatewayPluginRecovery() {
  const { t } = useI18n()
  const plugins = useStore($pluginRecords)
  const [routes, setRoutes] = useState<NonNullable<DesktopConnectionConfig['profileLaunchers']>>([])
  const [pending, setPending] = useState<null | string>(null)
  const [revision, setRevision] = useState(0)
  const failedLoad = t.settings.gateway.failedLoad
  const runHere = t.profiles.remoteOverride.runHere

  useEffect(() => {
    let active = true

    // The roster and rail's route cache may both be empty while a launcher is down.
    // Read Electron's local saved routes instead of dialing the failed backend.
    void window.hermesDesktop
      ?.getConnectionConfig(null)
      .then(config => {
        if (active) {
          setRoutes(config.profileLaunchers ?? [])
        }
      })
      .catch(error => {
        if (active) {
          notifyError(error, failedLoad)
        }
      })

    return () => {
      active = false
    }
  }, [failedLoad, revision])

  useEffect(() => window.hermesDesktop?.onConnectionApplied?.(() => setRevision(value => value + 1)), [])

  const orphaned = routes.filter(route => plugins[route.plugin]?.status !== 'loaded')

  if (!orphaned.length) {
    return null
  }

  const recover = async (target: (typeof routes)[number]) => {
    setPending(target.profile)

    try {
      // This exact-profile SDK door asks natively; cancellation or a run-elsewhere
      // refusal never becomes a global connection Apply or an automatic local retry.
      await clearProfileBackend(target)
    } catch (error) {
      notifyError(error, runHere)
    } finally {
      setPending(null)
      setRevision(value => value + 1)
    }
  }

  return (
    <SettingsSection icon={Monitor} title={t.profiles.remoteOverride.sandboxed}>
      {orphaned.map(target => (
        <ListRow
          action={
            <Button disabled={pending !== null} onClick={() => void recover(target)} size="sm" variant="outline">
              {runHere}
            </Button>
          }
          description={target.plugin}
          key={target.profile}
          title={target.profile}
        />
      ))}
    </SettingsSection>
  )
}
