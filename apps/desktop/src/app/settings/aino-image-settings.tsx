import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { getToolsetConfig, type ProfileScope } from '@/hermes'
import { useI18n } from '@/i18n'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile } from '@/store/profile'
import type { ToolProvider } from '@/types/hermes'

import { AinoImageModelPicker } from './aino-image-model-picker'

/** Desktop exposes the account catalog; the existing runtime still owns provider selection. */
export function AinoImageSettings({
  profile,
  onConfiguredChange
}: {
  profile?: ProfileScope
  onConfiguredChange?: () => void
}) {
  const { t } = useI18n()
  useStore($activeConnectionId)
  useStore($activeGatewayProfile)
  const { connectionId, profile: profileName } = platformDefaultScope(profile).route
  const scope = useMemo(() => ({ connectionId, profile: profileName }), [connectionId, profileName])
  const [revision, setRevision] = useState(0)

  const [state, setState] = useState<{ loading: boolean; provider?: ToolProvider; active?: boolean; error?: boolean }>({
    loading: true
  })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true })
    getToolsetConfig('image_gen', scope)
      .then(config => {
        if (!cancelled) {
          const provider = config.providers.find(row => row.image_gen_plugin_name === 'aino')
          setState({
            loading: false,
            provider,
            active: provider?.is_active || config.active_provider === provider?.name
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ loading: false, error: true })
        }
      })

    return () => void (cancelled = true)
  }, [scope, revision])

  if (state.loading) {
    return <PageLoader className="min-h-24" />
  }

  if (!state.provider) {
    return (
      <div className="grid gap-2" role="alert">
        <p className="text-xs text-muted-foreground">
          {state.error
            ? t.settings.model.imageGeneration.loadFailed
            : t.settings.model.imageGeneration.runtimeUnavailable}
        </p>
        <Button onClick={() => setRevision(value => value + 1)} size="sm" variant="ghost">
          {t.platformModels.retry}
        </Button>
      </div>
    )
  }

  return (
    <AinoImageModelPicker
      isActiveBackend={Boolean(state.active)}
      key={JSON.stringify(scope)}
      onSelected={onConfiguredChange}
      profile={scope}
      providerName={state.provider.name}
    />
  )
}
