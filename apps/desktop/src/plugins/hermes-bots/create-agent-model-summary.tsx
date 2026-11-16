import { Button, host, useI18n, useQuery } from '@hermes/plugin-sdk'

import { useBots } from './i18n'
import type { ProfileRoute } from './types'

interface CreateAgentModelSummaryProps {
  open: boolean
  model: string
  provider: string
  cloneFrom: string
  route: ProfileRoute
}

/** The preview reads the same effective default the creation path will inherit. */
export function CreateAgentModelSummary({ open, model, provider, cloneFrom, route }: CreateAgentModelSummaryProps) {
  const { t } = useI18n()
  const { navigation: n } = useBots()
  const inherited = !model && !provider && cloneFrom !== '__none__'

  const effective = useQuery({
    queryKey: ['hermes-bots', 'create-inherited-model', route.connectionId, route.profile, route.targetProfile],
    queryFn: () => host.profiles.effectiveModel(route.profile, route),
    enabled: open && inherited,
    staleTime: 5000,
    gcTime: 0,
    retry: false
  })

  return (
    <div className="aino-create-model-summary">
      <span>{n.defaultModel}</span>
      <div className="aino-create-model-value">
        <span>
          {model || provider
            ? provider
            : inherited
              ? cloneFrom === 'default'
                ? n.inheritDefault
                : n.inheritFrom(cloneFrom)
              : n.freshModel}
        </span>
        <strong>
          {model || (inherited ? effective.data?.label || (effective.isPending ? n.modelPending : '') : '')}
        </strong>
      </div>
      {inherited && effective.error ? (
        <div aria-live="polite" className="aino-create-model-error">
          <span>{n.modelFailed}</span>
          <Button onClick={() => void effective.refetch()} size="xs" variant="ghost">
            {t.common.retry}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
