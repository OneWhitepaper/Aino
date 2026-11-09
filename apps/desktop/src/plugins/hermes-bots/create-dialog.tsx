/**
 * The two creation dialogs: New Bot, and the group-chat creation flow the
 * roster's group button opens (plus the per-bot group membership dialog it
 * sits beside).
 *
 * New Bot creates its profile LAZILY, so it owns the single-flight guard and
 * the name pattern that gates the draft.
 */

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DisclosureCaret,
  GlyphSpinner,
  host,
  Input,
  queryClient,
  SearchField,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import { avatarColor, blobatarSvg, BotFace } from './avatar'
import { AvatarPicker } from './avatar-picker'
import {
  botOnConnection,
  connectionName,
  groupCreationEngine,
  groupCreationSource,
  groupExecutionMode,
  groupNeedsDesktopCourier,
  seatableGroupBots,
  useGroupCapability
} from './canonical-group-capabilities'
import type { GroupCapabilityState, GroupCreationEngine } from './canonical-group-capabilities'
import { refreshGatewayGroupRooms, registerCanonicalGroup } from './canonical-group-registry'
import type { CanonicalGroupOrigin } from './canonical-group-registry'
import { canonicalGroupCreateError, canonicalGroupRequest, createCanonicalGroup } from './canonical-groups'
import type { CanonicalGroupRoute } from './canonical-groups'
import { $botMeta, $lastRoster, botRosterKey, filterBots, ROSTER_KEY, saveBotMeta } from './data'
import { labeled, ResizableFrame } from './dialog-parts'
import { GROUP_CHAT_MAX_MEMBERS, mintGroupRoomId, uniqueGroupChatName, updateGroupChat } from './group-chat'
import type { GroupChatRoom } from './group-chat'
import { GroupImageControls } from './group-chat-parts'
import { memberMachineOffline, setGroupMembership } from './group-chat-view-members'
import { GroupCreateMembers } from './group-create-members'
import {
  botGroups,
  durableGroupChatMembers,
  groupMembershipPatch,
  knownGroups,
  liveGroupChatNames
} from './group-membership'
import { useBots } from './i18n'
import { botProfileIdentity, displayName } from './labels'
import { McpSetupButton } from './mcp-setup'
import { ModelPicker } from './model-picker'
import type {
  CapabilityEntry,
  McpCatalogResponse,
  ProfileConfigurePayload,
  ProfileDescribeResponse
} from './profile-config'
import { CapabilitiesView, capabilitiesViewRoutesConnections, CheckList } from './profile-config'
import { deleteBot } from './profile-ops'
import { openRosterBot } from './roster-actions'
import { botRosterMeta } from './routing'
import { getBotOpenGeneration } from './shared'
import { HubSkillsSection } from './skills-hub'
import { composeSoul } from './soul'
import type { BotMeta, ConnectionRow, RosterRow } from './types'

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

// Native bottom-right resize stays within the viewport; scrolling keeps the
// advanced options accessible after the user shrinks the dialog.
const ADVANCED_DIALOG_STYLE = {
  resize: 'both',
  overflow: 'auto',
  minWidth: 420,
  minHeight: 360,
  maxWidth: '95vw',
  maxHeight: '90vh'
} as const

function activeCreationSource(): string {
  return `${host.state?.connectionId?.get?.() || ''}\0${host.state?.profile?.get?.() || 'default'}`
}

/** Share one in-flight async operation across concurrent callers. Failures
 * clear the slot so a later attempt can retry. */
export function singleFlight<T>(ref: { current: null | Promise<T> }, start: () => Promise<T> | T): Promise<T> {
  if (ref.current) {
    return ref.current
  }

  let flight: Promise<T>

  try {
    flight = Promise.resolve(start())
  } catch (err) {
    flight = Promise.reject(err)
  }

  ref.current = flight
  flight.catch(() => {
    if (ref.current === flight) {
      ref.current = null
    }
  })

  return flight
}

// ── create dialog ────────────────────────────────────────────────────────────

/** The clone source's capability catalog, staged before the profile exists. */
interface CapabilityCatalog {
  mcp: CapabilityEntry[]
  skills: CapabilityEntry[]
  source: string
  toolsets: CapabilityEntry[]
}
interface CreateAgentDialogProps {
  onClose: () => void
  /** Refresh the mounted roster before selecting a just-created owner. */
  onRefreshRoster?: () => Promise<RosterRow[]>
  /** Opens the editor for a just-created local bot whose model is not ready. */
  onConfigureModel?: (bot: RosterRow) => void
  open: boolean
  roster: RosterRow[]
}

/** An explicit connection selection only routes remotely when it differs
 * from the window's active gateway. */
function creationTarget(targetConnection: string, connections: ConnectionRow[] | null) {
  const activeConnectionId = String(host.state?.connectionId?.get?.() || '').trim()
  const remoteTarget = Boolean(targetConnection) && targetConnection !== (activeConnectionId || 'local')

  const targetLabel = remoteTarget
    ? (connections || []).find(c => c.id === targetConnection)?.label || targetConnection
    : ''

  return { activeConnectionId, remoteTarget, targetLabel, createTarget: remoteTarget ? targetConnection : '' }
}

/** Capture the new row's source before profile creation can outlive navigation. */
function createdBotRow(
  identity: Pick<RosterRow, 'name' | 'description' | 'title'>,
  roster: RosterRow[],
  createTarget: string,
  openingConnection: string,
  remoteTarget: boolean
): RosterRow {
  const connectionId = createTarget || openingConnection || 'local'

  const connectionKind =
    roster.find(row => (row.connectionId || 'local') === connectionId)?.connectionKind ??
    (connectionId === 'local' ? 'local' : 'remote')

  return {
    ...identity,
    connectionId,
    connectionKind,
    sourceScoped: true,
    ...(remoteTarget ? { remoteSource: true } : {})
  }
}

type RuntimeReadiness = { error?: string; ok?: boolean; provider?: string } | null

/** Report creation separately from whether its first model turn is ready. */
function notifyCreatedBot(
  readiness: RuntimeReadiness,
  {
    bot,
    createdMessage,
    editor,
    onConfigureModel,
    remoteTarget
  }: {
    bot: RosterRow
    createdMessage: string
    editor: ReturnType<typeof useBots>['editor']
    onConfigureModel: CreateAgentDialogProps['onConfigureModel']
    remoteTarget: boolean
  }
): boolean {
  const needsModel = readiness?.ok === false
  const platformUnavailable = needsModel && readiness?.provider === 'aino'
  host.notify(
    needsModel
      ? {
          kind: 'warning',
          title: createdMessage,
          message: platformUnavailable ? readiness.error || editor.modelSwitchFailed : editor.needsModel,
          ...(!platformUnavailable ? { detail: readiness?.error } : {}),
          ...(!platformUnavailable && !remoteTarget && onConfigureModel
            ? { action: { label: editor.configureModel, onClick: () => onConfigureModel(bot) } }
            : {})
        }
      : { kind: 'success', message: createdMessage }
  )

  return needsModel
}

