import { NO_PROJECT_ID } from '@/app/chat/sidebar/projects/workspace-groups'
import { translateNow } from '@/i18n'
import { $defaultProfileRoute } from '@/store/default-profile'
import { activeGatewayConnectionId } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import {
  $newChatProfile,
  $newChatRoute,
  type AgentProfileRoute,
  captureNewChatSource,
  ensureGatewayAgent,
  ensureGatewayProfile,
  pinLegacyNewChatProfile
} from '@/store/profile'
import { $projectScope, ALL_PROJECTS } from '@/store/project-scope'
import {
  isPeerInstanceWindow,
  isProfilePinnedWindow,
  windowConnectionOverride,
  windowProfileOverride
} from '@/store/windows'

/** Ordinary chats use Aino on the selected service. Bot routes stay explicit. */
export function defaultNewSessionTarget(): { profile: string; route: AgentProfileRoute | null } {
  const project = $projectScope.get()

  // Ordinary windows follow later service selections. A dedicated Bot window
  // retains its source, while an ordinary chat there still belongs to Aino.
  const profile = !isPeerInstanceWindow() || isProfilePinnedWindow() ? windowProfileOverride() : null
  const saved = profile ? { connectionId: windowConnectionOverride(), profile } : $defaultProfileRoute.get()

  // A project belongs to the service whose tree is on screen. Its cwd is
  // preserved by the caller, separately from the assistant's Profile.
  const connectionId =
    project !== ALL_PROJECTS && project !== NO_PROJECT_ID
      ? activeGatewayConnectionId()
      : saved
        ? saved.connectionId
        : activeGatewayConnectionId()

  // A saved null connection explicitly chooses the legacy primary door.
  return {
    profile: 'default',
    route: connectionId === null ? null : { connectionId, profile: 'default' }
  }
}

export function prepareDefaultNewSession(): void {
  const target = defaultNewSessionTarget()

  if (target.route) {
    $newChatProfile.set(target.profile)
    $newChatRoute.set(target.route)
    captureNewChatSource(target.route.connectionId)
  } else {
    pinLegacyNewChatProfile(target.profile)
  }

  const activation = target.route
    ? ensureGatewayAgent(target.route.connectionId, target.profile)
    : ensureGatewayProfile(target.profile, { forceLegacyRoute: true })

  void activation.catch(error => {
    notifyError(error, translateNow('profiles.failedLoad'))
  })
}
