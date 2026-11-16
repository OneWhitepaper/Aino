import { useEffect } from 'react'

import { syncWorkspaceRoute } from '@/app/routes'

/** Every navigation entry shares the same foreground and pane visibility policy. */
export function useWorkspaceRoute(pathname: string) {
  useEffect(() => syncWorkspaceRoute(pathname), [pathname])
}
