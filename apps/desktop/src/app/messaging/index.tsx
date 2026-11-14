import './messaging.css'

import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { resolveOwnerNow } from '@/api/client'
import { connectMessagingPlatform, type MessagingOnboardingApplied } from '@/api/messaging-onboarding'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  approvePairing,
  getMessagingPlatforms,
  getPairing,
  type MessagingPlatformInfo,
  type MessagingPlatformUpdate,
  type PairingUser,
  revokePairing,
  type TelegramOnboardingApplyResponse,
  updateMessagingPlatform
} from '@/hermes'
import { useI18n } from '@/i18n'
import { localizedMessagingPlatformDescription, localizedMessagingPlatformName } from '@/i18n/messaging-platforms'
import { AlertTriangle, RefreshCw } from '@/lib/icons'
import { normalize } from '@/lib/text'
import { $activeConnectionId } from '@/store/connections'
import { $changeEventsAvailable, $pairingChangeTick, $platformsChangeTick } from '@/store/live-sync'
import { notify, notifyError } from '@/store/notifications'
import { $settingsRequestProfile } from '@/store/settings-scope'
import { $gatewayRestarting, runGatewayRestart, watchGatewayRestartOutcome } from '@/store/system-actions'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

import { PlatformActionBar, PlatformDetail } from './platform-detail'
import { PlatformDialog } from './platform-dialog'
import { type DirectoryFilter, matchesDirectoryFilter, MessagingDirectory } from './platform-directory'

interface MessagingViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

type EditMap = Record<string, Record<string, string>>
interface ConnectionNotice {
  message: string
  updatedAt?: string | null
}

function platformMatchesQuery(platform: MessagingPlatformInfo, query: string, locale: string): boolean {
  const q = normalize(query)

  return (
    !q ||
    [
      platform.id,
      platform.name,
      platform.description,
      platform.state,
      localizedMessagingPlatformName(locale, platform.id, platform.name),
      localizedMessagingPlatformDescription(locale, platform.id, platform.description)
    ].some(value =>
      String(value ?? '')
        .toLowerCase()
        .includes(q)
    )
  )
}

const trimEdits = (edits: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(edits)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v)
  )

/** A saved allowlist emptied in its editor is a clear: trimEdits alone reads "" as untouched. */
function platformChanges(platform: MessagingPlatformInfo, draft: Record<string, string>): MessagingPlatformUpdate {
  const env = trimEdits(draft)

  const clearEnv = platform.env_vars
    .filter(field => field.is_list && field.is_set && draft[field.key]?.trim() === '')
    .map(field => field.key)

  return clearEnv.length ? { env, clear_env: clearEnv } : { env }
}

const hasChanges = (update: MessagingPlatformUpdate) =>
  Object.keys(update.env || {}).length + (update.clear_env?.length ?? 0) > 0

/** Stable row identity: a user id is only unique within its platform. */
const pairingKey = (user: PairingUser) => `${user.platform}:${user.user_id}`

const pairingLabel = (user: PairingUser) => user.user_name || user.user_id

/** Group pairing rows by platform id so a detail pane can slice its own. */
function byPlatform(rows: PairingUser[]): Record<string, PairingUser[]> {
  const grouped: Record<string, PairingUser[]> = {}

  for (const row of rows) {
    ;(grouped[row.platform] ||= []).push(row)
  }

  return grouped
}

