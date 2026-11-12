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
   *  "Remove from sidebar" beside "Delete worktree"). Closes on success. */
  secondaryAction?: ConfirmSecondaryAction
}

interface ConfirmSecondaryAction {
  label: string
  busyLabel?: string
  onClick: () => unknown
}

interface ConfirmationLifecycle {
  active: boolean
  closeTimer: null | number
  running: boolean
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
  const errorRef = useRef<HTMLDivElement>(null)
  const lifecycleRef = useRef<ConfirmationLifecycle | null>(null)
  const [status, setStatus] = useState<'done' | 'idle' | 'saving'>('idle')
  const [runningSecondary, setRunningSecondary] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const busy = status === 'saving' || status === 'done'
  const resolvedConfirmLabel = confirmLabel ?? t.common.confirm
  const resolvedBusyLabel = busyLabel ?? t.common.loading
  const resolvedDoneLabel = doneLabel ?? t.common.done
  const resolvedCancelLabel = cancelLabel ?? t.common.cancel

  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [error])

  function closeIdle() {
    if (!busy && !lifecycleRef.current?.running) {
      onClose()
    }
  }

  // Each opening owns its async results and done timer. A confirmation can
  // remove this dialog before resolving, or finish after another opening.
  // The ref holds a lifecycle token, not a mirror of reactive state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!open) {
      return
    }

    const lifecycle: ConfirmationLifecycle = { active: true, closeTimer: null, running: false }
    lifecycleRef.current = lifecycle
    setStatus('idle')
    setRunningSecondary(false)
    setError(null)

    return () => {
      lifecycle.active = false

      if (lifecycle.closeTimer !== null) {
        window.clearTimeout(lifecycle.closeTimer)
      }
    }
  }, [open])

  async function run(secondary = false) {
    const lifecycle = lifecycleRef.current

    if (busy || !lifecycle?.active || lifecycle.running) {
      return
    }

    // The ref closes the same-event-loop gap before React paints disabled.
    lifecycle.running = true
    setRunningSecondary(secondary)
    setError(null)
    setStatus('saving')

    try {
      const result = secondary ? secondaryAction?.onClick() : onConfirm()

      if (result) {
        await result
      }

      if (!lifecycle.active) {
        return
      }

      if (secondary || dismissOnConfirm) {
        lifecycle.running = false
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
      lifecycle.running = false
      setError(err instanceof Error ? err.message : t.errors.genericFailure)
    }
  }

  return (
    <Dialog onOpenChange={value => !value && closeIdle()} open={open}>
      <DialogContent
        aria-busy={busy}
        className="max-w-md rounded-(--aino-radius-panel)"
        dismissDisabled={busy}
        footer={
          <DialogFooter>
            <Button disabled={busy} onClick={closeIdle} ref={cancelRef} type="button" variant="ghost">
              {resolvedCancelLabel}
            </Button>
            {secondaryAction && (
              <Button disabled={busy} onClick={() => void run(true)} type="button" variant="secondary">
                <ActionStatus
                  busy={secondaryAction.busyLabel ?? resolvedBusyLabel}
                  done={secondaryAction.label}
                  idle={secondaryAction.label}
                  state={runningSecondary ? status : 'idle'}
                />
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => void run()}
              ref={confirmRef}
              type="button"
              variant={destructive ? 'destructive' : 'default'}
            >
              <ActionStatus
                busy={resolvedBusyLabel}
                done={resolvedDoneLabel}
                idle={resolvedConfirmLabel}
                state={runningSecondary ? 'idle' : status}
              />
            </Button>
          </DialogFooter>
        }
        header={
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        }
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
        {/* pre-line: a backend-composed description keeps its paragraph
            breaks instead of collapsing into one run-on line (#112458). */}
        {description ? <DialogDescription className="whitespace-pre-line">{description}</DialogDescription> : null}

        {children}
        {error && (
          <div
            className="flex min-w-0 items-start gap-2 rounded-(--aino-radius-control) bg-(--ui-bg-quaternary) px-3 py-2 text-[length:var(--aino-text-body)] leading-relaxed text-(--ui-text-secondary)"
            ref={errorRef}
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{error}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
