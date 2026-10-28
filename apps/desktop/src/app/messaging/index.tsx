import './messaging.css'

import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const scopeRef = useRef(scopeProfile)

  scopeRef.current = scopeProfile

  const refreshPlatforms = useCallback(
    async (silent = false) => {
      if (!silent) {
        setRefreshing(true)
      }

      try {
        const result = await getMessagingPlatforms(scopeProfile)

        if (scopeRef.current === scopeProfile) {
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
    [m, scopeProfile]
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

      if (scopeRef.current === scopeProfile) {
        setPairing({ approved: result.approved ?? [], pending: result.pending ?? [] })
      }
    } catch {
      // Leave the last known rows in place rather than blanking them.
    }
  }, [scopeProfile])

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
  const [prevScope, setPrevScope] = useState(scopeProfile)

  if (prevScope !== scopeProfile) {
    setPrevScope(scopeProfile)
    setPlatforms(null)
    setPairing({ approved: [], pending: [] })
    setEdits({})
    setConfirmDiscard(false)
    setPendingRevoke(null)
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
    const name = localizedMessagingPlatformName(locale, platform.id, platform.name)
    setSaving(`enabled:${platform.id}`)

    try {
      const result = await updateMessagingPlatform(platform.id, { enabled }, scopeProfile)
      setPlatforms(
        current =>
          current?.map(row =>
            row.id === platform.id
              ? {
                  ...row,
                  enabled,
                  state: enabled ? (row.configured ? 'pending_restart' : 'not_configured') : 'disabled'
                }
              : row
          ) ?? current
      )
      settleAfterUpdate(result.hot_served)
      notify({
        kind: 'success',
        title: enabled ? m.platformEnabled(name) : m.platformDisabled(name),
        message: result.hot_served ? m.appliedLive : m.restartToApply
      })
    } catch (err) {
      notifyError(err, m.failedUpdate(name))
    } finally {
      setSaving(null)
    }
  }

  async function handleSave(platform: MessagingPlatformInfo) {
    const name = localizedMessagingPlatformName(locale, platform.id, platform.name)
    const update = platformChanges(platform, edits[platform.id] || {})

    if (!hasChanges(update)) {
      return
    }

    setSaving(`env:${platform.id}`)

    try {
      const result = await updateMessagingPlatform(platform.id, update, scopeProfile)
      // Refresh before dropping the drafts so list editors re-seed from the saved value, not the old one.
      await refreshPlatforms()
      setEdits(current => ({ ...current, [platform.id]: {} }))
      settleAfterUpdate(result.hot_served)
      notify({
        kind: 'success',
        title: m.setupSaved(name),
        message: result.hot_served ? m.connectingLive : m.restartToReconnect
      })
    } catch (err) {
      notifyError(err, m.failedSave(name))
    } finally {
      setSaving(null)
    }
  }

  async function handleClear(platform: MessagingPlatformInfo, key: string) {
    const name = localizedMessagingPlatformName(locale, platform.id, platform.name)
    setSaving(`clear:${key}`)

    try {
      const result = await updateMessagingPlatform(platform.id, { clear_env: [key] }, scopeProfile)
      setEdits(current => ({
        ...current,
        [platform.id]: {
          ...(current[platform.id] || {}),
          [key]: ''
        }
      }))
      await refreshPlatforms()
      settleAfterUpdate(result.hot_served)
      notify({ kind: 'success', title: m.keyCleared(key), message: m.setupUpdated(name) })
    } catch (err) {
      notifyError(err, m.failedClear(key))
    } finally {
      setSaving(null)
    }
  }

  // QR onboarding wrote the token + allowlist and asked the backend to restart
  // the gateway. restart_started only means the child spawned; watch its exit
  // so a failed restart lands in the banner instead of a silent "stopped".
  async function handleTelegramApplied(result: TelegramOnboardingApplyResponse) {
    await refreshPlatforms(true)

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
              hasEdits={hasChanges(platformChanges(selected, edits[selected.id] || {}))}
              onSave={() => void handleSave(selected)}
              onToggle={enabled => void handleToggle(selected, enabled)}
              platform={selected}
              saving={saving}
            />
          )
        }
        busy={Boolean(saving)}
        onClose={closeConfiguration}
        platform={selected}
      >
        {restartNotice}
        {selected && (
          <PlatformDetail
            approved={approvedByPlatform[selected.id] ?? []}
            approving={approving}
            edits={edits[selected.id] || {}}
            key={selected.id}
            onApprove={user => void handleApprove(user)}
            onClear={key => void handleClear(selected, key)}
            onEdit={(key, value) =>
              setEdits(current => ({
                ...current,
                [selected.id]: { ...(current[selected.id] || {}), [key]: value }
              }))
            }
            onRevoke={setPendingRevoke}
            onTelegramApplied={result => void handleTelegramApplied(result)}
            pending={pendingByPlatform[selected.id] ?? []}
            platform={selected}
            saving={saving}
            scopeProfile={scopeProfile}
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
