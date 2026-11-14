import { useStore } from '@nanostores/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { MessageCircle } from '@/lib/icons'
import { invalidateProfileScopedQueries } from '@/lib/query-client'
import type { AccountActions } from '@/store/account'
import { notifySessionsChanged } from '@/store/live-sync'
import { notify } from '@/store/notifications'
import { invalidateProfileListFetches, refreshProfiles } from '@/store/profile'
import { $connection } from '@/store/session'

import type { LegacyHistoryInspection } from '../../../shared/legacy-history-recovery'
import type { PlatformAccountWindowOwner } from '../../../shared/platform-contract'

import { useAccountActions } from './account-context'
import { legacyHistoryRecoveryCopy } from './legacy-history-recovery-copy'

function accountOwner(actions: AccountActions): PlatformAccountWindowOwner | null {
  const state = actions.state.get()
  const snapshot = actions.snapshot.get()

  return state.adapter === 'platform' &&
    state.authenticated &&
    snapshot?.account &&
    state.account?.id === snapshot.account.id
    ? { userId: snapshot.account.id, mode: snapshot.mode, revision: snapshot.revision }
    : null
}

const ownerKey = (owner: PlatformAccountWindowOwner | null) =>
  owner ? JSON.stringify([owner.mode, owner.userId, owner.revision]) : null

function useLegacyHistory() {
  const actions = useAccountActions()
  useStore(actions.state)
  useStore(actions.snapshot)
  const owner = accountOwner(actions)
  const key = ownerKey(owner)
  const local = useStore($connection)?.mode === 'local'
  const native = window.hermesDesktop?.legacyHistoryRecovery
  const current = useCallback(() => key !== null && ownerKey(accountOwner(actions)) === key, [actions, key])

  const query = useQuery({
    queryKey: ['legacy-history-recovery', key],
    enabled: Boolean(owner && native && local),
    retry: false,
    staleTime: 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const result = await native!.inspect(owner!)
      signal.throwIfAborted()

      return result
    }
  })

  const { refetch } = query
  const snoozedUntil = query.data?.snoozedUntil

  useEffect(() => {
    if (!snoozedUntil || !local) {
      return
    }

    const timer = window.setTimeout(() => void refetch(), Math.max(0, snoozedUntil - Date.now()))

    return () => window.clearTimeout(timer)
  }, [local, refetch, snoozedUntil])

  return { current, key, local, native, owner, query }
}

type HistoryContext = ReturnType<typeof useLegacyHistory>

interface RecoveryCardProps {
  context: HistoryContext
  data: LegacyHistoryInspection
}