function creationTabs(b: ReturnType<typeof useBots>, showCapabilities: boolean) {
  return showCapabilities
    ? [
        { id: 'general', label: b.bot.general },
        { id: 'capabilities', label: b.bot.capabilities }
      ]
    : [
        { id: 'general', label: b.bot.general },
        { id: 'skills', label: b.bot.skills },
        { id: 'toolsets', label: b.bot.tools },
        { id: 'mcp', label: b.bot.mcp }
      ]
}

type CapabilityPicks = Pick<ProfileConfigurePayload, 'disabled_skills' | 'enabled_mcp_servers' | 'enabled_toolsets'>

/** The `profiles.configure` fields for the Advanced-tab picks the user changed. */
function capabilityPayload(
  caps: CapabilityCatalog | null,
  dirty: { mcp: boolean; skills: boolean; toolsets: boolean }
): CapabilityPicks {
  const payload: CapabilityPicks = {}

  if (!caps) {
    return payload
  }

  if (dirty.skills) {
    payload.disabled_skills = caps.skills.filter(s => !s.enabled).map(s => s.name)
  }

  if (dirty.toolsets) {
    const en = caps.toolsets.filter(t => t.enabled)
    payload.enabled_toolsets = en.length === caps.toolsets.length || en.length === 0 ? [] : en.map(t => t.name)
  }

  if (dirty.mcp) {
    payload.enabled_mcp_servers = caps.mcp.filter(m => m.enabled).map(m => m.name)
  }

  return payload
}

/** Gateway RPC on a create target: `target` is a registry connection id (its
 *  default backend, no gateway switch) or '' for the active gateway. */
function requestOnTarget<T>(target: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return target
    ? host.requestProfile(
        { connectionId: target, mode: 'remote', profile: 'default', targetProfile: 'default' },
        method,
        params
      )
    : host.request(method, params)
}

/** Delete a draft profile the New Agent dialog minted, on the `target` it was
 *  created on: a remote connection (`cli.exec`) or '' for local. Fire-and-forget
 *  with a toast. A cancel while profiles.create is still in flight is caught by
 *  that flight itself (the dialog's draftGenRef), since the draft is only
 *  recorded once the RPC returns (#141623). */
function discardDraftProfile(draft: string, target: string, b: ReturnType<typeof useBots>) {
  const discard = target
    ? requestOnTarget(target, 'cli.exec', { argv: ['profile', 'delete', draft, '--yes'] })
    : deleteBot({ name: draft })

  void Promise.resolve(discard)
    .then(() => host.notify({ kind: 'success', message: b.bot.draftDiscarded(draft) }))
    .catch(err => host.notifyError(err, b.bot.draftCleanupFailed(draft)))
}

/** The live Capabilities surface needs a real profile. Materialize it whenever
 *  the tab is showing a valid, untaken name that has no draft yet, not only on
 *  the tab click: a user who opens the tab first and names the bot after (or
 *  renames it) otherwise sat on a spinner forever. Debounced so typing a name
 *  does not mint a draft per keystroke. */
function useCapabilitiesDraft(ready: boolean, slug: string, draft: null | string, materialize: () => void) {
  // The timer is keyed on the name, but must run the LATEST callback: a title
  // or description typed during the wait belongs in the created profile.
  const latest = useRef(materialize)
  latest.current = materialize

  useEffect(() => {
    if (!ready || draft === slug) {
      return
    }

    const timer = window.setTimeout(() => latest.current(), 800)

    return () => window.clearTimeout(timer)
  }, [ready, slug, draft])
}

/** New Bot's live Capabilities tab: a hint until the name is usable, a spinner
 *  until its draft profile exists, then the real surface pinned to that draft. */
function CapabilitiesTab({
  connection,
  draft,
  hint
}: {
  connection?: string
  draft: null | string
  hint: null | string
}) {
  const b = useBots()
  const note = 'px-2 py-3 text-center text-xs text-(--ui-text-tertiary)'

  if (hint) {
    return <div className={note}>{hint}</div>
  }

  if (!draft) {
    return (
      <div className="flex justify-center py-4">
        <GlyphSpinner className="text-(--ui-text-tertiary)" spinner="breathe" />
      </div>
    )
  }

  // The tab list is gated on the same export, so this is only reachable via
  // persisted tab state on a build that lacks it — a message rather than
  // rendering `undefined` as a component, which throws.
  if (!CapabilitiesView) {
    return <div className={note}>{b.editor.newerDesktop}</div>
  }

  return (
    <ResizableFrame>
      <CapabilitiesView embedded fixedProfile={draft} {...(connection ? { fixedConnection: connection } : {})} />
    </ResizableFrame>
  )
}

/** Is `slug` already a bot on the create target (`target`: a remote connection
 *  id, or '' for local)? The dialog's own materialized draft never counts. */
function slugTaken(roster: RosterRow[], slug: string, target: string, draft: null | string): boolean {
  return roster.some(
    b =>
      b.name === slug &&
      b.name !== draft &&
      (target ? Boolean(b.remoteSource) && b.connectionId === target : !b.remoteSource)
  )
}

/** Draft-profile ledger for the New Agent dialog. Opening Capabilities (or MCP
 *  setup) materializes a DRAFT profile so the live config surfaces have a
 *  backend; discarding deletes it on the machine it was CREATED on
 *  (`draftTargetRef`, recorded with it): the "Create on" picker may point
 *  elsewhere by then, and a same-named bot there is not the draft. Each discard,
 *  and the dialog unmounting, bumps `draftGenRef` so an in-flight create
 *  deletes its own draft and configures nothing. */
function useDraftProfile(
  createdRef: { current: null | string },
  flightRef: { current: Promise<null | string> | null }
) {
  const b = useBots()
  const draftGenRef = useRef(0)
  const draftTargetRef = useRef('')
  const draftSourceRef = useRef<null | { identity: string; connectionId: string }>(null)

  const discardDraft = () => {
    const draft = createdRef.current
    draftGenRef.current += 1
    createdRef.current = flightRef.current = null

    if (draft && (draftTargetRef.current || draftSourceRef.current?.identity === activeCreationSource())) {
      discardDraftProfile(draft, draftTargetRef.current, b)
    }
  }

  useEffect(
    () => () => {
      draftGenRef.current += 1
    },
    []
  )

  return { discardDraft, draftGenRef, draftTargetRef, draftSourceRef }
}

