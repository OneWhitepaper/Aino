import './update-status-compact.css'

import { type ReactElement, useState } from 'react'

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
import type { DesktopUpdateStatus } from '@/global'
import { type Translations, useI18n } from '@/i18n'
import { compactUpdateCopy, type CompactUpdateCopy } from '@/i18n/update-status-compact'
import { DOWNLOAD_URL } from '@/lib/brand'
import { openExternalLink } from '@/lib/external-link'
import { AlertCircle, Check, Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { openUpdateOverlayFor, startActiveUpdate, type UpdateApplyState, type UpdateTarget } from '@/store/updates'

import type { UpdateStatusView } from './update-status'

interface CompactUpdateStatusProps {
  apply: UpdateApplyState
  checking: boolean
  onCheck: () => Promise<void>
  status: DesktopUpdateStatus | null
  target: UpdateTarget
  view: UpdateStatusView
}

interface CompactUpdateFlags {
  retired: boolean
  applying: boolean
  terminal: boolean
  busy: boolean
  applyError: boolean
  failed: boolean
  current: boolean
}

function updateFlags({ apply, checking, status, target, view }: CompactUpdateStatusProps): CompactUpdateFlags {
  const retired = target === 'client' && Boolean(status?.retirement)
  const applying = apply.applying || apply.stage === 'restart'
  const terminal = ['error', 'manual', 'guiSkew'].includes(apply.stage)
  const busy = !retired && (applying || checking)
  const applyError = apply.stage === 'error'

  return {
    retired,
    applying,
    terminal,
    busy,
    applyError,
    failed: !busy && !retired && (applyError || view.tone === 'error'),
    current: Boolean(status) && view.tone === 'idle' && !terminal && !busy
  }
}

function statusLine(
  { apply, checking, status, target, view }: CompactUpdateStatusProps,
  flags: CompactUpdateFlags,
  copy: CompactUpdateCopy,
  u: Translations['updates']
): string | null {
  if (flags.retired) {
    return view.line
  }

  if (flags.applyError) {
    return u.errorTitle
  }

  if (flags.applying || flags.terminal) {
    return u.stages[apply.stage]
  }

  if (checking) {
    return u.checkingShort
  }

  if (flags.failed) {
    return copy.failed
  }

  if (flags.current) {
    return status?.held || status?.channel === 'stable' || target === 'backend' ? view.line : copy.current
  }

  return status ? view.line : null
}

function actionFor(
  { apply, checking, target, view }: CompactUpdateStatusProps,
  flags: CompactUpdateFlags
): 'installer' | 'progress' | 'install' | 'check' {
  if (target === 'client' && (flags.retired || !view.supported || apply.stage === 'guiSkew')) {
    return 'installer'
  }

  if (flags.applying || flags.terminal || !view.supported) {
    return 'progress'
  }

  if (!checking && !flags.failed && !flags.retired && view.updateAvailable) {
    return 'install'
  }

  return 'check'
}

function CompactStatusMark({ flags }: { flags: CompactUpdateFlags }): ReactElement | null {
  if (flags.busy) {
    return <Loader2 className="animate-spin" />
  }

  if (flags.failed || flags.retired) {
    return <AlertCircle />
  }

  if (flags.current) {
    return <Check />
  }

  return null
}

function updatePercent(apply: UpdateApplyState): number | null {
  if (typeof apply.percent !== 'number' || !Number.isFinite(apply.percent)) {
    return null
  }

  return Math.max(0, Math.min(100, Math.round(apply.percent)))
}

function failureReason(error: string, copy: CompactUpdateCopy): string {
  if (/ModuleNotFoundError|ImportError:.*(?:No module|cannot import)/i.test(error)) {
    return copy.dependency
  }

  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|ECONNRESET|network error|fetch failed/i.test(error)) {
    return copy.network
  }

  return copy.unknown
}

export function CompactUpdateStatus(props: CompactUpdateStatusProps): ReactElement {
  const { apply, checking, onCheck, target, view } = props
  const { locale, t } = useI18n()
  const copy = compactUpdateCopy(locale)
  const u = t.updates
  const [detailsOpen, setDetailsOpen] = useState(false)
  const flags = updateFlags(props)
  const error = flags.applyError ? apply.error : view.error
  const line = statusLine(props, flags, copy, u)
  const percent = updatePercent(apply)
  const action = actionFor(props, flags)

  const actionLabel =
    action === 'check' ? (checking ? u.checkingShort : u.checkNow) : action === 'install' ? u.updateNow : copy.progress

  const actions = {
    progress: () => openUpdateOverlayFor(target),
    install: () => startActiveUpdate(target),
    check: () => void onCheck()
  }

  return (
    <div aria-live="polite" className="compact-update-status">
      {line && (
        <p className={cn('compact-update-line', (flags.failed || flags.retired) && 'compact-update-line-warning')}>
          <CompactStatusMark flags={flags} />
          <span>{line}</span>
        </p>
      )}
      {flags.retired ? (
        <p className="compact-update-reason">{view.error}</p>
      ) : flags.failed && error && !flags.applyError ? (
        <p className="compact-update-reason">
          {failureReason(error, copy)}{' '}
          <button onClick={() => setDetailsOpen(true)} type="button">
            {copy.details}
          </button>
        </p>
      ) : null}
      {flags.applying && percent !== null && (
        <div className="compact-update-progress">
          <progress aria-label={u.stages[apply.stage]} max={100} value={percent} />
          <span>{percent}%</span>
        </div>
      )}
      {action === 'installer' ? (
        <Button asChild className="compact-update-action" size="sm">
          <a
            href={DOWNLOAD_URL}
            onClick={event => {
              event.preventDefault()
              openExternalLink(DOWNLOAD_URL)
            }}
          >
            {u.openDownloadPage}
          </a>
        </Button>
      ) : (
        <Button
          className="compact-update-action"
          disabled={checking && !flags.applying}
          onClick={actions[action]}
          size="sm"
        >
          {actionLabel}
        </Button>
      )}
      <Dialog onOpenChange={setDetailsOpen} open={detailsOpen}>
        <DialogContent className="max-w-[30rem]">
          <DialogHeader>
            <DialogTitle>{copy.detailsTitle}</DialogTitle>
            <DialogDescription>{error ? failureReason(error, copy) : copy.unknown}</DialogDescription>
          </DialogHeader>
          <pre className="compact-update-error" data-selectable-text="true">
            {error}
          </pre>
          <DialogFooter>
            <CopyButton buttonSize="sm" buttonVariant="outline" label={copy.copyDetails} text={error ?? ''} />
            <Button onClick={() => setDetailsOpen(false)} size="sm" variant="outline">
              {t.common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
