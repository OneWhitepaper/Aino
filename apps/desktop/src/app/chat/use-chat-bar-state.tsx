import type { ModelOptionsResult } from '@hermes/shared'
import { useQuery } from '@tanstack/react-query'
import type * as React from 'react'
import { useMemo } from 'react'

import type { HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { quickModelOptions } from '@/lib/chat-runtime'
import { currentModelCapabilities, modelOptionsQueryKey, requestModelOptions } from '@/lib/model-options'
import { useStoresSelector } from '@/lib/use-session-slice'
import { verifiedPlatformModel } from '@/store/platform-model-capability'
import { platformModelCatalog } from '@/store/platform-models'
import { $currentPlatformOrigin, $currentPlatformOwner } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { ComposerContextUsage } from './composer/context-usage'
import type { ChatBarState } from './composer/types'

interface ChatBarStateOptions {
  activeGatewayProfile: string
  activeSessionId: null | string
  contextSuggestions: ChatBarState['tools']['suggestions']
  currentModel: string
  currentProvider: string
  gateway: HermesGateway | null
  gatewayOpen: boolean
  modelMenuContent?: React.ReactNode
  modelOptionsOwnerConnectionId?: string
  modelOptionsProfile?: string
  reasoningMenuContent?: React.ReactNode
  requestModelOptionsForOwner?: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

// The composer's model / tools / voice state, backed by the model-options query
// for the active session's profile.
export function useChatBarState({
  activeGatewayProfile,
  activeSessionId,
  contextSuggestions,
  currentModel,
  currentProvider,
  gateway,
  gatewayOpen,
  modelMenuContent,
  modelOptionsOwnerConnectionId,
  modelOptionsProfile,
  reasoningMenuContent,
  requestModelOptionsForOwner
}: ChatBarStateOptions): ChatBarState {
  const { t } = useI18n()

  const modelOptionsQuery = useQuery<ModelOptionsResult>({
    queryKey: modelOptionsQueryKey(
      modelOptionsProfile || activeGatewayProfile,
      activeSessionId,
      modelOptionsOwnerConnectionId
    ),
    queryFn: () =>
      requestModelOptions({
        gateway: gateway || undefined,
        profile: modelOptionsProfile || activeGatewayProfile,
        request: requestModelOptionsForOwner,
        sessionId: activeSessionId
      }),
    enabled: gatewayOpen
  })

  const quickModels = useMemo(
    () => quickModelOptions(modelOptionsQuery.data, currentProvider, currentModel),
    [currentModel, currentProvider, modelOptionsQuery.data]
  )

  const catalog = platformModelCatalog()

  const platformReasoning = useStoresSelector(
    [
      $sessionStates,
      $currentPlatformOwner,
      $currentPlatformOrigin,
      catalog.state,
      catalog.account,
      catalog.owner.state
    ],
    () => {
      if (currentProvider !== 'aino') {
        return false
      }

      const state = activeSessionId ? $sessionStates.get()[activeSessionId] : undefined
      const owner = state ? (state.platformModel?.ownerUserId ?? '') : $currentPlatformOwner.get()
      const origin = state ? state.platformModel?.platformOrigin : $currentPlatformOrigin.get()

      return Boolean(verifiedPlatformModel(currentModel, owner, origin)?.capabilities.reasoning)
    }
  )

  const supportsReasoning =
    currentProvider === 'aino'
      ? platformReasoning
      : currentModelCapabilities(modelOptionsQuery.data, currentProvider, currentModel)?.reasoning

  return useMemo<ChatBarState>(
    () => ({
      contextUsage: requestModelOptionsForOwner ? (
        <ComposerContextUsage enabled={gatewayOpen} requestGateway={requestModelOptionsForOwner} />
      ) : null,
      model: {
        model: currentModel,
        provider: currentProvider,
        canSwitch: gatewayOpen,
        loading: !gatewayOpen || (!currentModel && !currentProvider),
        modelMenuContent,
        quickModels,
        reasoningMenuContent,
        supportsReasoning
      },
      tools: {
        enabled: true,
        label: t.ui.actions.addContext,
        suggestions: contextSuggestions
      },
      voice: {
        enabled: true,
        active: false
      }
    }),
    [
      contextSuggestions,
      currentModel,
      currentProvider,
      gatewayOpen,
      modelMenuContent,
      quickModels,
      requestModelOptionsForOwner,
      t.ui.actions.addContext,
      reasoningMenuContent,
      supportsReasoning
    ]
  )
}
