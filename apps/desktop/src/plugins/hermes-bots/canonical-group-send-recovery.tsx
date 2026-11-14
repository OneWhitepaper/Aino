import { ConfirmDialog } from '@hermes/plugin-sdk'
import { useRef, useState } from 'react'

import type { useCanonicalGroupLabels } from './canonical-group-labels'
import {
  abandonCanonicalGroupSend,
  type PreparedCanonicalGroupSend,
  readCanonicalGroupSend
} from './canonical-group-send'
import { groupComposerDraftSnapshot } from './group-panes'

interface RecoveryProps {
  pending: PreparedCanonicalGroupSend | null
  composerKey: string
  blocked: boolean
  visible: boolean
  labels: ReturnType<typeof useCanonicalGroupLabels>
  isCurrent: () => boolean
  onAbandoned: (entry: PreparedCanonicalGroupSend, draftRevision: number) => void
  onError: (message: string) => void
}

/** Confirmation owns a frozen journal snapshot. It cannot silently approve a later retry. */
export function useCanonicalGroupSendRecovery(props: RecoveryProps) {
  const { pending, composerKey, blocked, visible, labels, isCurrent, onAbandoned, onError } = props
  const [snapshot, setSnapshot] = useState<{ entry: PreparedCanonicalGroupSend; draftRevision: number } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const capturePending = useRef(false)

  const begin = async () => {
    if (!pending || blocked || snapshot || capturePending.current || !isCurrent()) {
      return
    }
    capturePending.current = true
    setCapturing(true)

    try {
      // The displayed pending record predates attempt counting. Read once before confirmation,
      // then keep that exact count/payload even if confirmation later fails.
      const entry = await readCanonicalGroupSend(pending.binding)

      if (!isCurrent()) {
        return
      }

      if (
        !entry ||
        JSON.stringify(entry.params) !== JSON.stringify(pending.params) ||
        JSON.stringify(entry.binding) !== JSON.stringify(pending.binding)
      ) {
        throw new Error(labels.abandonRetryChanged)
      }

      setSnapshot({ entry, draftRevision: groupComposerDraftSnapshot(composerKey).revision })
    } catch (error) {
      if (isCurrent()) {
        onError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      capturePending.current = false

      if (isCurrent()) {
        setCapturing(false)
      }
    }
  }

  const confirm = async () => {
    if (!snapshot || blocked || !visible || !isCurrent()) {
      throw new Error(labels.abandonRetryChanged)
    }

    // Native IPC also fences the calling account's workspace. No read/await before this CAS.
    if (!(await abandonCanonicalGroupSend(snapshot.entry))) {
      throw new Error(labels.abandonRetryChanged)
    }

    if (isCurrent()) {
      onAbandoned(snapshot.entry, snapshot.draftRevision)
    }
  }

  const confirmation = snapshot && (
    <ConfirmDialog
      cancelLabel={labels.cancel}
      confirmLabel={labels.abandonRetry}
      description={labels.abandonRetryWarning}
      destructive
      dismissOnConfirm
      onClose={() => setSnapshot(null)}
      onConfirm={confirm}
      open={visible}
      title={labels.abandonRetry}
    >
      <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm">
        {String(snapshot.entry.params.payload.text ?? '')}
      </p>
    </ConfirmDialog>
  )

  return { begin: () => void begin(), confirming: capturing || snapshot !== null, confirmation }
}
