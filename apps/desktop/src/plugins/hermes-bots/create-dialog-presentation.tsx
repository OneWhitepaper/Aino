import { GlyphSpinner } from '@hermes/plugin-sdk'
import type { ComponentProps } from 'react'

import type { CreateAgentModelSummary } from './create-agent-model-summary'
import { useBots } from './i18n'

export function creationModelSummaryProps(
  activeConnectionId: string,
  cloneFrom: string,
  createTarget: string,
  remoteTarget: boolean
): Pick<ComponentProps<typeof CreateAgentModelSummary>, 'cloneFrom' | 'route'> {
  return {
    cloneFrom: remoteTarget && cloneFrom !== '__none__' ? 'default' : cloneFrom,
    route: {
      connectionId: createTarget || activeConnectionId || 'local',
      mode: remoteTarget ? 'remote' : 'local',
      profile: remoteTarget ? 'default' : cloneFrom,
      targetProfile: remoteTarget ? 'default' : cloneFrom
    }
  }
}

interface CreateAgentCatalogStatusProps {
  failed: boolean
}

export function CreateAgentCatalogStatus({ failed }: CreateAgentCatalogStatusProps) {
  const b = useBots()

  return failed ? (
    <div className="px-2 py-3 text-center text-xs text-(--ui-text-tertiary)">{b.bot.catalogUnsupported}</div>
  ) : (
    <div className="flex justify-center py-4">
      <GlyphSpinner className="text-(--ui-text-tertiary)" spinner="breathe" />
    </div>
  )
}
