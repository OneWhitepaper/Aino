import { atom } from 'nanostores'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { dockToolPanelPane, revealTreePane } from '@/components/pane-shell/tree/store'
import { matchesQuery } from '@/hooks/use-media-query'
import { persistBoolean, storedBoolean } from '@/lib/storage'
import { modeBound } from '@/store/interface-mode'

const TAKEOVER_KEY = 'hermes.desktop.terminalTakeover'

// Simple mode rests the terminal closed without touching this preference; ⌃`
// still brings it up for the session.
const $terminalTakeoverPref = atom(storedBoolean(TAKEOVER_KEY, false))

$terminalTakeoverPref.subscribe(active => persistBoolean(TAKEOVER_KEY, active))

export const $terminalTakeover = modeBound('terminalOpen', $terminalTakeoverPref, active =>
  $terminalTakeoverPref.set(active)
)

export const setTerminalTakeover = (active: boolean) => {
  $terminalTakeover.set(active)

  if (active && $terminalTakeover.get()) {
    dockToolPanelPane('terminal')
    revealTreePane('terminal')

    if (matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'terminal', mode: 'open' } }))
    }
  }
}

/** A command queued to run in the embedded terminal. The terminal pane flushes
 *  (and clears) it once its session is live, so a value set before the pane
 *  mounts still runs. Cleared after flush so a later remount can't replay it. */
export const $terminalInjection = atom<null | string>(null)

/** Open the terminal pane and run a command in it. Used to disconnect external
 *  (CLI-managed) providers, which Hermes can't clear via the API — the user
 *  sees exactly what runs instead of Hermes silently deleting their creds. */
export const runInTerminal = (command: string) => {
  const trimmed = command.trim()

  if (!trimmed) {
    return
  }

  setTerminalTakeover(true)
  $terminalInjection.set(trimmed)
}
