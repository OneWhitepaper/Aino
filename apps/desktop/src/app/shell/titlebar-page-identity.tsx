import { BookOpen, Box, Clock, MessagesSquare, PanelsTopLeft, Settings2 } from 'lucide-react'

import type { AppView } from '@/app/routes'
import { useI18n } from '@/i18n'

/** Page identity follows the same destinations as the activity rail. */
export function TitlebarPageIdentity({ view }: { view: AppView }) {
  const { t } = useI18n()

  const pages = {
    settings: { Icon: Settings2, label: t.commandCenter.settings },
    profiles: { Icon: PanelsTopLeft, label: t.sidebar.nav.profiles },
    capabilities: { Icon: BookOpen, label: t.sidebar.nav.skills },
    messaging: { Icon: MessagesSquare, label: t.sidebar.nav.messaging },
    artifacts: { Icon: Box, label: t.sidebar.nav.artifacts },
    cron: { Icon: Clock, label: t.sidebar.nav.cron }
  }

  const page = pages[view as keyof typeof pages]

  if (!page) {
    return null
  }

  return (
    <span
      className="ml-3 flex min-w-0 max-w-[45vw] items-center gap-2 text-[length:var(--aino-text-label)] font-semibold"
      data-titlebar-page-identity=""
    >
      <page.Icon aria-hidden className="size-4 shrink-0 text-(--ui-text-secondary)" strokeWidth={1.65} />
      <span className="truncate">{page.label}</span>
    </span>
  )
}
