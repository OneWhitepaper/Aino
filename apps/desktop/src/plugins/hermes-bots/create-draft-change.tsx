import { ConfirmDialog } from '@hermes/plugin-sdk'
import { useState } from 'react'

import type { CapabilityEntry } from './profile-config'

export interface CapabilityCatalog {
  mcp: CapabilityEntry[]
  skills: CapabilityEntry[]
  source: string
  toolsets: CapabilityEntry[]
}

export function useDraftCapabilities() {
  const [createdForCaps, setCreatedForCaps] = useState<null | string>(null)
  const [caps, setCaps] = useState<CapabilityCatalog | null>(null)
  const [capsFailed, setCapsFailed] = useState(false)
  const [dirtyCaps, setDirtyCaps] = useState({ skills: false, toolsets: false, mcp: false })
  const [capFilter, setCapFilter] = useState('')

  return {
    createdForCaps,
    setCreatedForCaps,
    caps,
    setCaps,
    capsFailed,
    setCapsFailed,
    dirtyCaps,
    setDirtyCaps,
    capFilter,
    setCapFilter,
    resetCapabilities: () => {
      setCreatedForCaps(null)
      setCaps(null)
      setCapsFailed(false)
      setDirtyCaps({ skills: false, toolsets: false, mcp: false })
      setCapFilter('')
    }
  }
}

export interface DraftResetSnapshot {
  remove: () => Promise<void>
}

interface DraftChangeLabels {
  title: string
  description: string
  confirmLabel: string
}

interface DraftBaseChangeOptions {
  capture: () => DraftResetSnapshot | null
  afterReset: () => void
  labels: DraftChangeLabels
}

/** Base changes discard initialized capabilities only after an explicit, successful reset. */
export function useDraftBaseChange({ capture, afterReset, labels }: DraftBaseChangeOptions) {
  const [pending, setPending] = useState<null | { snapshot: DraftResetSnapshot; apply: () => void }>(null)

  const change = (apply: () => void) => {
    const snapshot = capture()

    if (!snapshot) {
      apply()

      return
    }

    setPending({ snapshot, apply })
  }

  return {
    change,
    dialog: (
      <ConfirmDialog
        confirmLabel={labels.confirmLabel}
        description={labels.description}
        destructive
        dismissOnConfirm
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) {
            return
          }
          await pending.snapshot.remove()
          afterReset()
          pending.apply()
        }}
        open={Boolean(pending)}
        title={labels.title}
      />
    )
  }
}
