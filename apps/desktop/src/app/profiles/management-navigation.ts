import { registry } from '@/contrib/registry'
import { translateNow } from '@/i18n'
import { notifyError } from '@/store/notifications'
import { $profileOrder, $profiles, sortByProfileOrder } from '@/store/profile'

import { navigateToWorkspacePage, PROFILES_ROUTE } from '../routes'

type BotNavigationRequest = { profile: string } | { direction: 1 | -1 }
type Navigate = (path: string) => void

interface BotManagerNavigation {
  open?: (profile: string) => boolean | Promise<boolean>
  cycle?: (direction: 1 | -1) => boolean | Promise<boolean>
}

/** Legacy profile shortcuts now open Bots through their canonical chat owner. */
export function navigateManagedBot(request: BotNavigationRequest, navigate: Navigate): void {
  const actions = registry.getArea('profiles.manager').map(item => item.data as BotManagerNavigation | undefined)

  const invoke =
    'profile' in request
      ? actions.find(action => action?.open)?.open?.bind(null, request.profile)
      : actions.find(action => action?.cycle)?.cycle?.bind(null, request.direction)

  const showManager = () => navigateToWorkspacePage(navigate, PROFILES_ROUTE)

  if (!invoke) {
    showManager()

    return
  }

  void Promise.resolve()
    .then(() => invoke())
    .then(opened => {
      if (opened === false) {
        showManager()
      }
    })
    .catch(error => {
      notifyError(error, translateNow('profiles.failedLoad'))
      showManager()
    })
}

export function openBotSlot(slot: number, navigate: Navigate): void {
  const named = sortByProfileOrder(
    $profiles.get().filter(profile => !profile.is_default),
    $profileOrder.get()
  )

  const target = named[slot - 1]

  if (target) {
    navigateManagedBot({ profile: target.name }, navigate)
  }
}
