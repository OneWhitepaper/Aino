import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import { $backgroundRunningSessionIds } from '@/store/composer-status'
import {
  $gateway,
  activeGatewayConnectionId,
  activeGatewayProfileKey,
  gatewayRouteState,
  isActivePrimary
} from '@/store/gateway'
import { $primaryGatewayRoute } from '@/store/gateway-primary-route'
import { $liveWorkRoster, rosterSourceHasWork, setLiveWorkRosterSource } from '@/store/live-work-roster'
import { $gatewayState, ownerLookupSessionRows } from '@/store/session'
import { $delegatingSessionIds } from '@/store/session-dot-state'
import { ambientRequestFor } from '@/store/session-gone-latch'
import { isSessionOwnerRoute, requestForSessionProfile, type SessionOwnerScope } from '@/store/session-request-router'
import { knownOwnerForSession, type SessionTileWorkspaceScope } from '@/store/session-states'

const POLL_MS = 10_000
const ACTIVE_GROUP_POLL_MS = 2_000
const GROUP_DISCOVERY_MS = 10_000
// A closed socket whose last read showed work is re-dialed this often, not every tick.
const COLD_BUSY_MS = 60_000
// Window focus re-reads every source at most this often (alt-tab bursts).
const FOCUS_MIN_GAP_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60_000

interface RosterResult {
  sessions?: unknown[]
}

interface RosterSource {
  /** Stored ids of the rows this source answers for. */
  covers: string[]
  open: boolean
  owner: SessionOwnerScope
  sourceScopesBySession?: Record<string, SessionTileWorkspaceScope>
}

interface BotRosterSource {
  covers: string[]
  owner: SessionOwnerScope
  scope?: SessionTileWorkspaceScope
}

const routeOf = (owner: SessionOwnerScope) =>
  isSessionOwnerRoute(owner)
    ? gatewayRouteState(owner.connectionId, owner.profile)
    : gatewayRouteState(null, String(owner ?? ''))

const groupReadDue = (
  groupOnly: boolean,
  keys: ReadonlySet<string>,
  key: string,
  last: number | undefined,
  now: number
) => !groupOnly || (keys.has(key) && (last === undefined || now - last >= ACTIVE_GROUP_POLL_MS))

/** A background delegate may outlive the short room turn that launched it. */
const groupHasLiveWork = (connectionId: string, profile: string, roomId: string) =>
  Object.values($liveWorkRoster.get()).some(
    bucket =>
      isSessionOwnerRoute(bucket.owner) &&
      bucket.owner.connectionId === connectionId &&
      Object.entries(bucket.sourcesBySession ?? {}).some(
        ([sid, source]) =>
          source.room_id === roomId && source.profile === profile && (bucket.sessions[sid]?.subagents ?? 0) > 0
      )
  )

/** Every backend the sidebar shows rows for (recents, cron and messaging rows
 *  alike), keyed by the socket a read would ride, so one backend is asked once
 *  however many spellings its owner has (the launch profile used to be asked
 *  three times a tick). The ambient socket answers for the active profile; a row owned by another profile (or connection) is asked on
 *  the route its own session RPCs take, so each backend only reports
 *  conversations stored in that profile. */
function rosterSources(bots: readonly BotRosterSource[] = []): Map<string, RosterSource> {
  // The ambient read carries no profile, so it shares a key only when it IS the
  // window primary answering for its own profile.
  const ambientKey = isActivePrimary() ? gatewayRouteState(null, activeGatewayProfileKey()).key : 'ambient'
  const sources = new Map<string, RosterSource>([[ambientKey, { covers: [], open: true, owner: undefined }]])

  // One row list per tick, each owner resolved against its own row: resolving
  // through the whole list per row made a tick O(rows²).
  for (const row of ownerLookupSessionRows()) {
    const owner = knownOwnerForSession(row.id, [row])

    if (!owner) {
      continue
    }

    const route = routeOf(owner)
    const source = sources.get(route.key)

    if (source) {
      source.covers.push(row.id)
    } else {
      sources.set(route.key, { covers: [row.id], open: route.open, owner })
    }
  }

  // Bot Chat is intentionally hidden from recents. Its existing roster owns
  // the route even after reload, before any conversation tile has attached.
  for (const { owner, covers, scope } of bots) {
    const route = routeOf(owner)
    const sourceScopesBySession = scope ? Object.fromEntries(covers.map(id => [id, scope])) : undefined
    const source = sources.get(route.key)

    if (source) {
      source.covers.push(...covers)
      source.sourceScopesBySession = { ...source.sourceScopesBySession, ...sourceScopesBySession }
    } else {
      sources.set(route.key, { covers, open: route.open, owner, sourceScopesBySession })
    }
  }

  return sources
}