export function CreateAgentDialog({
  open,
  onClose,
  onConfigureModel,
  onRefreshRoster,
  roster
}: CreateAgentDialogProps) {
  const { t } = useI18n()
  const b = useBots()
  const [name, setName] = useState('')
  // Create mode: the profile is created LAZILY. Capability toggles are staged in
  // component state; the profile is materialized either on Create (submit) or on
  // the first MCP credential setup (ensureAgentCreated), whichever comes first —
  // so OAuth / API-key setup works DURING creation, not only after in Edit.
  const createdRef = useRef<null | string>(null)
  // In-flight profiles.create shared across concurrent triggers (Create
  // button + MCP setup buttons). Distinct from createdRef on purpose:
  // createdRef must stay a slug string for its sibling consumers.
  const flightRef = useRef<Promise<null | string> | null>(null)
  const { discardDraft, draftGenRef, draftTargetRef, draftSourceRef } = useDraftProfile(createdRef, flightRef)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Default shapes mode: deterministic blob face drawn from the agent's name
  // (falls back to the legacy shape vocabulary on older SDKs).
  const [shape, setShape] = useState(blobatarSvg ? 'blobatar' : 'circle')
  const [color, setColor] = useState<null | string>(null)
  const [image, setImage] = useState<null | string>(null)
  const [advanced, setAdvanced] = useState(false)
  const [cloneFrom, setCloneFrom] = useState('default')
  const [model, setModel] = useState('')
  const [provider, setProvider] = useState('')
  const [soul, setSoul] = useState('')
  const [noSkills, setNoSkills] = useState(false)
  const [shareAuth, setShareAuth] = useState(true)
  const [advTab, setAdvTab] = useState('general')
  // Where the profile is created: '' = the active gateway (unchanged default),
  // else a registry connection id — the profiles.create lands on THAT
  // machine's backend via host.requestProfile, no gateway switch. Only
  // rendered when the desktop has a multi-connection registry.
  const [targetConnection, setTargetConnection] = useState('')
  const [connections, setConnections] = useState<ConnectionRow[] | null>(null)
  useEffect(() => {
    if (
      !open ||
      connections !== null ||
      typeof host.connections !== 'function' ||
      typeof host.requestProfile !== 'function'
    ) {
      return
    }

    host
      .connections()
      // host.connections() returns the registry ROWS on current SDKs, but the
      // envelope object ({version, primary, connections: [...]}) on desktops
      // that predate the SDK-side unwrap — accept both shapes.
      .then((value: ConnectionRow[] | { connections?: ConnectionRow[] }) =>
        setConnections(Array.isArray(value) ? value : Array.isArray(value?.connections) ? value.connections : [])
      )
      .catch(() => setConnections([]))
  }, [open, connections])
  const { activeConnectionId, remoteTarget, targetLabel, createTarget } = creationTarget(targetConnection, connections)

  /** Gateway RPC on the create target: the picked connection's default
   *  backend for remote targets, the active gateway otherwise. */
  const requestForTarget = <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    requestOnTarget<T>(createTarget, method, params)

  // Set once ensureAgentCreated() materializes the profile for the live
  // Capabilities tab (CapabilitiesView needs a real backend to point at). State —
  // not just createdRef — because the render must flip when it lands.
  const [createdForCaps, setCreatedForCaps] = useState<null | string>(null)
  const [caps, setCaps] = useState<CapabilityCatalog | null>(null)
  const [capsFailed, setCapsFailed] = useState(false)

  const [dirtyCaps, setDirtyCaps] = useState({
    skills: false,
    toolsets: false,
    mcp: false
  })

  const [capFilter, setCapFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const { slug, title: botTitle } = botProfileIdentity(name, title)
  const descriptionText = [botTitle, description].filter(Boolean).join(' — ')
  const valid = slug.length > 0 && NAME_RE.test(slug)

  // Once the draft profile is materialized (Capabilities tab / MCP setup) it
  // shows up in the roster — its OWN slug must not read as "taken".
  // A remote-target create is gated by the TARGET machine's roster: a local
  // name clash is fine there, and the remote's own duplicate check rejects
  // real collisions at profiles.create time.
  const taken = slugTaken(roster, slug, createTarget, createdRef.current)

  const reset = () => {
    setName('')
    setTitle('')
    setDescription('')
    setShape(blobatarSvg ? 'blobatar' : 'circle')
    setColor(null)
    setImage(null)
    setAdvanced(false)
    // Same default as the initial useState — resetting to '__none__' made
    // the second agent you create silently start from a fresh profile
    // instead of cloning the main one like the first dialog open did.
    setCloneFrom('default')
    setModel('')
    setProvider('')
    setSoul('')
    setNoSkills(false)
    setShareAuth(true)
    setAdvTab('general')
    setCreatedForCaps(null)
    setCaps(null)
    setCapsFailed(false)
    setDirtyCaps({
      skills: false,
      toolsets: false,
      mcp: false
    })
    setCapFilter('')
    setTargetConnection('')
    setBusy(false)
    setError(null)
    createdRef.current = null
    flightRef.current = null
  }

  // Capability catalog for the tabs: the profile doesn't exist yet, so show
  // what it WILL have — the clone source's catalog, else the main profile's.
  // Same rule as the `clone_from` payload below: a remote target can only
  // clone ITS default, so a local roster name picked before the target
  // switched must not key the preview (or the describe call) either.
  const capSource = cloneFrom === '__none__' || remoteTarget ? 'default' : cloneFrom

  const materializeForCaps = () => {
    const source = activeCreationSource()

    void ensureAgentCreated()
      .then(created => {
        if (created && (createTarget || source === activeCreationSource())) {
          setCreatedForCaps(created)
        }
      })
      .catch(err => host.notifyError(err, b.bot.createFailed))
  }

  useCapabilitiesDraft(advTab === 'capabilities' && valid && !taken, slug, createdForCaps, materializeForCaps)

  const ensureCaps = () => {
    if ((caps && caps.source === capSource) || capsFailed) {
      return
    }

    Promise.all([
      requestForTarget<ProfileDescribeResponse>('profiles.describe', {
        name: capSource
      }),
      requestForTarget<McpCatalogResponse>('mcp.catalog', {}).catch(() => null)
    ])
      .then(([res, cat]) => {
        // Full MCP menu = the profile's configured servers + the bundled
        // catalog (installable). Configured entries win on name clash.
        const configured = res.mcp_servers || []
        const have = new Set(configured.map(m => m.name))
        const catalog = ((cat && cat.servers) || []).filter(s => !have.has(s.name))
        setCaps({
          source: capSource,
          skills: res.skills || [],
          toolsets: res.toolsets || [],
          mcp: [
            ...configured,
            ...catalog.map(s => ({
              name: s.name,
              enabled: false,
              fromCatalog: true,
              installed: s.installed,
              auth: s.auth,
              requires: s.requires || [],
              description: s.description || ''
            }))
          ]
        })
      })
      .catch(() => setCapsFailed(true))
  }

  const toggleCap = (kind: 'mcp' | 'skills' | 'toolsets', name: string, enabled: boolean) => {
    setDirtyCaps(prev => ({
      ...prev,
      [kind === 'mcp' ? 'mcp' : kind]: true
    }))
    setCaps(prev =>
      prev
        ? {
            ...prev,
            [kind]: prev[kind].map(x =>
              x.name === name
                ? {
                    ...x,
                    enabled
                  }
                : x
            )
          }
        : prev
    )
  }

  // Materialize the profile exactly once. createdRef stores the finished slug
  // (its consumers — the taken check, draft discard on cancel, the MCP setup
  // button's profile param — all read a string); flightRef shares the
  // in-flight creation promise so simultaneous MCP setup / Create clicks fire
  // ONE profiles.create. A failed flight clears its slot so a retry can run.
  const ensureAgentCreated = (): Promise<null | string> => {
    // A materialized draft belongs to the source that created it. Leave it
    // there if the ambient owner changed instead of adopting a same-name bot.
    if (createdRef.current && !draftTargetRef.current && draftSourceRef.current?.identity !== activeCreationSource()) {
      return Promise.resolve(null)
    }

    // Renamed since the draft materialized? The old draft is orphaned —
    // discard it and create fresh under the new slug.
    if (createdRef.current && createdRef.current !== slug) {
      discardDraft()
      setCreatedForCaps(null)
    }

    if (createdRef.current) {
      return Promise.resolve(createdRef.current)
    }

    // Never start a flight for an unusable name: singleFlight only clears its
    // slot on failure, so a null result would be returned to every later
    // caller and the draft could never be created once a name is typed.
    if (!valid || taken) {
      return Promise.resolve(null)
    }

    const generation = draftGenRef.current
    const target = createTarget
    const source = activeCreationSource()
    const sourceConnection = String(host.state?.connectionId?.get?.() || '').trim() || 'local'
    const sourceCurrent = () => Boolean(target) || source === activeCreationSource()

    const flight = singleFlight(flightRef, async () => {
      await requestForTarget('profiles.create', {
        name: slug,
        description: descriptionText,
        // Clone sources are profiles of the TARGET backend. The picker's
        // roster is the local one, so a remote create always starts from the
        // remote machine's default (or fresh) — never a local profile name
        // the remote box doesn't have.
        clone_from: cloneFrom === '__none__' ? null : remoteTarget ? 'default' : cloneFrom,
        no_skills: noSkills,
        // Shared (not copied) auth keeps ONE OAuth/token pool with the main
        // profile, so refreshes can't invalidate each other. Older gateways
        // ignore the param and copy — still functional, just forked.
        share_auth: shareAuth,
        soul: composeSoul({
          name: slug,
          title: botTitle,
          description,
          roster,
          customSoul: soul
        }),
        ...(model.trim() && provider.trim()
          ? {
              model: model.trim(),
              provider: provider.trim()
            }
          : {})
      })

      // The create request already landed on its captured socket. A later
      // ambient-source switch cannot authorize follow-up writes there or here.
      if (!sourceCurrent()) {
        createdRef.current = flightRef.current = null

        return slug
      }

      // Prefs a deleted profile left under this name must not become the new
      // bot's. Older builds without the door keep them, as before.
      if (typeof host.dropLeftoverProfilePrefs === 'function') {
        host.dropLeftoverProfilePrefs(slug, target || null)
      }

      // Discarded mid-create: delete the profile this flight minted, configure nothing.
      if (generation !== draftGenRef.current) {
        discardDraftProfile(slug, target, b)

        return null
      }

      createdRef.current = slug
      draftTargetRef.current = target
      draftSourceRef.current = { identity: source, connectionId: target || sourceConnection }

      // Apply capability picks from the Advanced tabs (best-effort; the
      // profile exists either way and Edit Profile can finish the job).
      try {
        const capPayload = capabilityPayload(caps, dirtyCaps)

        if (Object.keys(capPayload).length) {
          await requestForTarget('profiles.configure', {
            name: slug,
            ...capPayload
          })
        }
      } catch {
        /* capability application is best-effort */
      }

      if (!sourceCurrent()) {
        createdRef.current = flightRef.current = null

        return slug
      }

      // Cancelled while configure ran: the discard already deleted the draft,
      // so it gets no bot meta and is not adopted.
      if (generation !== draftGenRef.current) {
        return null
      }

      if (remoteTarget) {
        // The bot lives on ANOTHER machine — local bot-meta is scoped to the
        // active gateway, so write appearance/title into the remote
        // profile's ui_meta (and asset store) directly. Best-effort: the
        // profile exists either way.
        const { image: avatarImage, ...look } = {
          shape,
          color,
          image,
          imageKind: image ? 'photo' : 'shape',
          title: botTitle,
          created: Date.now()
        }

        try {
          void requestForTarget('profiles.configure', {
            name: slug,
            ui_meta: {
              'hermes-bots': look
            }
          }).catch(() => undefined)

          if (avatarImage) {
            void requestForTarget('profiles.set_asset', {
              name: slug,
              asset: 'avatar',
              data: avatarImage
            }).catch(() => undefined)
          }
        } catch {
          /* older remote gateway */
        }
      } else {
        saveBotMeta(
          { name: slug, connectionId: sourceConnection, sourceScoped: true },
          {
            shape,
            color: color ?? undefined,
            image,
            imageKind: image ? 'photo' : 'shape',
            title: botTitle,
            created: Date.now()
          }
        )
      }

      queryClient.invalidateQueries({
        queryKey: ROSTER_KEY
      })

      return slug
    })

    return flight
  }

  const submit = async () => {
    if (!valid || taken || busy) {
      return
    }

    setBusy(true)
    setError(null)

    // Creation may outlive this navigation. Capture its source before I/O,
    // and never let completion take focus back from a newer user action.
    const openingGeneration = getBotOpenGeneration()
    const openingHash = window.location.hash
    const openingConnection = String(host.state?.connectionId?.get?.() || '').trim()
    const openingSource = activeCreationSource()

    const bot = createdBotRow(
      { name: slug, description: descriptionText, title: botTitle },
      roster,
      createTarget,
      openingConnection,
      remoteTarget
    )

    const openingStillCurrent = () => openingHash === window.location.hash && openingSource === activeCreationSource()

    try {
      const slugCreated = await ensureAgentCreated()

      if (!slugCreated) {
        setBusy(false)
        setError(b.bot.createFailed)

        return
      }

      const who = displayName({ name: slug, title: botTitle })
      const createdMessage = remoteTarget ? b.editor.createdOn(who, targetLabel) : b.editor.created(who)

      if (!remoteTarget && openingSource !== activeCreationSource()) {
        host.notify({ kind: 'success', message: createdMessage })
        reset()
        onClose()

        return
      }

      // The intro turn is a real model call. Probe the new profile's route
      // first so a bot whose machine has no usable credential lands as
      // "created, needs a model" instead of a doomed "No LLM provider" turn.
      // Only an explicit `ok: false` counts; older gateways proceed as before.
      const readiness = await requestForTarget<RuntimeReadiness>('setup.runtime_check', {
        profile: slugCreated
      }).catch(() => null)

      const needsModel = notifyCreatedBot(readiness, {
        bot,
        createdMessage,
        editor: b.editor,
        onConfigureModel,
        remoteTarget
      })

      const wasRemote = remoteTarget
      reset()
      onClose()

      if (wasRemote) {
        // The bot lives on another machine: it appears in the roster via the
        // union enumeration; chat routes through its own source. No local
        // canonical chat to birth here.
        queryClient.invalidateQueries({
          queryKey: ROSTER_KEY
        })

        return
      }

      if (openingGeneration === getBotOpenGeneration() && openingStillCurrent()) {
        if (onRefreshRoster) {
          try {
            const refreshed = await onRefreshRoster()

            if (!refreshed.some(row => botRosterKey(row) === botRosterKey(bot))) {
              return
            }
          } catch (error) {
            if (openingStillCurrent()) {
              host.notifyError(error, b.bot.loadFailed)
            }

            return
          }
        }

        if (openingGeneration !== getBotOpenGeneration() || !openingStillCurrent()) {
          return
        }

        // The row-click transaction owns selection, source routing and the
        // visible Bot tab together. Its failure path never re-homes Sessions.
        await openRosterBot(bot, { kickoff: !needsModel, openingStillCurrent })
      }
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog
      onOpenChange={value => {
        if (!value && !busy) {
          // Cancel path (esc / overlay click): a materialized draft profile is
          // discarded — preconfigure-then-back-out leaves nothing behind.
          discardDraft()
          reset()
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent
        className={advanced ? 'max-w-3xl' : 'max-w-md'}
        style={advanced ? ADVANCED_DIALOG_STYLE : undefined}
      >
        <DialogHeader>
          <DialogTitle>{b.bot.newTitle}</DialogTitle>
          <DialogDescription>{b.editor.newDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3.5">
          <div className="flex justify-center py-1">
            <BotFace
              color={avatarColor(color, slug || 'agent')}
              image={image}
              name={slug || 'agent'}
              shape={shape}
              size={56}
            />
          </div>
          <AvatarPicker
            color={color}
            generateSeed={{
              name: slug || 'agent',
              title,
              description
            }}
            image={image}
            onColor={setColor}
            onImage={setImage}
            onShape={setShape}
            shape={shape}
          />
          {labeled(
            t.profiles.nameLabel,
            <Input
              autoFocus
              onChange={event => setName(event.target.value)}
              placeholder={b.bot.namePlaceholder}
              value={name}
            />
          )}
          {taken ? (
            <div className="text-xs text-(--ui-accent)">
              {remoteTarget ? b.bot.nameTakenOn(slug, targetLabel) : b.bot.nameTaken(slug)}
            </div>
          ) : null}
          {/* Multi-connection desktops choose WHERE the agent lives. Hidden */
          /* on single-connection setups — the active gateway is the only */
          /* possible home, exactly the old behavior. */}
          {Array.isArray(connections) && connections.length > 1
            ? labeled(
                b.bot.createOn,
                <Select
                  onValueChange={value => {
                    // A draft minted on the old home is not this bot anymore.
                    discardDraft()
                    setCreatedForCaps(null)
                    setTargetConnection(value === (activeConnectionId || 'local') ? '' : value)
                    // The capability catalog and clone list belong to the
                    // target backend — refetch for the new home. The live
                    // Capabilities tab re-pins to it via fixedConnection on
                    // builds that route it (staged checklists otherwise).
                    setCaps(null)
                    setCapsFailed(false)
                    setAdvTab('general')
                  }}
                  value={targetConnection || activeConnectionId || 'local'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map(connection => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.id === (activeConnectionId || 'local')
                          ? `${connection.label || connection.id} (${b.bot.currentSuffix})`
                          : connection.label || connection.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            : null}
          {remoteTarget ? (
            <div className="text-[length:var(--aino-text-caption)] leading-5 text-(--ui-text-tertiary)">
              {b.bot.remoteCreateHint(targetLabel)}
            </div>
          ) : null}
          {labeled(
            t.profiles.displayNameLabel,
            <Input
              onChange={event => setTitle(event.target.value)}
              placeholder={b.bot.titlePlaceholder}
              value={title}
            />
          )}
          {labeled(
            b.bot.descriptionLabel,
            <Textarea
              className="min-h-16"
              onChange={event => setDescription(event.target.value)}
              placeholder={b.bot.helpPromptPlaceholder}
              value={description}
            />
          )}
          <Button
            className="flex items-center gap-1 text-xs font-medium text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)"
            onClick={() => {
              setAdvanced(v => {
                if (!v) {
                  ensureCaps()
                }

                return !v
              })
            }}
            size="inline"
            variant="text"
          >
            <DisclosureCaret open={advanced} />
            {b.bot.advanced}
          </Button>
          {advanced ? (
            <div className="grid gap-3">
              <SegmentedControl
                onChange={id => {
                  setAdvTab(id)
                  setCapFilter('')

                  if (id === 'capabilities') {
                    // The live surface needs a real profile; a name typed later
                    // is picked up by useCapabilitiesDraft.
                    materializeForCaps()
                  } else if (id !== 'general') {
                    ensureCaps()
                  }
                }}
                options={creationTabs(
                  b,
                  Boolean(CapabilitiesView && (!remoteTarget || capabilitiesViewRoutesConnections))
                )}
                value={advTab}
              />
              {advTab === 'general' ? (
                <div className="grid gap-3.5">
                  {labeled(
                    remoteTarget ? b.editor.cloneFromOn(targetLabel) : b.editor.cloneFrom,
                    <Select
                      onValueChange={value => {
                        setCloneFrom(value)
                        setCaps(null)
                        setCapsFailed(false)
                      }}
                      value={remoteTarget && cloneFrom !== '__none__' ? 'default' : cloneFrom}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{b.bot.freshProfile}</SelectItem>
                        {/* The roster lists THIS window's profiles; the only clone
                            source guaranteed to exist on another machine is its
                            own default, so a remote target offers that or fresh. */}
                        {(remoteTarget ? [{ name: 'default' }] : roster).map(b => (
                          <SelectItem key={b.name} value={b.name}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <ModelPicker
                    onChange={patch => {
                      if ('provider' in patch) {
                        setProvider(patch.provider)
                      }

                      if ('model' in patch) {
                        setModel(patch.model)
                      }
                    }}
                    placeholderModel={b.bot.inheritedModel}
                    value={{
                      provider,
                      model
                    }}
                  />
                  {labeled(
                    b.bot.soulLabel,
                    <Textarea
                      className="min-h-24"
                      onChange={event => setSoul(event.target.value)}
                      placeholder={b.avatar.describeHint}
                      value={soul}
                    />
                  )}
                  <label className="flex items-center gap-2 text-xs text-(--ui-text-secondary)">
                    <Checkbox checked={shareAuth} onCheckedChange={value => setShareAuth(Boolean(value))} />
                    {remoteTarget ? b.editor.shareKeysOn(targetLabel) : b.editor.shareKeys}
                  </label>
                  <div className="pl-6 pt-0.5 text-[length:var(--aino-text-caption)] leading-5 text-(--ui-text-tertiary)">
                    {b.editor.shareKeysHint}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-(--ui-text-secondary)">
                    <Checkbox checked={noSkills} onCheckedChange={value => setNoSkills(Boolean(value))} />
                    {b.bot.noSkills}
                  </label>
                </div>
              ) : advTab === 'capabilities' ? (
                <CapabilitiesTab
                  connection={
                    createdForCaps ? draftSourceRef.current?.connectionId : remoteTarget ? targetConnection : undefined
                  }
                  draft={createdForCaps === slug ? createdForCaps : null}
                  hint={!valid ? b.editor.nameFirstHint : taken ? b.editor.nameTakenHint : null}
                />
              ) : capsFailed ? (
                <div className="px-2 py-3 text-center text-xs text-(--ui-text-tertiary)">
                  {b.bot.catalogUnsupported}
                </div>
              ) : !caps ? (
                <div className="flex justify-center py-4">
                  <GlyphSpinner className="text-(--ui-text-tertiary)" spinner="breathe" />
                </div>
              ) : advTab === 'skills' ? (
                noSkills ? (
                  <div className="px-2 py-3 text-center text-xs text-(--ui-text-tertiary)">{b.bot.emptySkills}</div>
                ) : (
                  <div className="grid gap-1.5">
                    <Input
                      onChange={event => setCapFilter(event.target.value)}
                      placeholder={b.tools.filterSkills}
                      size="sm"
                      value={capFilter}
                    />
                    <div
                      className="overflow-y-auto overscroll-contain"
                      style={{
                        maxHeight: 200
                      }}
                    >
                      <CheckList
                        columns={2}
                        items={
                          capFilter.trim()
                            ? caps.skills.filter(s => s.name.toLowerCase().includes(capFilter.trim().toLowerCase()))
                            : caps.skills
                        }
                        onToggle={(name, enabled) => toggleCap('skills', name, enabled)}
                      />
                    </div>
                    <div className="text-[length:var(--aino-text-caption)] leading-4 text-(--ui-text-tertiary)">
                      {b.bot.catalogFrom(caps.source)}
                    </div>
                    <HubSkillsSection
                      onInstalled={name =>
                        setCaps(prev =>
                          !prev || prev.skills.some(s => s.name === name)
                            ? prev
                            : {
                                ...prev,
                                skills: [
                                  ...prev.skills,
                                  {
                                    name,
                                    enabled: true
                                  }
                                ]
                              }
                        )
                      }
                    />
                  </div>
                )
              ) : advTab === 'toolsets' ? (
                <div className="grid gap-1.5">
                  <div
                    className="overflow-y-auto overscroll-contain"
                    style={{
                      maxHeight: 200
                    }}
                  >
                    <CheckList
                      columns={2}
                      items={caps.toolsets}
                      onToggle={(name, enabled) => toggleCap('toolsets', name, enabled)}
                    />
                  </div>
                  <div className="text-[length:var(--aino-text-caption)] leading-4 text-(--ui-text-tertiary)">
                    {b.bot.toolsetHint}
                  </div>
                </div>
              ) : caps.mcp.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-(--ui-text-tertiary)">{b.tools.noMcpServers}</div>
              ) : (
                <div className="grid gap-1.5">
                  <div
                    className="overflow-y-auto overscroll-contain"
                    style={{
                      maxHeight: 200
                    }}
                  >
                    <div className="grid gap-1">
                      {caps.mcp.map(m => {
                        const needsSetup =
                          m.fromCatalog &&
                          !m.installed &&
                          ((m.requires || []).length > 0 || (m.auth || '').toLowerCase() === 'oauth')

                        return (
                          <label className="flex items-start gap-2 text-xs text-(--ui-text-secondary)" key={m.name}>
                            <Checkbox
                              checked={!!m.enabled}
                              disabled={needsSetup}
                              onCheckedChange={value => toggleCap('mcp', m.name, Boolean(value))}
                            />
                            <span className="min-w-0">
                              <span>{m.name}</span>
                              {m.fromCatalog && !needsSetup ? (
                                <span className="ml-1.5 text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
                                  {m.installed ? b.bot.catalogInstalled : b.bot.catalog}
                                </span>
                              ) : null}
                              {needsSetup ? (
                                <McpSetupButton
                                  ensureProfile={ensureAgentCreated}
                                  entry={m}
                                  onDone={() => {
                                    // Setup done: mark installed so the row's
                                    // checkbox un-disables, and enable it.
                                    setCaps(prev =>
                                      prev
                                        ? {
                                            ...prev,
                                            mcp: prev.mcp.map(x =>
                                              x.name === m.name
                                                ? {
                                                    ...x,
                                                    installed: true,
                                                    enabled: true
                                                  }
                                                : x
                                            )
                                          }
                                        : prev
                                    )
                                    setDirtyCaps(prev => ({
                                      ...prev,
                                      mcp: true
                                    }))
                                  }}
                                  profile={createdRef.current}
                                />
                              ) : null}
                              {m.description ? (
                                <div className="truncate text-[length:var(--aino-text-caption)] leading-4 text-(--ui-text-tertiary)">
                                  {m.description}
                                </div>
                              ) : null}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  <div className="text-[length:var(--aino-text-caption)] leading-4 text-(--ui-text-tertiary)">
                    {b.bot.mcpHint}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {error ? <div className="px-0 py-2 text-xs text-(--ui-accent)">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => {
              discardDraft()
              reset()
              onClose()
            }}
            variant="ghost"
          >
            {t.common.cancel}
          </Button>
          <Button disabled={busy || !valid || taken} onClick={submit}>
            {busy ? b.bot.creating : b.bot.createAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface GroupDialogProps {
  bot: RosterRow
  onClose: () => void
}

/** Assign a bot to a group-chat membership without replacing its others.
 *  Existing groups are independent toggles; the input creates and joins a new
 *  one. Canonical groups + the legacy scalar projection ride ui_meta. */
export function GroupDialog({ bot, onClose }: GroupDialogProps) {
  const b = useBots()
  const meta = useValue($botMeta)
  const [name, setName] = useState('')
  const connectionId = useValue(host.state.connectionId)
  const roster: RosterRow[] = useValue($lastRoster)
  const current = botGroups(botRosterMeta(bot, meta))
  const groups = knownGroups(meta)
  const botName = displayName(bot, botRosterMeta(bot, meta))
  // Its groups[] also live on its own machine: a change saved while that
  // machine is offline would land only here and be undone on reconnect.
  const locked = memberMachineOffline(roster.find(row => botRosterKey(row) === botRosterKey(bot)) || bot, connectionId)

  const setMembership = async (group: string, enabled: boolean) => {
    try {
      await setGroupMembership(bot, group, enabled)
    } catch (error) {
      host.notify({ kind: 'error', message: error instanceof Error ? error.message : String(error) })

      return false
    }

    host.notify({
      kind: 'info',
      message: enabled ? `${botName} added to “${group}”` : `${botName} removed from “${group}”`
    })

    return true
  }

  return (
    <Dialog
      onOpenChange={value => {
        if (!value) {
          onClose()
        }
      }}
      open={Boolean(bot)}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{b.group.manageTitle}</DialogTitle>
          <DialogDescription>{b.group.manageDesc}</DialogDescription>
        </DialogHeader>
        {groups.length ? (
          <div className="grid gap-1.5">
            {groups.map(group => {
              const enabled = current.includes(group)

              return (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-(--aino-radius-row) px-2 py-1.5 text-sm hover:bg-(--chrome-action-hover)"
                  key={group}
                >
                  <Checkbox
                    checked={enabled}
                    disabled={locked}
                    onCheckedChange={checked => void setMembership(group, checked === true)}
                  />
                  <span>{group}</span>
                </label>
              )
            })}
          </div>
        ) : null}
        {locked ? (
          <div className="text-xs text-(--ui-text-tertiary)" data-testid="group-dialog-locked">
            {b.crossGateway.groupsOffline(connectionName(bot), botName)}
          </div>
        ) : null}
        <form
          className="flex items-center gap-1.5"
          onSubmit={event => {
            event.preventDefault()
            const trimmed = name.trim()

            if (trimmed && !locked) {
              void setMembership(trimmed, true)
              setName('')
            }
          }}
        >
          <Input
            autoFocus
            disabled={locked}
            onChange={event => setName(event.target.value)}
            placeholder={groups.length ? b.group.newGroupPlaceholder : b.group.groupNameExample}
            value={name}
          />
          <Button disabled={locked || !name.trim()} size="sm" type="submit">
            {b.group.createAndJoin}
          </Button>
        </form>
        {current.length ? (
          <Button
            className="justify-self-start"
            disabled={locked}
            onClick={() =>
              void (async () => {
                // Sequential: each toggle patches groups[] from the current meta;
                // stop at the first one that did not land.
                for (const group of current) {
                  if (!(await setMembership(group, false))) {
                    return
                  }
                }
              })()
            }
            size="sm"
            variant="ghost"
          >
            {b.bot.removeFromAllGroups}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

interface CreateGroupChatDialogProps {
  onClose: () => void
  onCreated?: (group: string, origin: CanonicalGroupOrigin) => void
  open: boolean
  roster: RosterRow[]
}

/** Write a Desktop-driven room (every selection on a legacy gateway, or one
 *  spanning connections) and return its unique name. Nothing is written once
 *  `sourceCurrent` turns false. */
function persistDesktopDrivenGroup(
  base: string,
  selected: RosterRow[],
  allMeta: Record<string, BotMeta>,
  image: null | string,
  sourceCurrent: () => boolean,
  unavailable: string,
  connectionId: null | string
): string {
  // Creating a group is always a FRESH room. Without this, re-creating a
  // group under an existing name (easy — the default name is just the
  // member names) silently reopens the old room with its full log, which
  // reads as "not a fresh group" (db's Aug 2026 report). Uniquify against
  // both live rooms and any bot's current grouping, then mint a fresh
  // roomId: member sessions are titled by that roomId, so a
  // disbanded-and-recreated group with the SAME display name still gets
  // new sessions instead of resuming the old room's by title.
  const taken = new Set(liveGroupChatNames())

  for (const meta of Object.values($botMeta.get() || {})) {
    for (const existing of botGroups(meta)) {
      taken.add(existing)
    }
  }

  const groupName = uniqueGroupChatName(base, taken)
  const roomId = mintGroupRoomId()

  if (!sourceCurrent()) {
    throw new Error(unavailable)
  }

  for (const bot of selected) {
    void saveBotMeta(bot, groupMembershipPatch(botRosterMeta(bot, allMeta), groupName, true))
  }

  // Persist every machine identity, including today's active source. That
  // member becomes remote after a source switch and cannot rely on the new
  // gateway's name-keyed bot metadata to remain seated in this room.
  const roomMembers = durableGroupChatMembers(selected)
  updateGroupChat(groupName, (room: GroupChatRoom) => {
    room.members = roomMembers
    room.roomId = roomId

    // Recorded once: later membership edits must not re-decide who drives it.
    if (groupNeedsDesktopCourier(selected, connectionId)) {
      room.engine = 'desktop'
    }

    if (image) {
      room.image = image
    }

    return room
  })

  return groupName
}

interface GroupEngineNoteProps {
  connectionId: null | string
  engine: GroupCreationEngine | null
  selected: RosterRow[]
}

/** Says, before creation, when a selection makes a Desktop-driven room or
 *  cannot be created from this connection at all. */
function GroupEngineNote({ connectionId, engine, selected }: GroupEngineNoteProps) {
  const b = useBots()
  const desktopDriven = engine === 'desktop' && groupNeedsDesktopCourier(selected, connectionId)

  if (engine !== 'elsewhere' && !desktopDriven) {
    return null
  }

  return (
    <p className="text-xs text-(--ui-text-secondary)" data-group-engine={engine} role="note">
      {engine === 'elsewhere'
        ? b.crossGateway.selectionElsewhere(connectionName(selected[0]))
        : b.crossGateway.desktopDriven}
    </p>
  )
}

async function revalidateGroupCreationMode(
  route: CanonicalGroupRoute,
  capability: GroupCapabilityState | null,
  source: string,
  unavailableMessage: string
) {
  const sourceCurrent = groupCreationSource(route, capability?.activationEpoch ?? -1)

  if (!capability || capability.source !== source || !sourceCurrent()) {
    throw new Error(unavailableMessage)
  }

  const mode = capability.mode

  if (mode !== 'canonical' && mode !== 'legacy') {
    throw new Error(unavailableMessage)
  }

  const freshMode = groupExecutionMode(await canonicalGroupRequest<unknown>(route, 'groups.capabilities'))

  if (!sourceCurrent() || freshMode !== mode) {
    throw new Error(unavailableMessage)
  }

  return { mode, sourceCurrent }
}

/** Discord-style group chat creation: pick 2+ routable bots via checkboxes
 *  (with search), name the group, create. A selection on the current connection
 *  becomes a gateway-owned room there; one that reaches another connection (or
 *  any selection on a legacy gateway) becomes a Desktop-driven room, whose
 *  memberships append to each bot's group list and sync through ui_meta. */
export function CreateGroupChatDialog({ open, roster, onClose, onCreated }: CreateGroupChatDialogProps) {
  const { t } = useI18n()
  const b = useBots()
  const allMeta: Record<string, BotMeta> = useValue($botMeta)
  const { capability, connectionId, mode, observedRoute, seatable, source } = useGroupCapability(open)

  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [name, setName] = useState('')
  const [image, setImage] = useState<null | string>(null)
  const [pending, setPending] = useState(false)
  const [createError, setCreateError] = useState('')

  // Reset per open so a cancelled draft doesn't leak into the next one.
  useEffect(() => {
    if (open) {
      setQuery('')
      setChecked({})
      setName('')
      setImage(null)
      setCreateError('')
    }
  }, [open])

  // An outage placeholder or a bot the authority will not seat is never offered.
  const selectableRoster = seatableGroupBots(roster, { connectionId, mode, seatable })

  const selected = selectableRoster.filter(bot => checked[botRosterKey(bot)])
  // A selection spanning connections cannot be owned by one gateway: the room
  // runs on this Desktop, which carries each member's turn home. A selection
  // wholly on ANOTHER connection can be owned by neither side from here.
  const engine = mode === 'canonical' || mode === 'legacy' ? groupCreationEngine(mode, selected, connectionId) : null
  const spansConnections = selectableRoster.some(bot => !botOnConnection(bot, connectionId))
  const visible: RosterRow[] = filterBots(selectableRoster, allMeta, query)
  const atCap = selected.length >= GROUP_CHAT_MAX_MEMBERS

  const placeholder = selected.length
    ? selected.map(bot => displayName(bot, botRosterMeta(bot, allMeta))).join(', ')
    : b.group.nameLabel

  const canCreate =
    selected.length >= 2 && Boolean(name.trim() || selected.length) && engine !== null && engine !== 'elsewhere'

  const creating = useRef(false)

  const create = async () => {
    if (creating.current) {
      return
    }

    creating.current = true
    setPending(true)
    setCreateError('')

    try {
      const base = (name.trim() || placeholder).slice(0, 64)

      if (selected.length < 2 || !base) {
        return
      }

      const route = observedRoute

      if (!route) {
        throw new Error(b.canonical.driverUnavailable)
      }

      const { mode: currentMode, sourceCurrent } = await revalidateGroupCreationMode(
        route,
        capability,
        source,
        b.canonical.driverUnavailable
      )

      if (!sourceCurrent()) {
        throw new Error(b.canonical.driverUnavailable)
      }

      const engine = groupCreationEngine(currentMode, selected, route.connectionId)

      if (engine === 'elsewhere') {
        throw new Error(b.crossGateway.selectionElsewhere(connectionName(selected[0])))
      }

      if (engine === 'gateway') {
        const created = await createCanonicalGroup(route, base, durableGroupChatMembers(selected))

        // Creation already succeeded; leave it on its owner without adopting a stale result.
        if (!sourceCurrent()) {
          return
        }

        const key = registerCanonicalGroup(route, created.room)
        refreshGatewayGroupRooms()
        onClose()
        onCreated?.(key, 'key')

        return
      }

      const groupName = persistDesktopDrivenGroup(
        base,
        selected,
        allMeta,
        image,
        sourceCurrent,
        b.canonical.driverUnavailable,
        route.connectionId
      )

      host.notify({
        kind: 'info',
        message: b.group.createdWith(groupName, selected.length)
      })
      onClose()
      onCreated?.(groupName, 'name')
    } catch (error) {
      const message = canonicalGroupCreateError(error, b.canonical)
      setCreateError(message)
      host.notify({ kind: 'error', message })
    } finally {
      creating.current = false
      setPending(false)
    }
  }

  return (
    <Dialog
      onOpenChange={value => {
        if (!value && !creating.current) {
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-md aino-group-create-dialog">
        <DialogHeader>
          <DialogTitle>{b.group.newTitle}</DialogTitle>
          <DialogDescription>{b.group.newDescription(GROUP_CHAT_MAX_MEMBERS)}</DialogDescription>
        </DialogHeader>
        {mode === 'unavailable' && <p role="status">{b.canonical.driverUnavailable}</p>}
        <GroupEngineNote connectionId={connectionId} engine={engine} selected={selected} />
        {/* TODO(bot-mode-types): this search box never takes focus when the dialog
            opens — SearchField accepts no `autoFocus` prop and forwards no extra
            props, so the `autoFocus` that used to sit here was inert. */}
        <fieldset className="aino-group-create-fields" disabled={pending}>
          <SearchField
            aria-label={b.group.searchToAdd}
            containerClassName="w-full"
            inputClassName="w-full"
            onChange={value => {
              if (!pending) {
                setQuery(value)
              }
            }}
            placeholder={b.group.searchToAddPlaceholder}
            value={query}
          />
          <GroupCreateMembers
            allMeta={allMeta}
            atCap={atCap}
            checked={checked}
            disabled={pending}
            onToggle={(key, value) => setChecked(prev => ({ ...prev, [key]: value }))}
            query={query}
            selected={selected}
            visible={visible}
          />
          <div className="grid gap-2">
            <GroupImageControls
              image={image}
              onImage={setImage}
              seedMembers={selected.map(bot => displayName(bot, botRosterMeta(bot, allMeta)))}
              seedName={name.trim() || (selected.length ? placeholder : '')}
            />
            <form
              onSubmit={event => {
                event.preventDefault()
                create()
              }}
            >
              <Input
                aria-label={b.group.nameLabel}
                disabled={pending}
                maxLength={64}
                onChange={event => setName(event.target.value)}
                placeholder={placeholder}
                value={name}
              />
            </form>
          </div>
        </fieldset>
        {createError && (
          <p className="aino-group-create-error" role="alert">
            {createError}
          </p>
        )}
        <DialogFooter>
          <Button disabled={pending} onClick={onClose} variant="secondary">
            {t.common.cancel}
          </Button>
          <Button aria-busy={pending} disabled={pending || !canCreate} onClick={create}>
            {pending ? (
              <>
                <span aria-hidden="true">
                  <GlyphSpinner />
                </span>
                {b.editor.creating}
              </>
            ) : (
              `${b.group.newTitle}${selected.length ? ` (${selected.length})` : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
