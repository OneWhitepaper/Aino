import { type Codec, persistentAtom } from '@/lib/persisted'
import { DEFAULT_INTERFACE_MODE, type InterfaceMode, shownInMode, type Tiered } from '@/store/interface-mode'

export type TitlebarAppActionsSide = 'left' | 'right'

const STORAGE_KEY = 'hermes.desktop.titlebarAppActions'

/** Layout, HUD, and haptics default to the right of the workspace title. */
export const TITLEBAR_APP_ACTIONS_DEFAULT: TitlebarAppActionsSide = 'right'

const codec: Codec<TitlebarAppActionsSide> = {
  decode: raw => (raw === 'left' || raw === 'right' ? raw : TITLEBAR_APP_ACTIONS_DEFAULT),
  encode: value => value
}

export const $titlebarAppActionsSide = persistentAtom<TitlebarAppActionsSide>(
  STORAGE_KEY,
  TITLEBAR_APP_ACTIONS_DEFAULT,
  codec
)

export function setTitlebarAppActionsSide(side: TitlebarAppActionsSide) {
  $titlebarAppActionsSide.set(side)
}

/**
 * The fixed titlebar tools and which of them are instrumentation. ONE table:
 * the buttons spread their entry to render, the width reservation counts the
 * same entries, so a tool Simple hides also releases the space it held.
 * Layout and haptics remain available in either mode.
 */
export const TITLEBAR_FIXED_TOOLS = {
  'flip-panes': { tier: 'advanced' },
  hud: { tier: 'advanced' },
  haptics: {},
  layout: {},
  'right-sidebar': { tier: 'advanced' },
  summary: { tier: 'advanced' },
  terminal: { tier: 'advanced' },
  sidebar: {}
} satisfies Record<string, Tiered>

export type TitlebarFixedToolId = keyof typeof TITLEBAR_FIXED_TOOLS

/** App actions follow `side`; the sidebar and flip toggles stay left. */
const APP_ACTION_IDS: readonly TitlebarFixedToolId[] = ['layout', 'hud', 'haptics']
const RIGHT_FIXED_IDS: readonly TitlebarFixedToolId[] = ['summary', 'terminal', 'right-sidebar']

/** Button counts for the two titlebar clusters, for the mode that is rendering them. */
export function titlebarAppActionsClusterCounts(
  side: TitlebarAppActionsSide,
  leftExtras = 0,
  rightExtras = 0,
  mode: InterfaceMode = DEFAULT_INTERFACE_MODE
): { left: number; right: number } {
  const shown = shownInMode(mode)
  const leftFixed = 1 + Number(shown(TITLEBAR_FIXED_TOOLS['flip-panes']))
  const appActions = APP_ACTION_IDS.filter(id => shown(TITLEBAR_FIXED_TOOLS[id])).length
  const rightFixed = RIGHT_FIXED_IDS.filter(id => shown(TITLEBAR_FIXED_TOOLS[id])).length

  if (side === 'left') {
    return { left: leftFixed + appActions + leftExtras, right: rightFixed + rightExtras }
  }

  return { left: leftFixed + leftExtras, right: appActions + rightFixed + rightExtras }
}
