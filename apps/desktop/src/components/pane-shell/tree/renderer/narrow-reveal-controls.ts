import { type Dispatch, type SetStateAction, useEffect } from 'react'

import { registry } from '@/contrib/registry'
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from '@/lib/escape-layers'
import { hostHas } from '@/lib/host-capabilities'

import { PANE_TOGGLE_REVEAL_EVENT } from '../..'
import { allPaneIds, findGroupOfPane } from '../model'
import { $hiddenTreePanes, $layoutTree } from '../store'

import { narrowToolPaneIds, paneChrome } from './track-model'

export interface NarrowRevealState {
  id: string
  pinned: boolean
}

type RevealMode = 'close' | 'open' | 'toggle'
type SetReveal = Dispatch<SetStateAction<NarrowRevealState | null>>

/** Explicit reveals read current stores: opening may unhide a pane in the same turn. */
function revealMatch(id: string) {
  const tree = $layoutTree.get()
  const ids = new Set(tree ? allPaneIds(tree) : [])
  const panes = registry.getArea('panes')
  const tools = tree ? narrowToolPaneIds(tree, paneId => panes.find(pane => pane.id === paneId)) : new Set<string>()

  return panes.find(
    pane =>
      (paneChrome(pane).collapsible || tools.has(pane.id)) &&
      ids.has(pane.id) &&
      !$hiddenTreePanes.get().has(pane.id) &&
      (pane.id === id || paneChrome(pane).revealAliases?.includes(id))
  )
}

function nextReveal(current: NarrowRevealState | null, id: string, mode: RevealMode): NarrowRevealState | null {
  if (mode === 'open') {
    return { id, pinned: true }
  }

  if (mode === 'close') {
    const tree = $layoutTree.get()
    const zone = tree && hostHas('narrowOverlayChrome') ? findGroupOfPane(tree, id) : null

    return current && (current.id === id || zone?.panes.includes(current.id)) ? null : current
  }

  return current?.id === id && current.pinned ? null : { id, pinned: true }
}

/** Keyboard toggles pin their overlay; Escape owns exactly one visible layer. */
export function useNarrowRevealControls(
  narrow: boolean,
  solo: boolean,
  reveal: NarrowRevealState | null,
  setReveal: SetReveal
) {
  const active = reveal !== null
  useEffect(() => (active ? pushEscapeLayer(ESCAPE_PRIORITY.narrowOverlay) : undefined), [active])

  useEffect(() => {
    if (!narrow || solo) {
      setReveal(null)

      return
    }

    const onToggle = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; mode?: RevealMode }>).detail
      const match = detail?.id ? revealMatch(detail.id) : undefined

      if (match) {
        setReveal(current => nextReveal(current, match.id, detail?.mode ?? 'toggle'))
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.narrowOverlay)) {
        return
      }

      event.preventDefault()
      setReveal(null)
    }

    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, onToggle)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, onToggle)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [narrow, setReveal, solo])
}
