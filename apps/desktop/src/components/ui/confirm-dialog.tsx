import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { ActionStatus } from '@/components/ui/action-status'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { AlertTriangle } from '@/lib/icons'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  // Does the work. Throw to surface an inline error and keep the dialog open.
  onConfirm: () => Promise<void> | void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  confirmLabel?: string
  busyLabel?: string
  doneLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** Close as soon as onConfirm resolves — for optimistic actions that finish in the background. */
  dismissOnConfirm?: boolean
  /** A third, non-destructive way out, shown between Cancel and Confirm (e.g.
   *  "Remove from sidebar" beside "Delete worktree"). Closes on click. */
  secondaryAction?: ConfirmSecondaryAction
}

interface ConfirmSecondaryAction {
  label: string
  onClick: () => void
}

interface ConfirmationLifecycle {
  active: boolean
  closeTimer: null | number
}

// Shared confirmation dialog: opens on the safe choice for destructive work
// and keeps keyboard ownership with the focused control. Owns the pending →
// done → close beat and inline error, so callers pass only an async onConfirm.
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel,
  busyLabel,
  doneLabel,
  cancelLabel,
  destructive = false,
  dismissOnConfirm = false,
  secondaryAction
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const lifecycleRef = useRef<ConfirmationLifecycle | null>(null)
  const [status, setStatus] = useState<'done' | 'idle' | 'saving'>('idle')
  const [error, setError] = useState<null | string>(null)
  const busy = status === 'saving' || status === 'done'
  const resolvedConfirmLabel = confirmLabel ?? t.common.confirm
  const resolvedBusyLabel = busyLabel ?? t.common.loading
  const resolvedDoneLabel = doneLabel ?? t.common.done
  const resolvedCancelLabel = cancelLabel ?? t.common.cancel

  // Each opening owns its async results and done timer. A confirmation can
  // remove this dialog before resolving, or finish after another opening.
  // The ref holds a lifecycle token, not a mirror of reactive state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!open) {
      return
    }

    const lifecycle: ConfirmationLifecycle = { active: true, closeTimer: null }
    lifecycleRef.current = lifecycle
    setStatus('idle')
    setError(null)

    return () => {
      lifecycle.active = false

      if (lifecycle.closeTimer !== null) {
        window.clearTimeout(lifecycle.closeTimer)
      }
    }
  }, [open])

  async function run() {
    const lifecycle = lifecycleRef.current

    if (busy || !lifecycle?.active) {
      return
    }

    setError(null)

    if (!dismissOnConfirm) {
      setStatus('saving')
    }

    try {
      await onConfirm()

      if (!lifecycle.active) {
        return
      }

      if (dismissOnConfirm) {
        onClose()

        return
      }

      setStatus('done')
      lifecycle.closeTimer = window.setTimeout(onClose, 600)
    } catch (err) {
      if (!lifecycle.active) {
        return
      }

      setStatus('idle')
      setError(err instanceof Error ? err.message : t.errors.genericFailure)
    }
  }

  return (
    <Dialog onOpenChange={value => !value && !busy && onClose()} open={open}>
      <DialogContent
        className="max-w-md rounded-(--aino-radius-panel)"
        onKeyDown={event => {
          // Native buttons already map Enter/Space to their own click. Only
          // retain the convenient Enter shortcut when focus is on the dialog
          // content itself; a focused Cancel must never confirm a destructive
          // action when the user presses Space.
          if (
            event.key === 'Enter' &&
            (event.target === event.currentTarget || event.target === confirmRef.current) &&
            !busy
          ) {
            event.preventDefault()
            void run()
          }
        }}
        onOpenAutoFocus={event => {
          // Radix would focus the close button first. Destructive dialogs use
          // the safe cancel action by default; ordinary dialogs keep the
          // existing fast path on confirm.
          event.preventDefault()

          if (destructive) {
            cancelRef.current?.focus()
          } else {
            confirmRef.current?.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {/* pre-line: a backend-composed description keeps its paragraph
              breaks instead of collapsing into one run-on line (#112458). */}
          {description ? <DialogDescription className="whitespace-pre-line">{description}</DialogDescription> : null}
        </DialogHeader>

        {children}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="mt-2 border-t border-(--ui-stroke-tertiary) pt-3">
          <Button disabled={busy} onClick={onClose} ref={cancelRef} type="button" variant="ghost">
            {resolvedCancelLabel}
          </Button>
          {secondaryAction && (
            <Button
              disabled={busy}
              onClick={() => {
                secondaryAction.onClick()
                onClose()
              }}
              type="button"
              variant="secondary"
            >
              {secondaryAction.label}
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => void run()}
            ref={confirmRef}
            variant={destructive ? 'destructive' : 'default'}
          >
            <ActionStatus
              busy={resolvedBusyLabel}
              done={resolvedDoneLabel}
              idle={resolvedConfirmLabel}
              state={status}
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
