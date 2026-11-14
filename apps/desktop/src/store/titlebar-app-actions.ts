import { DEFAULT_INTERFACE_MODE, type InterfaceMode, shownInMode, type Tiered } from '@/store/interface-mode'

/**
 * The fixed titlebar tools and which of them are instrumentation. ONE table:
 * the buttons spread their entry to render, the width reservation counts the
 * same entries, so a tool Simple hides also releases the space it held.
 * Navigation and notifications remain available in either mode.
 */
export const TITLEBAR_FIXED_TOOLS = {
  hud: { tier: 'advanced' },
  'right-sidebar': { tier: 'advanced' },
  summary: { tier: 'advanced' },
  terminal: { tier: 'advanced' },
  notifications: {},
  sidebar: {}
} satisfies Record<string, Tiered>

export type TitlebarFixedToolId = keyof typeof TITLEBAR_FIXED_TOOLS

/** Navigation stays left; app actions remain on the right. */
const APP_ACTION_IDS: readonly TitlebarFixedToolId[] = ['hud']
const RIGHT_FIXED_IDS: readonly TitlebarFixedToolId[] = ['notifications', 'summary', 'terminal', 'right-sidebar']

/** Button counts for the two titlebar clusters, for the mode that is rendering them. */
export function titlebarAppActionsClusterCounts(
  leftExtras = 0,
  rightExtras = 0,
  mode: InterfaceMode = DEFAULT_INTERFACE_MODE
): { left: number; right: number } {
  const shown = shownInMode(mode)
  const leftFixed = 3
  const appActions = APP_ACTION_IDS.filter(id => shown(TITLEBAR_FIXED_TOOLS[id])).length
  const rightFixed = RIGHT_FIXED_IDS.filter(id => shown(TITLEBAR_FIXED_TOOLS[id])).length

  return { left: leftFixed + leftExtras, right: appActions + rightFixed + rightExtras }
}
