import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'

import type { ProfileScope } from '@/api/client'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { codeModelCapabilityCopy } from '@/i18n/code-model-capability'
import {
  codeModelCapability,
  type CodeModelCapabilityInput,
  codeModelNeedsBridge,
  codeModelSettingsPath
} from '@/lib/code-model-capability'
import { readCodeModelRuntimeCapabilities } from '@/lib/code-model-capability-runtime'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { queryClient } from '@/lib/query-client'
import { useGatewayActivationEpoch } from '@/store/gateway-activation-epoch'
import { $gatewayRouteRevision } from '@/store/gateway-route-observation'
import { $notificationEpoch } from '@/store/notifications'
import { requestRoute } from '@/store/recovery-requests'
import type { CustomEndpoint } from '@/types/hermes'

/** The menu's captured owner supplies the same settings metadata to rows and details. */
export const CodeModelEndpointsContext = createContext<{
  endpoints?: readonly CustomEndpoint[]
  scope?: ProfileScope
  sessionInfo?: CodeModelCapabilityInput['sessionInfo']
}>({})

export function CodeModelStatus({ details = false, ...input }: CodeModelCapabilityInput & { details?: boolean }) {
  const { locale } = useI18n()
  const copy = codeModelCapabilityCopy(locale)
  const metadata = useContext(CodeModelEndpointsContext)

  const selection = {
    ...input,
    endpoints: input.endpoints ?? metadata.endpoints,
    sessionInfo: input.sessionInfo ?? metadata.sessionInfo
  }

  const scope = platformDefaultScope(metadata.scope)
  const revision = useStore($gatewayRouteRevision)
  const accountEpoch = useStore($notificationEpoch)
  const activation = useGatewayActivationEpoch()
  const needsBridge = codeModelNeedsBridge(selection)

  const runtime = useQuery(
    {
      queryKey: ['code-model-runtime', scope.key, revision, accountEpoch, activation],
      queryFn: ({ signal }) => readCodeModelRuntimeCapabilities(scope.route, signal),
      enabled: needsBridge,
      retry: false,
      staleTime: Infinity,
      gcTime: 0
    },
    queryClient
  )

  const capability =
    needsBridge && (runtime.data === undefined || runtime.isFetching || runtime.isError)
      ? 'unverified'
      : codeModelCapability({ ...selection, runtimeCapabilities: runtime.data })

  const hint = {
    compatible: copy.protocolOnly,
    adapted: copy.adaptedHint,
    'work-only': copy.workOnlyHint,
    unverified: copy.unverifiedHint
  }[capability]

  if (!details) {
    return (
      <span
        className="shrink-0 text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)"
        data-code-model-capability={capability}
      >
        {copy[capability]}
      </span>
    )
  }

  return (
    <div className="aino-model-menu-detail-hint" data-code-model-capability={capability} role="status">
      <strong>{copy[capability]}</strong>
      <p>{hint}</p>
      <Button onClick={() => requestRoute(codeModelSettingsPath(metadata.scope))} size="xs" variant="text">
        {copy.settings}
      </Button>
    </div>
  )
}
