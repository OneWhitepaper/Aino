import { useStore } from '@nanostores/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import type { UpdateHoldWire } from '@/global'
import { useI18n } from '@/i18n'
import { AlertTriangle, FileText, Loader2, Power, RefreshCw } from '@/lib/icons'
import { $desktopBoot } from '@/store/boot'

type Busy = 'quit' | 'recheck' | 'start' | null

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * The blocked boot screen (review R8 D3). While an earlier update's leftover
 * process holds the install — or the update helper cannot tell who owns it —
 * the local backend does not start, ever, on a timer. The user sees what holds
 * the install and can check again or quit; the only way through while the
 * hold lasts is an explicit, confirmed Start anyway that main logs. Main
 * starts the backend by itself as soon as the hold ends.
 */
export function UpdateHoldOverlay() {
  const boot = useStore($desktopBoot)
  const { t } = useI18n()
  const safeActionRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [confirming, setConfirming] = useState(false)
  const [refused, setRefused] = useState(false)
  const hold: UpdateHoldWire | null = boot.error ? null : (boot.updateHold ?? null)
  const holdId = hold?.holdId ?? null
  const checkedAt = hold?.checkedAt ?? null

  // A new check landed: Check again is done.
  useEffect(() => {
    setBusy(current => (current === 'recheck' ? null : current))
  }, [checkedAt])

  // A different hold is a different decision: drop a pending confirmation.
  useEffect(() => {
    setConfirming(false)
    setBusy(null)
  }, [holdId])

  useEffect(() => {
    safeActionRef.current?.focus()
  }, [confirming, holdId])

  if (!hold) {
    return null
  }

  const copy = t.boot.updateHold
  const unverified = hold.verdict !== 'held'

  const recheck = async () => {
    setRefused(false)
    setBusy('recheck')
    const result = await window.hermesDesktop?.updateHold.recheck().catch(() => null)

    if (!result?.ok) {
      setBusy(null)
    }
  }

  const quit = async () => {
    setBusy('quit')
    await window.hermesDesktop?.updateHold.quit().catch(() => undefined)
  }

  const startAnyway = async () => {
    setBusy('start')

    const result = await window.hermesDesktop?.updateHold
      .startAnyway({ holdId: hold.holdId, confirmed: true })
      .catch(() => null)

    if (!result?.ok) {
      setRefused(true)
      setConfirming(false)
      setBusy(null)
    }
  }

  const openLogs = () => void window.hermesDesktop?.revealLogs().catch(() => undefined)

  return (
    <Dialog open>
      <DialogPortal>
        <DialogPrimitive.Content
          asChild
          onEscapeKeyDown={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
          onOpenAutoFocus={event => {
            event.preventDefault()
            safeActionRef.current?.focus()
          }}
          role="alertdialog"
        >
          <div
            className="fixed inset-0 z-(--z-setup) flex items-center justify-center bg-(--ui-chat-surface-background) p-4"
            // The full-screen opaque layer also owns the modal focus trap.
            data-glass-opaque=""
            data-testid="update-hold-overlay"
          >
            <div className="relative flex max-h-[85vh] w-full max-w-[40rem] flex-col overflow-hidden rounded-(--aino-radius-panel) border border-(--stroke-nous) bg-(--ui-bg-elevated) text-[length:var(--aino-text-body)] shadow-nous">
              <div
                className="grid min-h-0 min-w-0 gap-4 overflow-y-auto overscroll-contain p-5"
                data-slot="update-hold-body"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-(--ui-yellow)" />
                  <div className="min-w-0">
                    <DialogTitle>
                      {confirming ? copy.confirmTitle : unverified ? copy.titleUnverified : copy.title}
                    </DialogTitle>
                    <DialogDescription className="mt-1">
                      {confirming ? copy.confirmBody : copy.description}
                    </DialogDescription>
                  </div>
                </div>
                <Alert data-testid="update-hold-detail" role="status" variant="warning">
                  <AlertDescription className="col-span-2 col-start-1">
                    <p>
                      {unverified
                        ? copy.unverified
                        : hold.ownerPid
                          ? copy.heldByProcess(hold.ownerPid)
                          : copy.heldUnknown}
                    </p>
                    <p className="text-[length:var(--aino-text-caption)] text-muted-foreground">
                      {copy.since(formatTime(hold.since))} · {copy.lastChecked(formatTime(hold.checkedAt))}
                    </p>
                  </AlertDescription>
                </Alert>
                {refused ? (
                  <p
                    className="min-w-0 leading-relaxed text-(--ui-text-secondary) [overflow-wrap:anywhere]"
                    role="alert"
                  >
                    {copy.startAnywayRefused}
                  </p>
                ) : null}
              </div>
              <div
                className="min-w-0 shrink-0 border-t border-(--ui-stroke-tertiary) p-5"
                data-slot="update-hold-footer"
              >
                {confirming ? (
                  <DialogFooter>
                    <Button
                      disabled={Boolean(busy)}
                      onClick={() => setConfirming(false)}
                      ref={safeActionRef}
                      variant="secondary"
                    >
                      {copy.confirmKeepWaiting}
                    </Button>
                    <Button disabled={Boolean(busy)} onClick={() => void startAnyway()} variant="destructive">
                      {busy === 'start' ? <Loader2 className="animate-spin" /> : null}
                      {copy.confirmStart}
                    </Button>
                  </DialogFooter>
                ) : (
                  <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={Boolean(busy)} onClick={() => void recheck()} ref={safeActionRef}>
                        {busy === 'recheck' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        {copy.checkAgain}
                      </Button>
                      <Button disabled={Boolean(busy)} onClick={() => void quit()} variant="secondary">
                        {busy === 'quit' ? <Loader2 className="animate-spin" /> : <Power />}
                        {copy.quit}
                      </Button>
                      <Button onClick={openLogs} variant="ghost">
                        <FileText />
                        {copy.openLogs}
                      </Button>
                      <Button
                        className="ml-auto"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setRefused(false)
                          setConfirming(true)
                        }}
                        variant="ghost"
                      >
                        {copy.startAnyway}
                      </Button>
                    </div>
                    <p className="min-w-0 text-[length:var(--aino-text-caption)] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                      {copy.recoveryHint}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