export function MessagingView({ setStatusbarItemGroup: _setStatusbarItemGroup, ...props }: MessagingViewProps) {
  const { locale, t } = useI18n()
  const m = t.messaging
  // Shared settings "Applies to" scope, request-shaped (undefined → follow
  // the active profile; the API helpers treat null as "target primary").
  const scopeProfile = useStore($settingsRequestProfile)
  const connectionId = useStore($activeConnectionId)
  const ownerKey = `${connectionId ?? 'local'}:${scopeProfile ?? ''}`
  const [manualSetup, setManualSetup] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const setupCancelRef = useRef<(() => Promise<void> | void) | null>(null)

  const registerSetupCancel = useCallback((cancel: (() => Promise<void> | void) | null) => {
    setupCancelRef.current = cancel
  }, [])

  const [connectNotices, setConnectNotices] = useState<Record<string, ConnectionNotice | undefined>>({})
  const [platforms, setPlatforms] = useState<MessagingPlatformInfo[] | null>(null)
  // A saved credential/toggle only takes effect on the next gateway start, so a
  // vanishing toast is not enough: the page keeps a banner up until a restart
  // actually happens (dashboard parity). Cleared on a completed restart.
  const [restartNeeded, setRestartNeeded] = useState(false)
  const gatewayRestarting = useStore($gatewayRestarting)

  const [pairing, setPairing] = useState<{ approved: PairingUser[]; pending: PairingUser[] }>({
    approved: [],
    pending: []
  })

  const [approving, setApproving] = useState<null | string>(null)
  const [pendingRevoke, setPendingRevoke] = useState<null | PairingUser>(null)
  const [edits, setEdits] = useState<EditMap>({})
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<DirectoryFilter>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const platformIds = useMemo(() => ['', ...(platforms?.map(p => p.id) ?? [])], [platforms])
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [selectedId, setSelectedId] = useRouteEnumParam('platform', platformIds, '')

  const restartGatewayNow = useCallback(async () => {
    // runGatewayRestart never rejects: it toasts the failure and settles the
    // statusbar indicator; the banner stays if the restart did not complete.
    const ok = await runGatewayRestart()

    if (ok) {
      setRestartNeeded(false)
      window.setTimeout(() => void refreshPlatformsRef.current(true), 4000)
    }
  }, [])

  // A multiplexed named profile is re-served from its new config at once (`hot_served`): no restart
  // banner; re-read status once the adapter had a moment to connect. Anything else needs a restart.
  const settleAfterUpdate = useCallback((hotServed: boolean | undefined) => {
    if (hotServed) {
      window.setTimeout(() => void refreshPlatformsRef.current(true), 4000)

      return
    }

    setRestartNeeded(true)
  }, [])

  // The scope each in-flight fetch was issued for. A→B: A's request can resolve
  // AFTER the switch and repaint A's platforms/env snapshot (its redacted
  // Telegram token included) under B until B's own response lands (#96542).
  // A response whose scope is no longer the rendered one is dropped.
  const scopeRef = useRef(ownerKey)

  scopeRef.current = ownerKey

  const refreshPlatforms = useCallback(
    async (silent = false) => {
      if (!silent) {
        setRefreshing(true)
      }

      try {
        const result = await getMessagingPlatforms(scopeProfile)

        if (scopeRef.current === ownerKey) {
          setPlatforms(result.platforms)
        }
      } catch (err) {
        if (!silent) {
          notifyError(err, m.loadFailed)
        }
      } finally {
        if (!silent) {
          setRefreshing(false)
        }
      }
    },
    [m, scopeProfile, ownerKey]
  )

  // Latest-callback ref: the deferred post-restart refresh must not capture a
  // stale scope closure from before a profile switch.
  const refreshPlatformsRef = useRef(refreshPlatforms)

  refreshPlatformsRef.current = refreshPlatforms

  // Pairing has its own signal. platforms.changed tracks connect/disconnect
  // health via gateway_state.json, which a new pairing request never moves —
  // riding it would leave a pending row invisible until something unrelated
  // reconnected. Failures stay silent: an older backend without the endpoint
  // should show no rows, not an error banner over a working page.
  const refreshPairing = useCallback(async () => {
    try {
      const result = await getPairing(scopeProfile)

      if (scopeRef.current === ownerKey) {
        setPairing({ approved: result.approved ?? [], pending: result.pending ?? [] })
      }
    } catch {
      // Leave the last known rows in place rather than blanking them.
    }
  }, [scopeProfile, ownerKey])

  const refreshAll = useCallback(
    async (silent = false) => {
      await Promise.all([refreshPlatforms(silent), refreshPairing()])
    },
    [refreshPairing, refreshPlatforms]
  )

  useRefreshHotkey(() => void refreshAll())

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  // Scope switch: the mounted list still shows the PREVIOUS profile's
  // platforms/pairing while the new fetch is in flight — blank it so stale
  // rows can't be toggled against the wrong backend. This must run during
  // render, not in an effect: passive effects fire after paint, and that
  // first painted frame would show the previous profile's credential
  // placeholders (e.g. a redacted Telegram token) under the new profile's
  // scope for the ~1s until the fetch lands (#96542). Setting state during
  // render makes React throw the stale frame away before it reaches the
  // screen.
  const [prevScope, setPrevScope] = useState(ownerKey)

  if (prevScope !== ownerKey) {
    setPrevScope(ownerKey)
    setPlatforms(null)
    setPairing({ approved: [], pending: [] })
    setEdits({})
    setConfirmDiscard(false)
    setPendingRevoke(null)
    setRestartNeeded(false)
    setManualSetup(false)
    setSetupBusy(false)
    setConnectNotices({})
    setSaving(null)
  }

  const changeEventsAvailable = useStore($changeEventsAvailable)
  const platformsChangeTick = useStore($platformsChangeTick)
  const pairingChangeTick = useStore($pairingChangeTick)

  // A new pending request (or a grant from another surface) moves the pairing
  // store on disk; the change watcher turns that into pairing.changed.
  useEffect(() => {
    if (!changeEventsAvailable || pairingChangeTick === 0 || document.hidden) {
      return
    }

    void refreshPairing()
  }, [changeEventsAvailable, pairingChangeTick, refreshPairing])

  // Connection status updates without a manual "check" click. platforms.changed
  // (the gateway persisting connect/disconnect/health to gateway_state.json)
  // drives the refresh on event-capable backends — no timer; older backends
  // keep the legacy visible-tab poll.
  useEffect(() => {
    if (!changeEventsAvailable || platformsChangeTick === 0 || document.hidden) {
      return
    }

    void refreshPlatforms(true)
  }, [changeEventsAvailable, platformsChangeTick, refreshPlatforms])

  useEffect(() => {
    if (changeEventsAvailable) {
      return
    }

    let cancelled = false

    function tick() {
      if (cancelled || document.hidden) {
        return
      }

      void refreshAll(true)
    }

    const id = window.setInterval(tick, 6000)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [changeEventsAvailable, refreshAll])

  const selected = useMemo(() => {
    if (!platforms) {
      return null
    }

    return platforms.find(platform => platform.id === selectedId) || null
  }, [platforms, selectedId])

  const [previousSelected, setPreviousSelected] = useState(selectedId)

  if (previousSelected !== selectedId) {
    setPreviousSelected(selectedId)
    setManualSetup(false)
    setSetupBusy(false)
  }

  async function connectPlatform(platformId: string) {
    setSaving(`connect:${platformId}`)
    setConnectNotices(current => ({ ...current, [platformId]: undefined }))
    const updatedAt = platforms?.find(row => row.id === platformId)?.updated_at

    try {
      const result = await connectMessagingPlatform(platformId, resolveOwnerNow({ profile: scopeProfile }))

      if (scopeRef.current !== ownerKey) {
        return
      }

      if (result.needs_restart) {
        setRestartNeeded(true)
      }

      if (result.state === 'busy') {
        setConnectNotices(current => ({ ...current, [platformId]: { message: m.qrSetup.busy, updatedAt } }))

        return
      }

      if (!result.ok) {
        throw new Error(result.message || m.states.startup_failed)
      }

      if (result.hot_served) {
        setRestartNeeded(false)
      }

      await refreshPlatforms(true)
    } catch (error) {
      if (scopeRef.current === ownerKey) {
        setConnectNotices(current => ({ ...current, [platformId]: { message: m.states.startup_failed, updatedAt } }))
        notifyError(error, m.failedUpdate(platformId))
      }
    } finally {
      if (scopeRef.current === ownerKey) {
        setSaving(null)
      }
    }
  }

  async function handleQrApplied(result: MessagingOnboardingApplied) {
    if (scopeRef.current !== ownerKey) {
      return
    }

    if (result.needs_activation) {
      await connectPlatform(result.platform)
    }

    await refreshPlatforms(true)
  }

  const quickSetup = usesQuickSetup(selected, manualSetup)

  const pendingByPlatform = useMemo(() => byPlatform(pairing.pending), [pairing.pending])
  const approvedByPlatform = useMemo(() => byPlatform(pairing.approved), [pairing.approved])

  // A detailed state disappears after recovery; keep the existing return-to-All behavior.
  const filterIsPresent =
    ['all', 'configured', 'attention'].includes(statusFilter) ||
    platforms?.some(platform => matchesDirectoryFilter(platform, statusFilter, 0))

  const activeStatusFilter = filterIsPresent ? statusFilter : 'all'

  const visiblePlatforms = useMemo(
    () =>
      platforms?.filter(
        platform =>
          matchesDirectoryFilter(platform, activeStatusFilter, pendingByPlatform[platform.id]?.length ?? 0) &&
          platformMatchesQuery(platform, query, locale)
      ) ?? [],
    [platforms, activeStatusFilter, pendingByPlatform, query, locale]
  )

  async function handleToggle(platform: MessagingPlatformInfo, enabled: boolean) {
    if (messagingWritePending(saving, setupBusy)) {
      return
    }

    const name = localizedMessagingPlatformName(locale, platform.id, platform.name)
    setSaving(`enabled:${platform.id}`)

    try {
      if (!enabled) {
        await setupCancelRef.current?.()
      }

      if (scopeRef.current !== ownerKey) {
        return
      }

      const result = await updateMessagingPlatform(platform.id, { enabled }, scopeProfile)

      if (scopeRef.current !== ownerKey) {
        return
      }

      setPlatforms(
        current =>
          current?.map(row =>
            row.id === platform.id
              ? {
                  ...row,
                  enabled,
                  state: enabled
                    ? row.configured
                      ? result.needs_activation
                        ? 'connecting'
                        : 'pending_restart'
                      : 'not_configured'
                    : 'disabled'
                }
              : row
          ) ?? current
      )

      const canActivate = !enabled || platform.configured

      if (canActivate && result.needs_activation) {
        await connectPlatform(platform.id)
      } else if (canActivate) {
        settleAfterUpdate(result.hot_served)
      }

      notify({
        kind: 'success',
        title: enabled ? m.platformEnabled(name) : m.platformDisabled(name),
        message: !canActivate
          ? m.states.not_configured
          : result.needs_activation
            ? m.setupUpdated(name)
            : result.hot_served
              ? m.appliedLive
              : m.restartToApply
      })
    } catch (err) {
      if (scopeRef.current === ownerKey) {
        notifyError(err, m.failedUpdate(name))
      }
    } finally {
      if (scopeRef.current === ownerKey) {
        setSaving(null)
      }
    }
  }

  async function handleSave(platform: MessagingPlatformInfo) {
    const name = localizedMessagingPlatformName(locale, platform.id, platform.name)
    const update = platformChanges(platform, edits[platform.id] || {})

    if (!hasChanges(update)) {
      return
    }

    if (platform.onboarding && !platform.configured) {
      update.enabled = true
    }

    setSaving(`env:${platform.id}`)

    try {
      const result = await updateMessagingPlatform(platform.id, update, scopeProfile)

      if (scopeRef.current !== ownerKey) {
        return
      }

      // Refresh before dropping the drafts so list editors re-seed from the saved value, not the old one.
      await refreshPlatforms()

      if (scopeRef.current !== ownerKey) {
        return
      }

      setEdits(current => ({ ...current, [platform.id]: {} }))

      if (result.needs_activation) {
        await connectPlatform(platform.id)
      } else {
        settleAfterUpdate(result.hot_served)
      }

      notify({
        kind: 'success',
        title: m.setupSaved(name),
        message: result.hot_served || result.needs_activation ? m.connectingLive : m.restartToReconnect
      })
    } catch (err) {
      if (scopeRef.current === ownerKey) {
        notifyError(err, m.failedSave(name))
      }
    } finally {
      if (scopeRef.current === ownerKey) {
        setSaving(null)
      }
    }
  }

  async function handleClear(platform: MessagingPlatformInfo, key: string) {
    const name = localizedMessagingPlatformName(locale, platform.id, platform.name)
    setSaving(`clear:${key}`)

    try {
      const result = await updateMessagingPlatform(platform.id, { clear_env: [key] }, scopeProfile)

      if (scopeRef.current !== ownerKey) {
        return
      }

      setEdits(current => ({
        ...current,
        [platform.id]: {
          ...(current[platform.id] || {}),
          [key]: ''
        }
      }))
      await refreshPlatforms()

      if (scopeRef.current !== ownerKey) {
        return
      }

      if (result.needs_activation) {
        await connectPlatform(platform.id)
      } else {
        settleAfterUpdate(result.hot_served)
      }

      notify({ kind: 'success', title: m.keyCleared(key), message: m.setupUpdated(name) })
    } catch (err) {
      if (scopeRef.current === ownerKey) {
        notifyError(err, m.failedClear(key))
      }
    } finally {
      if (scopeRef.current === ownerKey) {
        setSaving(null)
      }
    }
  }

  // QR onboarding wrote the token + allowlist and asked the backend to restart
  // the gateway. restart_started only means the child spawned; watch its exit
  // so a failed restart lands in the banner instead of a silent "stopped".
  async function handleTelegramApplied(result: TelegramOnboardingApplyResponse) {
    if (scopeRef.current !== ownerKey) {
      return
    }

    await refreshPlatforms(true)

    if (scopeRef.current !== ownerKey) {
      return
    }

    if (result.needs_activation) {
      await connectPlatform('telegram')

      return
    }

    if (result.restart_started) {
      const connectedBot = result.bot_username ? `${m.states.connected}: @${result.bot_username}` : null

      notify({
        kind: 'success',
        title: m.setupSaved('Telegram'),
        message: [connectedBot, m.telegramQr.savedRestarting].filter(Boolean).join(' · ')
      })
      setRestartNeeded(false)
      const ok = await watchGatewayRestartOutcome()

      if (!ok) {
        setRestartNeeded(true)
        notify({
          kind: 'error',
          title: m.restartFailedManual,
          message: m.restartFailedManualDetail,
          action: { label: m.restartAgain, onClick: () => void runGatewayRestart() },
          secondaryAction: {
            label: m.openLogs,
            onClick: () => void window.hermesDesktop?.revealLogs?.().catch(() => undefined)
          }
        })
      }

      void refreshPlatforms(true)

      return
    }

    if (result.needs_restart) {
      // Backend could not spawn the restart (or is too old to try): fall back
      // to the app's own restart action, same as the manual-save path.
      await restartGatewayNow()

      if (result.restart_error) {
        notifyError(new Error(result.restart_error), m.telegramQr.savedRestartFailed(`: ${result.restart_error}`))
        setRestartNeeded(true)
      }
    }
  }

  // Approve/revoke paint from a snapshot immediately, then let the
  // authoritative refresh have the last word. A failed write restores the
  // snapshot so the row never silently disappears on an error.
  async function handleApprove(user: PairingUser) {
    if (!user.request_id) {
      return
    }

    const key = pairingKey(user)
    const snapshot = pairing
    setApproving(key)
    setPairing(current => ({
      approved: current.approved,
      pending: current.pending.filter(row => pairingKey(row) !== key)
    }))

    try {
      await approvePairing(user.platform, user.request_id, scopeProfile)
      notify({ kind: 'success', title: m.approvedUser(pairingLabel(user)), message: m.approvedHint })
      await refreshPairing()
    } catch (err) {
      setPairing(snapshot)
      // 429 is the code path's brute-force lockout — a distinct condition the
      // operator can only wait out, so it gets its own message.
      const lockedOut = err instanceof Error && err.message.includes('429')
      notifyError(err, lockedOut ? m.pairingLockedOut : m.failedApprove(pairingLabel(user)))
    } finally {
      setApproving(null)
    }
  }

  // ConfirmDialog owns the pending → done → close beat and shows an inline
  // error when onConfirm throws, so this rethrows instead of swallowing.
  async function handleRevoke(user: PairingUser) {
    const key = pairingKey(user)
    const snapshot = pairing
    setPairing(current => ({
      approved: current.approved.filter(row => pairingKey(row) !== key),
      pending: current.pending
    }))

    try {
      await revokePairing(user.platform, user.user_id, scopeProfile)
      notify({ kind: 'success', title: m.revokedUser(pairingLabel(user)), message: user.platform })
      await refreshPairing()
    } catch (err) {
      setPairing(snapshot)
      throw err
    }
  }

  const restartNotice = restartNeeded ? (
    <Alert className="messaging-restart-notice" variant="warning">
      <AlertTriangle />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{m.restartNeeded}</span>
        <Button disabled={gatewayRestarting} onClick={() => void restartGatewayNow()} size="sm" variant="secondary">
          <RefreshCw className={gatewayRestarting ? 'animate-spin' : undefined} />
          {gatewayRestarting ? m.restarting : m.restartNow}
        </Button>
      </AlertDescription>
    </Alert>
  ) : null

  function closeConfiguration() {
    if (selected && hasChanges(platformChanges(selected, edits[selected.id] || {}))) {
      setConfirmDiscard(true)
    } else {
      setSelectedId('')
    }
  }

  return (
    <MessagingDirectory
      {...props}
      filter={activeStatusFilter}
      loading={!platforms}
      notice={!selected ? restartNotice : null}
      onFilter={setStatusFilter}
      onQuery={setQuery}
      onRefresh={() => void refreshAll()}
      onSelect={setSelectedId}
      pendingCounts={Object.fromEntries(Object.entries(pendingByPlatform).map(([id, rows]) => [id, rows.length]))}
      platforms={platforms ?? []}
      query={query}
      refreshing={refreshing}
      visiblePlatforms={visiblePlatforms}
    >
      <PlatformDialog
        actions={
          selected && (
            <PlatformActionBar
              busy={setupBusy}
              canSave={requiredCredentialsReady(selected, edits[selected.id] || {})}
              hasEdits={hasChanges(platformChanges(selected, edits[selected.id] || {}))}
              onSave={() => void handleSave(selected)}
              onToggle={enabled => void handleToggle(selected, enabled)}
              platform={selected}
              saving={saving}
              showSave={!quickSetup}
            />
          )
        }
        busy={messagingWritePending(saving, setupBusy)}
        onClose={closeConfiguration}
        platform={selected}
        quickSetup={quickSetup}
      >
        {restartNotice}
        {selected && (
          <PlatformDetail
            approved={approvedByPlatform[selected.id] ?? []}
            approving={approving}
            connectMessage={currentConnectionNotice(selected, connectNotices[selected.id])}
            edits={edits[selected.id] || {}}
            key={`${ownerKey}:${selected.id}`}
            manualSetup={manualSetup}
            onApprove={user => void handleApprove(user)}
            onClear={key => void handleClear(selected, key)}
            onConnect={() => void connectPlatform(selected.id)}
            onEdit={(key, value) =>
              setEdits(current => ({
                ...current,
                [selected.id]: { ...(current[selected.id] || {}), [key]: value }
              }))
            }
            onManualSetup={setManualSetup}
            onQrApplied={handleQrApplied}
            onRevoke={setPendingRevoke}
            onSetupBusyChange={setSetupBusy}
            onSetupCancelChange={registerSetupCancel}
            onTelegramApplied={result => void handleTelegramApplied(result)}
            pending={pendingByPlatform[selected.id] ?? []}
            platform={selected}
            saving={saving}
            scopeProfile={scopeProfile}
            setupBusy={setupBusy}
          />
        )}
      </PlatformDialog>
      <ConfirmDialog
        cancelLabel={t.common.cancel}
        confirmLabel={m.directory.discard}
        description={m.directory.discardHint}
        dismissOnConfirm
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          if (selected) {
            setEdits(current => ({ ...current, [selected.id]: {} }))
          }

          setConfirmDiscard(false)
          setSelectedId('')
        }}
        open={confirmDiscard}
        title={m.directory.discardTitle}
      />
      <ConfirmDialog
        busyLabel={m.revoking}
        cancelLabel={t.common.cancel}
        confirmLabel={m.revoke}
        description={pendingRevoke ? m.revokeDesc(pairingLabel(pendingRevoke)) : null}
        destructive
        onClose={() => setPendingRevoke(null)}
        onConfirm={() => (pendingRevoke ? handleRevoke(pendingRevoke) : undefined)}
        open={Boolean(pendingRevoke)}
        title={m.revokeTitle}
      />
    </MessagingDirectory>
  )
}

function messagingWritePending(saving: string | null, setupBusy: boolean): boolean {
  return Boolean(saving) || setupBusy
}

function usesQuickSetup(platform: MessagingPlatformInfo | null, manualSetup: boolean): boolean {
  return Boolean(platform && !manualSetup && (platform.onboarding || platform.id === 'telegram'))
}

function currentConnectionNotice(platform: MessagingPlatformInfo, notice?: ConnectionNotice): string | undefined {
  // A busy replacement may still expose the OLD live adapter. Only a newer connected
  // receipt proves recovery; a refresh of that old adapter must not dismiss the warning.
  if (platform.state === 'connected' && platform.updated_at && platform.updated_at !== notice?.updatedAt) {
    return undefined
  }

  return notice?.message
}

function requiredCredentialsReady(platform: MessagingPlatformInfo, draft: Record<string, string>): boolean {
  return (
    !platform.onboarding ||
    platform.env_vars.every(field => !field.required || field.is_set || Boolean(draft[field.key]?.trim()))
  )
}
