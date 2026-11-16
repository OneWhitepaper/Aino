import navArtifactsIcon from '@/assets/aino-home/nav-artifacts.svg'
import navComposeIcon from '@/assets/aino-home/nav-compose.svg'
import navCronIcon from '@/assets/aino-home/nav-cron.svg'
import navMessagingIcon from '@/assets/aino-home/nav-messaging.svg'
import navSkillsIcon from '@/assets/aino-home/nav-skills.svg'
import { AinoDesignIcon } from '@/components/aino-design-icon'
import { Codicon } from '@/components/ui/codicon'

import { ARTIFACTS_ROUTE, CAPABILITIES_ROUTE, CRON_ROUTE, MESSAGING_ROUTE, PROFILES_ROUTE } from '../../routes'
import type { SidebarNavItem } from '../../types'

export const BUILTIN_SIDEBAR_NAV: SidebarNavItem[] = [
  {
    id: 'new-session',
    label: '',
    icon: props => <AinoDesignIcon src={navComposeIcon} {...props} />,
    action: 'new-session',
    keybindActionId: 'session.new'
  },
  {
    id: 'profiles',
    label: '',
    icon: props => <Codicon name="organization" {...props} />,
    route: PROFILES_ROUTE,
    keybindActionId: 'nav.profiles'
  },
  {
    id: 'skills',
    label: '',
    icon: props => <AinoDesignIcon src={navSkillsIcon} {...props} />,
    route: CAPABILITIES_ROUTE,
    keybindActionId: 'nav.capabilities'
  },
  {
    id: 'messaging',
    label: '',
    icon: props => <AinoDesignIcon src={navMessagingIcon} {...props} />,
    route: MESSAGING_ROUTE,
    keybindActionId: 'nav.messaging'
  },
  {
    id: 'artifacts',
    label: '',
    icon: props => <AinoDesignIcon src={navArtifactsIcon} {...props} />,
    route: ARTIFACTS_ROUTE,
    keybindActionId: 'nav.artifacts',
    tier: 'advanced'
  },
  {
    id: 'cron',
    label: '',
    icon: props => <AinoDesignIcon src={navCronIcon} {...props} />,
    route: CRON_ROUTE,
    keybindActionId: 'nav.cron',
    tier: 'advanced'
  }
]