function RecoveryCard({ context: { current, key, native, owner }, data }: RecoveryCardProps) {
  const { locale } = useI18n()
  const copy = legacyHistoryRecoveryCopy(locale)
  const client = useQueryClient()
  const [dialog, setDialog] = useState<'ownership' | 'ignore' | null>(null)
  const [dialogPlan, setDialogPlan] = useState<LegacyHistoryInspection | null>(null)
  const [includeUnowned, setIncludeUnowned] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operation, setOperation] = useState<'restore' | 'later' | 'ignore' | null>(null)
  const [completedPlan, setCompletedPlan] = useState<string | null>(null)
  const running = useRef(false)
  const mounted = useRef(true)
  const busy = operation !== null

  // eslint-disable-next-line no-restricted-syntax -- mount lifetime only; account freshness is read from its stores
  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  async function restore(adoptUnowned: boolean, plan = data) {
    if (running.current || !native || !owner || !current() || (!plan.owned && !adoptUnowned)) {
      return
    }

    running.current = true
    setOperation('restore')
    setError(null)

    try {
      const result = await native.restore({ expectedOwner: owner, planId: plan.planId, includeUnowned: adoptUnowned })

      if (!current()) {
        return
      }

      if (mounted.current) {
        setDialog(null)
        setCompletedPlan(plan.planId)
        notify({
          kind: 'success',
          title: result.imported ? copy.restored(result.imported) : copy.noneRestored,
          message: copy.safe,
          detail: copy.result(result.skipped, result.conflicts)
        })
      }

      notifySessionsChanged()
      invalidateProfileListFetches()
      void refreshProfiles().catch(() => undefined)
      invalidateProfileScopedQueries()
    } catch {
      if (mounted.current && current()) {
        setError(copy.failed)
      }
    } finally {
      running.current = false

      if (mounted.current && current()) {
        setOperation(null)
      }
    }
  }

  async function remind(choice: 'later' | 'ignore', plan = data) {
    if (running.current || !native || !owner || !current()) {
      return false
    }

    running.current = true
    setOperation(choice)
    setError(null)

    try {
      const result = await native.remind({ expectedOwner: owner, planId: plan.planId, choice })

      if (!current()) {
        return false
      }

      client.setQueryData<LegacyHistoryInspection>(['legacy-history-recovery', key], existing =>
        existing?.reminderKey === result.reminderKey ? { ...existing, ...result } : existing
      )

      if (mounted.current) {
        setDialog(null)
      }

      return true
    } catch {
      if (mounted.current && current()) {
        setError(copy.remindFailed)
      }

      return false
    } finally {
      running.current = false

      if (mounted.current && current()) {
        setOperation(null)
      }
    }
  }

  if (completedPlan === data.planId) {
    return null
  }

  return (
    <>
      <section
        aria-label={copy.title}
        className="absolute top-4 right-4 z-20 w-90 max-w-[calc(100%-2rem)] animate-in rounded-(--aino-radius-panel) bg-(--ui-bg-elevated) p-4 text-(--ui-text-primary) shadow-nous fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none"
      >
        <div className="flex items-start gap-2.5">
          <MessageCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-(--ui-text-secondary)" />
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-sm leading-5 font-medium [overflow-wrap:anywhere]">{copy.title}</h2>
            <p className="text-xs leading-5 text-(--ui-text-secondary) [overflow-wrap:anywhere]">{copy.description}</p>
          </div>
        </div>
        {error && dialog === null && (
          <p className="mt-3 text-xs leading-5 text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
          <Button
            disabled={busy}
            onClick={() => {
              setDialogPlan(data)
              setDialog('ignore')
            }}
            size="sm"
            variant="ghost"
          >
            {copy.ignore}
          </Button>
          <Button
            disabled={busy}
            loading={operation === 'later'}
            onClick={() => void remind('later')}
            size="sm"
            variant="ghost"
          >
            {copy.later}
          </Button>
          <Button
            aria-label={copy.sync}
            disabled={busy}
            loading={operation === 'restore'}
            onClick={() => {
              if (data.unowned) {
                setDialogPlan(data)
                setIncludeUnowned(false)
                setError(null)
                setDialog('ownership')
              } else {
                void restore(false)
              }
            }}
            size="sm"
          >
            {copy.sync}
          </Button>
        </div>
      </section>
      {dialog === 'ownership' && dialogPlan && (
        <Dialog onOpenChange={value => !value && !busy && setDialog(null)} open>
          <DialogContent
            className="max-w-md"
            dismissDisabled={busy}
            footer={
              <DialogFooter>
                <Button disabled={busy} onClick={() => setDialog(null)} variant="ghost">
                  {copy.cancel}
                </Button>
                <Button
                  aria-label={copy.sync}
                  disabled={busy || (!dialogPlan.owned && !includeUnowned)}
                  loading={operation === 'restore'}
                  onClick={() => void restore(includeUnowned, dialogPlan)}
                >
                  {copy.sync}
                </Button>
              </DialogFooter>
            }
            header={
              <DialogHeader>
                <DialogTitle>{copy.ownershipTitle}</DialogTitle>
              </DialogHeader>
            }
          >
            <DialogDescription>{copy.safe}</DialogDescription>
            <div className="space-y-3 text-sm">
              {dialogPlan.owned > 0 && <p>{copy.confirmed(dialogPlan.owned)}</p>}
              <p className="text-(--ui-text-secondary)">{copy.unowned(dialogPlan.unowned)}</p>
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={includeUnowned}
                  disabled={busy}
                  onCheckedChange={value => setIncludeUnowned(value === true)}
                />
                <span className="min-w-0 leading-5">{copy.confirmUnowned}</span>
              </label>
              {dialogPlan.conflicts > 0 && <p className="text-xs text-(--ui-text-secondary)">{copy.conflicts}</p>}
              {dialogPlan.pending > 0 && <p className="text-xs text-(--ui-text-secondary)">{copy.pending}</p>}
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
      {dialog === 'ignore' && dialogPlan && (
        <ConfirmDialog
          busyLabel={copy.saving}
          cancelLabel={copy.cancel}
          confirmLabel={copy.confirmIgnore}
          description={copy.ignoreDescription}
          dismissOnConfirm
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (!(await remind('ignore', dialogPlan))) {
              throw new Error(copy.remindFailed)
            }
          }}
          open
          title={copy.ignoreTitle}
        />
      )}
    </>
  )
}

function ConversationHistoryReminder() {
  const context = useLegacyHistory()
  const data = context.current() ? context.query.data : undefined

  return context.local && context.native && data?.showReminder && data.owned + data.unowned > 0 ? (
    <RecoveryCard context={context} data={data} key={`${context.key}:${data.reminderKey}`} />
  ) : null
}

export function LegacyHistoryRecoveryPrompt() {
  return window.hermesDesktop?.legacyHistoryRecovery ? <ConversationHistoryReminder /> : null
}