/** App-level hydration of `$liveWorkRoster` (sidebar rows not on screen, and
 *  every row after a reload / socket reconnect): one `subagent.roster` read per
 *  backend on connect and window focus, then every 10 s while the window is
 *  visible. Each source reads and publishes on its own, with a one-tick request
 *  timeout, so a hung backend never freezes the other sources' rows. Interval
 *  ticks are passive: after a source's first read on this connection they read
 *  only sockets already open, plus a closed one whose last read showed work once
 *  a minute (so a finished child clears without re-dialing every tick). A backend
 *  without the RPC stops for this connection; any other failure backs off (focus
 *  included) and keeps retrying, so a recovered socket comes back on its own. */
export function useLiveWorkRoster() {
  const gatewayState = useStore($gatewayState)
  // Route keys (`primary:<profile>`, `ambient`) name a socket, not a backend:
  // a soft re-home of the primary must start over, even while the foreground
  // socket (a secondary) stays open, or old buckets and stops outlive it.
  const { connectionId: primaryConnection, mode: primaryMode } = useStore($primaryGatewayRoute)

  useEffect(() => {
    // Counts from a dropped socket or a previous primary are unverified; the
    // (re)connect re-reads them.
    $liveWorkRoster.set({})

    if (gatewayState !== 'open') {
      return
    }

    let cancelled = false
    let botSources = (): BotRosterSource[] => []
    let groupSources = (): BotRosterSource[] => []
    const extraSources = () => [...botSources(), ...groupSources()]

    let stopBotRoster = () => {}

    let stopGroupLive = () => {}
    let lastHydrate = -Infinity
    let current = new Set<string>()
    const inFlight = new Set<string>()
    const unsupported = new Set<string>()
    // When each source was last asked on this connection: rows that load after
    // the connect (the session list, a newly shown profile) get their first read.
    const sentAt = new Map<string, number>()
    const backoff = new Map<string, { failures: number; until: number }>()

    const readSource = async (
      key: string,
      { covers, owner, sourceScopesBySession }: RosterSource,
      ambient: ReturnType<typeof ambientRequestFor>
    ) => {
      const at = Date.now()
      const connectionId = activeGatewayConnectionId()

      const observedOwner =
        owner ?? (connectionId ? { connectionId, profile: activeGatewayProfileKey() } : activeGatewayProfileKey())

      const stillOwnsSource = () =>
        owner
          ? JSON.stringify(rosterSources(extraSources()).get(key)?.owner) === JSON.stringify(owner)
          : connectionId === activeGatewayConnectionId() &&
            (isSessionOwnerRoute(observedOwner) ? observedOwner.profile : observedOwner) === activeGatewayProfileKey()

      sentAt.set(key, at)
      inFlight.add(key)

      try {
        const profile = isSessionOwnerRoute(observedOwner)
          ? (observedOwner.targetProfile ?? observedOwner.profile)
          : String(observedOwner)

        const result = await requestForSessionProfile<RosterResult>(
          owner,
          ambient,
          'subagent.roster',
          { profile },
          POLL_MS
        )

        backoff.delete(key)

        // A source whose rows left the sidebar mid-read stays pruned.
        if (!cancelled && current.has(key) && stillOwnsSource()) {
          setLiveWorkRosterSource(
            key,
            Array.isArray(result?.sessions) ? result.sessions : [],
            at,
            covers,
            observedOwner,
            sourceScopesBySession
          )
        }
      } catch (error) {
        if (isMissingRpcMethod(error)) {
          unsupported.add(key)
        } else {
          const failures = (backoff.get(key)?.failures ?? 0) + 1
          backoff.set(key, { failures, until: Date.now() + Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS) })
        }

        if (!cancelled && stillOwnsSource()) {
          setLiveWorkRosterSource(key, null)
        }
      } finally {
        inFlight.delete(key)
      }
    }

    const refresh = (hydrate: boolean, onlyNew = false, groupOnly = false) => {
      const gateway = $gateway.get()

      if (cancelled || !gateway) {
        return
      }

      const ambient = ambientRequestFor(gateway)
      const sources = rosterSources(extraSources())
      const groupKeys = new Set(groupSources().map(source => routeOf(source.owner).key))
      const roster = $liveWorkRoster.get()
      const now = Date.now()
      // Rows lit right now: a closed source covering one is re-read on the busy
      // cadence even when its last read was empty, so work an event feed saw
      // start after that read still gets its end confirmed.
      const lit = new Set([...$backgroundRunningSessionIds.get(), ...$delegatingSessionIds.get()])
      current = new Set(sources.keys())

      // Owners whose rows left the sidebar stop contributing.
      for (const key of Object.keys(roster)) {
        if (!current.has(key)) {
          setLiveWorkRosterSource(key, null)
        }
      }

      for (const [key, source] of sources) {
        const last = sentAt.get(key)

        const due =
          groupReadDue(groupOnly, groupKeys, key, last, now) &&
          (!onlyNew || last === undefined) &&
          !inFlight.has(key) &&
          !unsupported.has(key) &&
          now >= (backoff.get(key)?.until ?? 0)

        const warm =
          hydrate ||
          source.open ||
          last === undefined ||
          ((rosterSourceHasWork(roster, key) || source.covers.some(id => lit.has(id))) && now - last >= COLD_BUSY_MS)

        if (due && warm) {
          void readSource(key, source, ambient)
        }
      }
    }

    const hydrate = () => {
      if (Date.now() - lastHydrate >= FOCUS_MIN_GAP_MS) {
        lastHydrate = Date.now()
        refresh(true)
      }
    }

    hydrate()
    // Plugin SDK initialization itself imports the desktop integrations. Load
    // the existing Bot roster after that module graph has settled.
    void Promise.all([
      import('@/plugins/hermes-bots/data'),
      import('@/plugins/hermes-bots/routing'),
      import('@/plugins/hermes-bots/labels'),
      import('@/plugins/hermes-bots/canonical-group-details')
    ]).then(
      ([
        { $lastRoster },
        { resolveBotConnectionRoute, botWorkspaceOwnerKey },
        { displayName },
        { $canonicalRoomLive }
      ]) => {
        if (cancelled) {
          return
        }

        botSources = () =>
          $lastRoster.get().flatMap(bot => {
            const owner = resolveBotConnectionRoute(bot).route

            return owner && !bot.ghost && !bot.unserved && !bot.sourceMissing
              ? [
                  {
                    owner,
                    scope: {
                      ownerRoute: owner,
                      workspaceMode: 'bots',
                      workspaceOwnerKey: botWorkspaceOwnerKey(bot),
                      workspaceTabTitle: displayName(bot)
                    },
                    covers: [
                      ...new Set(
                        [bot.canonical_session?.id, bot.canonical_session?.resolved_id].filter(
                          (id): id is string => !!id
                        )
                      )
                    ]
                  }
                ]
              : []
          })
        stopBotRoster = $lastRoster.listen(() => refresh(false, true))
        groupSources = () =>
          Object.entries($canonicalRoomLive.get()).flatMap(([key, live]) => {
            if (!live.workerProfiles?.length) {
              return []
            }

            const [connectionId, profile, roomId] = JSON.parse(key) as [string, string, string]

            if (
              !live.working &&
              Date.now() - (live.updatedAt ?? 0) >= GROUP_DISCOVERY_MS &&
              !groupHasLiveWork(connectionId, profile, roomId)
            ) {
              return []
            }

            return live.workerProfiles.map(profile => ({ covers: [], owner: { connectionId, profile } }))
          })
        // A room's durable update opens a bounded discovery window even if an async delegation's
        // parent turn finished before the room poll. Real discovered children extend that window.
        stopGroupLive = $canonicalRoomLive.listen(() => refresh(true, false, true))
        refresh(false, true)
      }
    )

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh(false)
      }
    }, POLL_MS)

    const groupTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh(true, false, true)
      }
    }, ACTIVE_GROUP_POLL_MS)

    window.addEventListener('focus', hydrate)

    return () => {
      cancelled = true
      stopBotRoster()
      stopGroupLive()
      window.clearInterval(timer)
      window.clearInterval(groupTimer)
      window.removeEventListener('focus', hydrate)
    }
  }, [gatewayState, primaryConnection, primaryMode])
}
