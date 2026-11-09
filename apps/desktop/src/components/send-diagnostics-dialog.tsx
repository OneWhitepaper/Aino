// Send Diagnostics — the consent-gated debug-bundle upload dialog.
//
// Rendered globally (wiring.tsx, beside ConfirmHost) and driven by the
// $sendDiagnostics store: any surface (the failed-turn error card today)
// opens it via requestSendDiagnostics(). Three faces:
//   consent   — privacy notice (what's collected, who can see it, retention)
//               with an explicit Upload button; nothing is sent before it.
//   uploading — spinner while the backend collects, redacts and uploads.
//   done      — the private diagnostic ID (copyable) + where to pick up the
//               discussion: Aino GitHub Issues.
import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { ISSUES_URL } from '@/lib/brand'
import { openExternalLink } from '@/lib/external-link'
import { ExternalLink, Loader2Icon, Lock } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $sendDiagnostics,
  confirmSendDiagnostics,
  dismissSendDiagnostics,
  requestSendDiagnostics
} from '@/store/send-diagnostics'

const SUPPORT_LINKS = [{ key: 'github', url: ISSUES_URL }] as const

export function SendDiagnosticsHost({ crashRecovery = false }: { crashRecovery?: boolean }) {
  const { t } = useI18n()
  const copy = t.sendDiagnostics
  const state = useStore($sendDiagnostics)

  if (!state) {
    return null
  }

  const busy = state.phase === 'uploading'

  return (
    // Dismissal is allowed in EVERY phase, including mid-upload: the store's
    // generation guard makes a dismissed upload's completion a no-op, so Esc/
    // backdrop/Cancel are always an immediate way out (cancellation of the
    // in-flight request itself stays best-effort).
    <Dialog onOpenChange={open => (!open ? dismissSendDiagnostics() : undefined)} open>
      <DialogContent
        aria-busy={busy}
        className={cn('max-w-[30rem]', crashRecovery && 'z-[calc(var(--z-crash)+2)]')}
        footer={
          <DialogFooter>
            <Button onClick={dismissSendDiagnostics} type="button" variant="ghost">
              {state.phase === 'consent' ? copy.cancel : copy.close}
            </Button>
            {state.phase === 'consent' || busy ? (
              <Button disabled={busy} onClick={() => void confirmSendDiagnostics()} type="button">
                {busy ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    {copy.uploading}
                  </span>
                ) : (
                  copy.upload
                )}
              </Button>
            ) : state.phase === 'error' ? (
              <Button onClick={() => requestSendDiagnostics(state.errorContext)} type="button">
                {t.common.retry}
              </Button>
            ) : null}
          </DialogFooter>
        }
        overlayClassName={crashRecovery ? 'z-[calc(var(--z-crash)+1)]' : undefined}
      >
        {state.phase === 'consent' || state.phase === 'uploading' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="size-4 text-(--ui-text-tertiary)" />
                {copy.title}
              </DialogTitle>
              <DialogDescription className="whitespace-pre-line text-left">{copy.privacyNotice}</DialogDescription>
            </DialogHeader>
            {busy && (
              <p
                className="m-0 text-[length:var(--aino-text-body)] leading-relaxed text-(--ui-text-secondary)"
                role="status"
              >
                {copy.closeWhileUploadingHint}
              </p>
            )}
          </>
        ) : state.phase === 'error' ? (
          <>
            <DialogHeader>
              <DialogTitle>{copy.failedTitle}</DialogTitle>
              <DialogDescription className="whitespace-pre-line">{copy.failedHint}</DialogDescription>
            </DialogHeader>
            {state.error && (
              <p
                className="m-0 min-w-0 whitespace-pre-wrap rounded-(--aino-radius-control) bg-(--ui-bg-quaternary) p-3 text-[length:var(--aino-text-body)] leading-relaxed text-(--ui-text-secondary) [overflow-wrap:anywhere]"
                role="alert"
              >
                {state.error}
              </p>
            )}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{copy.doneTitle}</DialogTitle>
              <DialogDescription className="text-left">{copy.doneDescription}</DialogDescription>
            </DialogHeader>
            {state.result?.uploadId && (
              <div
                className="flex min-w-0 items-start gap-2 rounded-(--aino-radius-control) bg-(--ui-bg-quaternary) px-3 py-2"
                data-selectable-text="true"
              >
                <code className="min-w-0 flex-1 whitespace-pre-wrap text-[length:var(--aino-text-body)] leading-relaxed text-(--ui-text-secondary) [overflow-wrap:anywhere]">
                  {copy.uploadIdFallback(state.result.uploadId)}
                </code>
                <CopyButton
                  appearance="inline"
                  className="shrink-0"
                  label={copy.copyLink}
                  text={state.result.uploadId}
                />
              </div>
            )}
            <div className="text-[length:var(--aino-text-body)] text-(--ui-text-secondary)">{copy.handoffLead}</div>
            <div className="flex flex-wrap gap-1.5">
              {SUPPORT_LINKS.map(link => (
                <Button key={link.key} onClick={() => openExternalLink(link.url)} size="sm" variant="outline">
                  <ExternalLink className="size-3" />
                  {copy.links[link.key]}
                </Button>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
