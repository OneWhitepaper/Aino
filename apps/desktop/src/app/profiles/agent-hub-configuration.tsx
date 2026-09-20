import { Link, Navigate } from 'react-router'

import { Slot } from '@/contrib/react/slot'
import { useContributions } from '@/contrib/react/use-contributions'
import { useI18n } from '@/i18n'

import { AGENT_HUB_CONFIGURATION_ROUTE, SETTINGS_ROUTE } from '../routes'

import { WorkspaceControls } from './workspace-controls'

export const AGENT_HUB_CONFIGURATION_AREA = 'agentHub.configuration'

/** The host keeps this destination stable when its bundled provider is disabled. */
export function AgentHubConfiguration() {
  const { t } = useI18n()
  const providers = useContributions(AGENT_HUB_CONFIGURATION_AREA)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-6" data-aino-page-shell>
      <h1 className="text-lg font-semibold">{t.profiles.hubTitle}</h1>
      <p className="mt-2 mb-5 text-sm text-(--ui-text-secondary)">{t.profiles.projectAgentHelp}</p>
      {providers.length ? (
        <Slot area={AGENT_HUB_CONFIGURATION_AREA} />
      ) : (
        <div role="status">
          <p>{t.profiles.hubUnavailable}</p>
          <Link to={`${SETTINGS_ROUTE}?tab=plugins`}>{t.commandCenter.settings}</Link>
        </div>
      )}
      <div className="mt-6">
        <WorkspaceControls />
      </div>
    </div>
  )
}

export function ProfileConfigurationRedirect() {
  return <Navigate replace to={AGENT_HUB_CONFIGURATION_ROUTE} />
}
