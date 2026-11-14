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
import { type ComponentProps, useEffect, useRef, useState } from 'react'

import { avatarColor, blobatarSvg, BotFace } from './avatar'
import { AvatarPicker } from './avatar-picker'
import {
  botOnConnection,
  connectionName,
  groupCreationEngine,
  groupSeatsPeers,
  revalidateGroupCreation,
  seatableGroupBots,
  useGroupCapability
} from './canonical-group-capabilities'
import type { GroupCreationPlan } from './canonical-group-capabilities'
import { canonicalMemberName } from './canonical-group-members'
import { createGroupAcrossConnections, peerSetupText, usePeerTargets } from './canonical-group-peers'
import { refreshGatewayGroupRooms, registerCanonicalGroup } from './canonical-group-registry'
import type { CanonicalGroupOrigin } from './canonical-group-registry'
import { canonicalGroupCreateError, canonicalGroupCreateNotice, createCanonicalGroup } from './canonical-groups'
import type { GroupCreationIntent } from './canonical-groups'
import {
  type CapabilityCatalog,
  type DraftResetSnapshot,
  useDraftBaseChange,
  useDraftCapabilities
} from './create-draft-change'
import { applyCreatedModelChoice, readCreatedModelReadiness } from './create-model-choice'
import { $botMeta, $lastRoster, botRosterKey, filterBots, ROSTER_KEY, saveBotMeta } from './data'
import { labeled, ResizableFrame } from './dialog-parts'
import { updateGroupChat } from './group-chat'
import { GROUP_CHAT_MAX_MEMBERS, uniqueGroupChatName } from './group-chat'
import { GroupImageControls } from './group-chat-parts'
import { memberMachineOffline, setGroupMembership } from './group-chat-view-members'
import { GroupCreateMembers } from './group-create-members'
import { botGroups, durableGroupChatMembers, knownGroups, liveGroupChatNames } from './group-membership'
import { useBots } from './i18n'
import { botProfileIdentity, displayName } from './labels'
import { McpSetupButton } from './mcp-setup'
import { ModelPicker } from './model-picker'
import type { McpCatalogResponse, ProfileConfigurePayload, ProfileDescribeResponse } from './profile-config'
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

interface CreateAgentAppearanceProps extends Omit<ComponentProps<typeof AvatarPicker>, 'generateSeed'> {
  slug: string
  title: string
  description: string
}

function CreateAgentAppearance({ slug, title, description, ...picker }: CreateAgentAppearanceProps) {
  const name = slug || 'agent'

  return (
    <>
      <div className="flex justify-center py-1">
        <BotFace
          color={avatarColor(picker.color, name)}
          image={picker.image}
          name={name}
          shape={picker.shape}
          size={56}
        />
      </div>
      <AvatarPicker {...picker} generateSeed={{ name, title, description }} />
    </>
  )
}

interface CreateAgentDescriptionFieldsProps {
  title: string
  description: string
  onTitle: (value: string) => void
  onDescription: (value: string) => void
}

function CreateAgentDescriptionFields({
  title,
  description,
  onTitle,
  onDescription
}: CreateAgentDescriptionFieldsProps) {
  const { t } = useI18n()
  const b = useBots()

  return (
    <>
      {labeled(
        t.profiles.displayNameLabel,
        <Input onChange={event => onTitle(event.target.value)} placeholder={b.bot.titlePlaceholder} value={title} />
      )}
      {labeled(
        b.bot.descriptionLabel,
        <Textarea
          className="min-h-16"
          onChange={event => onDescription(event.target.value)}
          placeholder={b.bot.helpPromptPlaceholder}
          value={description}
        />
      )}
    </>
  )
}

interface CreateAgentNameFieldProps {
  name: string
  onName: (value: string) => void
  taken: boolean
  slug: string
  remoteTarget: boolean
  targetLabel: string
}

function CreateAgentNameField({ name, onName, taken, slug, remoteTarget, targetLabel }: CreateAgentNameFieldProps) {
  const { t } = useI18n()
  const b = useBots()

  return (
    <>
      {labeled(
        t.profiles.nameLabel,
        <Input
          autoFocus
          onChange={event => onName(event.target.value)}
          placeholder={b.bot.namePlaceholder}
          value={name}
        />
      )}
      {taken ? (
        <div className="text-xs text-(--ui-accent)">
          {remoteTarget ? b.bot.nameTakenOn(slug, targetLabel) : b.bot.nameTaken(slug)}
        </div>
      ) : null}
    </>
  )
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
async function deleteDraftProfile(draft: string, target: string, failureMessage: string): Promise<void> {
  if (!target) {
    await deleteBot({ name: draft })

    return
  }

  const result = await requestOnTarget<{ blocked?: boolean; code?: number; hint?: string; output?: string }>(
    target,
    'cli.exec',
    { argv: ['profile', 'delete', draft, '--yes'] }
  )

  if (result.blocked || result.code !== 0) {
    throw new Error(result.hint || result.output || failureMessage)
  }
}

function discardDraftProfile(draft: string, target: string, b: ReturnType<typeof useBots>) {
  void deleteDraftProfile(draft, target, b.bot.draftCleanupFailed(draft))
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

  const captureReset = (): DraftResetSnapshot | null => {
    if (!createdRef.current && !flightRef.current) {
      return null
    }

    const generation = draftGenRef.current
    const source = activeCreationSource()
    const owner = draftSourceRef.current
    const target = draftTargetRef.current
    const creating = flightRef.current

    const current = () =>
      generation === draftGenRef.current &&
      source === activeCreationSource() &&
      owner === draftSourceRef.current &&
      target === draftTargetRef.current &&
      (Boolean(target) || owner?.identity === source)

    return {
      remove: async () => {
        await creating

        if (!current()) {
          throw new Error(b.editor.draftResetStale)
        }

        const draft = createdRef.current

        if (draft) {
          await deleteDraftProfile(draft, target, b.bot.draftCleanupFailed(draft))
        }

        if (!current()) {
          throw new Error(b.editor.draftResetStale)
        }

        draftGenRef.current += 1
        createdRef.current = flightRef.current = null
      }
    }
  }

  useEffect(
    () => () => {
      draftGenRef.current += 1
    },
    []
  )

  return { discardDraft, captureReset, draftGenRef, draftTargetRef, draftSourceRef }
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

  const { discardDraft, captureReset, draftGenRef, draftTargetRef, draftSourceRef } = useDraftProfile(
    createdRef,
    flightRef
  )

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
  const {
    createdForCaps,
    setCreatedForCaps,
    caps,
    setCaps,
    capsFailed,
    setCapsFailed,
    dirtyCaps,
    setDirtyCaps,
    capFilter,
    setCapFilter,
    resetCapabilities
  } = useDraftCapabilities()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const draftBaseChange = useDraftBaseChange({
    capture: captureReset,
    labels: {
      title: b.editor.draftResetTitle,
      description: b.editor.draftResetDescription,
      confirmLabel: b.editor.draftResetAction
    },
    afterReset: () => {
      resetCapabilities()
      queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
    }
  })

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
    resetCapabilities()
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
      draftTargetRef.current = target
      draftSourceRef.current = { identity: source, connectionId: target || sourceConnection }
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
        })
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
    const openingCurrent = () => openingGeneration === getBotOpenGeneration() && openingStillCurrent()

    try {
      const creating = ensureAgentCreated()
      const draftGeneration = draftGenRef.current
      const slugCreated = await creating

      if (!slugCreated) {
        setBusy(false)
        setError(b.bot.createFailed)

        return
      }

      const who = displayName({ name: slug, title: botTitle })
      const createdMessage = remoteTarget ? b.editor.createdOn(who, targetLabel) : b.editor.created(who)

      const modelApplied = await applyCreatedModelChoice({
        model,
        provider,
        confirmLabel: t.common.confirm,
        failureMessage: b.editor.modelSwitchFailed,
        isCurrent: () => openingStillCurrent() && draftGeneration === draftGenRef.current,
        onStale: () => {
          if (draftGeneration !== draftGenRef.current) {
            return
          }

          host.notify({ kind: 'success', message: createdMessage })
          reset()
          onClose()
        },
        request: selection => requestForTarget('profiles.configure', { name: slugCreated, ...selection })
      })

      if (!modelApplied) {
        if (draftGeneration === draftGenRef.current) {
          setBusy(false)
        }

        return
      }

      // The intro turn is a real model call. Probe the new profile's route
      // first so a bot whose machine has no usable credential lands as
      // "created, needs a model" instead of a doomed "No LLM provider" turn.
      // Only an explicit `ok: false` counts; older gateways proceed as before.
      const needsModel = await readCreatedModelReadiness(
        () => requestForTarget<RuntimeReadiness>('setup.runtime_check', { profile: slugCreated }),
        () => draftGeneration === draftGenRef.current,
        readiness =>
          notifyCreatedBot(readiness, { bot, createdMessage, editor: b.editor, onConfigureModel, remoteTarget })
      )

      if (needsModel === null) {
        return
      }

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

      if (openingCurrent()) {
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

        if (!openingCurrent()) {
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
        <fieldset className="grid min-w-0 gap-3.5 border-0 p-0" disabled={busy}>
          <CreateAgentAppearance
            color={color}
            description={description}
            image={image}
            onColor={setColor}
            onImage={setImage}
            onShape={setShape}
            shape={shape}
            slug={slug}
            title={title}
          />
          <CreateAgentNameField
            name={name}
            onName={setName}
            remoteTarget={remoteTarget}
            slug={slug}
            taken={taken}
            targetLabel={targetLabel}
          />
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
          <CreateAgentDescriptionFields
            description={description}
            onDescription={setDescription}
            onTitle={setTitle}
            title={title}
          />
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
                        draftBaseChange.change(() => {
                          setCloneFrom(value)
                          setCaps(null)
                          setCapsFailed(false)
                        })
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
                    <Checkbox
                      checked={shareAuth}
                      onCheckedChange={value => draftBaseChange.change(() => setShareAuth(Boolean(value)))}
                    />
                    {remoteTarget ? b.editor.shareKeysOn(targetLabel) : b.editor.shareKeys}
                  </label>
                  <div className="pl-6 pt-0.5 text-[length:var(--aino-text-caption)] leading-5 text-(--ui-text-tertiary)">
                    {b.editor.shareKeysHint}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-(--ui-text-secondary)">
                    <Checkbox
                      checked={noSkills}
                      onCheckedChange={value => draftBaseChange.change(() => setNoSkills(Boolean(value)))}
                    />
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
          {error ? (
            <div className="px-0 py-2 text-xs text-(--ui-accent)" role="alert">
              {error}
            </div>
          ) : null}
        </fieldset>
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
      {draftBaseChange.dialog}
    </Dialog>
  )
}

interface GroupDialogProps {
  bot: RosterRow
  onClose: () => void
  /** Called with the group chat New group chat created for a new name. */
  onCreated?: (group: string, origin: CanonicalGroupOrigin) => void
}

/** Assign a bot to a group-chat membership without replacing its others.
 *  Existing groups are independent toggles. A new name is a new group chat, so
 *  Create & join opens New group chat with this bot and the name filled in: a
 *  gateway runs it, and nothing here makes a Desktop-run room. */
export function GroupDialog({ bot, onClose, onCreated }: GroupDialogProps) {
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
  const row = roster.find(candidate => botRosterKey(candidate) === botRosterKey(bot)) || bot
  const locked = memberMachineOffline(row, connectionId)
  const [creating, setCreating] = useState<null | string>(null)

  if (creating !== null) {
    return (
      <CreateGroupChatDialog
        onClose={onClose}
        onCreated={onCreated}
        open
        roster={roster}
        seed={{ bots: [row], name: creating }}
      />
    )
  }

  const setMembership = async (group: string, enabled: boolean) => {
    try {
      await setGroupMembership(bot, group, enabled)
    } catch (error) {
      host.notify({ kind: 'error', message: error instanceof Error ? error.message : String(error) })

      return false
    }

    host.notify({
      kind: 'info',
      message: enabled ? b.group.memberAdded(botName, group) : b.group.memberRemoved(botName, group)
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
              setCreating(trimmed)
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
  /** The bots and name a draft opens with (Manage groups' Create & join). */
  seed?: { bots: RosterRow[]; name: string }
}

interface GroupPlanNoteProps {
  connectionId: null | string
  plan: GroupCreationPlan
  owner: string
  selected: RosterRow[]
}

/** Before creation: where the group chat will run, or exactly what is missing and on which
 *  computer. Every new group chat runs on a gateway; nothing falls back to this Desktop. */
function GroupPlanNote({ connectionId, plan, owner, selected }: GroupPlanNoteProps) {
  const b = useBots()
  const { engine, reason } = plan
  const where = plan.connection || owner
  const local = (plan.connectionId ?? connectionId) === 'local'

  // The dialog's status line already says the owner can't run group chats right now.
  if (engine === 'gateway' || reason === 'owner_unavailable') {
    return null
  }

  const text =
    engine === 'gateway-peer'
      ? b.crossGateway.gatewayPeer(owner, (connectionId ?? '') === 'local')
      : engine === 'checking'
        ? b.crossGateway.checkingPeers
        : engine === 'elsewhere'
          ? b.crossGateway.selectionElsewhere(connectionName(selected[0]))
          : groupPlanProblem(reason, where, local, b)

  return (
    <p className="text-xs text-(--ui-text-secondary)" data-group-engine={engine} role="note">
      {text}
    </p>
  )
}

function groupPlanProblem(
  reason: string | undefined,
  where: string,
  local: boolean,
  b: ReturnType<typeof useBots>
): string {
  const place = local ? b.bot.thisDevice : where

  const words: Record<string, string> = {
    unreachable: b.crossGateway.peerCheckFailed(where, local),
    owner_update_required: b.crossGateway.ownerUpdateRequired(place),
    peer_owner_unavailable: b.crossGateway.ownerCannotSeatPeers(place),
    route_unavailable: b.crossGateway.peerRouteMissing,
    profile_unseatable: b.canonical.createOtherConnection,
    peer_gateway_changed: b.crossGateway.peerGatewayChanged(place)
  }

  return words[reason ?? ''] ?? peerSetupText(reason ?? '', place, b.canonical)
}

/** Discord-style group chat creation: pick 2+ routable bots via checkboxes
 *  (with search), name the group, create. Every group chat is created on and run
 *  by this connection's gateway, which keeps it running with Desktop closed; bots
 *  on other computers are seated through their own gateways. When that is not
 *  possible the dialog says what is missing on which computer and offers Retry. */
export function CreateGroupChatDialog({ open, roster, onClose, onCreated, seed }: CreateGroupChatDialogProps) {
  const { t } = useI18n()
  const b = useBots()
  const allMeta: Record<string, BotMeta> = useValue($botMeta)
  const [peerCheck, setPeerCheck] = useState(0)
  const { capability, connectionId, mode, observedRoute, seatable, source } = useGroupCapability(open, peerCheck)

  const intent = useRef<GroupCreationIntent>({})
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [name, setName] = useState('')
  const [image, setImage] = useState<null | string>(null)
  const [pending, setPending] = useState(false)
  const [createError, setCreateError] = useState('')
  const [notice, setNotice] = useState('')
  // A notice speaks for the draft that asked; a late answer must not land on a newer one.
  const draft = useRef(0)

  const newDraft = () => {
    draft.current += 1
    setNotice('')
  }

  // Reset per open so a cancelled draft doesn't leak into the next one.
  // eslint-disable-next-line no-restricted-syntax -- Clears a dialog-owned request intent; no reactive state is copied.
  useEffect(() => {
    if (open) {
      intent.current = {}
      newDraft()
      setQuery('')
      setChecked(Object.fromEntries((seed?.bots ?? []).map(bot => [botRosterKey(bot), true])))
      setName(seed?.name ?? '')
      setImage(null)
      setCreateError('')
    }
    // The seed is read once per open: a re-render must not wipe the person's picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // An outage placeholder or a bot the authority will not seat is never offered.
  const selectableRoster = seatableGroupBots(roster, { connectionId, mode, seatable })

  const selected = selectableRoster.filter(bot => checked[botRosterKey(bot)])

  const targets = usePeerTargets(
    selectableRoster,
    connectionId,
    open && groupSeatsPeers(capability?.snapshot),
    peerCheck
  )

  const plan = groupCreationEngine(mode, selected, connectionId, capability?.snapshot, targets)
  const engine = plan.engine

  const owner =
    selectableRoster.find(bot => botOnConnection(bot, connectionId))?.connectionLabel ||
    (connectionId === 'local' ? b.bot.thisDevice : connectionId || b.bot.thisDevice)

  const spansConnections = selectableRoster.some(bot => !botOnConnection(bot, connectionId))
  const visible: RosterRow[] = filterBots(selectableRoster, allMeta, query)
  const atCap = selected.length >= GROUP_CHAT_MAX_MEMBERS

  const placeholder = selected.length
    ? selected.map(bot => displayName(bot, botRosterMeta(bot, allMeta))).join(', ')
    : b.group.nameLabel

  const canCreate =
    selected.length >= 2 && Boolean(name.trim() || selected.length) && ['gateway', 'gateway-peer'].includes(engine)

  const select = (bot: RosterRow, value: boolean) => {
    newDraft()
    setChecked(prev => ({ ...prev, [botRosterKey(bot)]: value }))
  }

  const creating = useRef(false)

  const create = async () => {
    if (creating.current) {
      return
    }

    creating.current = true
    setPending(true)
    setCreateError('')
    const submitted = draft.current
    setNotice('')

    try {
      const entered = name.trim().slice(0, 64)

      if (selected.length < 2) {
        return
      }

      const route = observedRoute

      if (!route) {
        throw new Error(b.canonical.driverUnavailable)
      }

      const {
        plan: fresh,
        targets: freshTargets,
        sourceCurrent
      } = await revalidateGroupCreation(
        route,
        capability,
        source,
        selected,
        engine,
        b.canonical.driverUnavailable
      ).catch(error => {
        setPeerCheck(value => value + 1)
        throw error
      })

      if (!sourceCurrent()) {
        throw new Error(b.canonical.driverUnavailable)
      }

      const members = durableGroupChatMembers(selected)

      // Keyed on the name as entered, blank included: the Bots' names that fill a blank one change
      // with the roster, so the sent name is chosen once, inside the frozen request.
      const fallback = placeholder.slice(0, 64)

      const created =
        fresh.engine === 'gateway-peer'
          ? await createGroupAcrossConnections(
              route,
              entered,
              members,
              freshTargets,
              intent.current,
              typed => typed || fallback
            )
          : {
              ...(await createCanonicalGroup(route, entered, members, intent.current, typed =>
                uniqueGroupChatName(typed || fallback, new Set(liveGroupChatNames()))
              )),
              unjoined: []
            }

      // Creation already succeeded; leave it on its owner without adopting a stale result.
      if (!sourceCurrent()) {
        return
      }

      intent.current = {}

      const key = registerCanonicalGroup(route, created.room, { created: true })

      if (image) {
        updateGroupChat(key, room => ({ ...room, image }))
      }

      refreshGatewayGroupRooms()
      onClose()
      onCreated?.(key, 'key')

      // The room is made either way; say who is missing so a seat that failed is never silent.
      if (created.unjoined.length) {
        host.notify({
          kind: 'warning',
          message: b.canonical.createdNotJoined.replace(
            '{names}',
            created.unjoined.map(({ member }) => canonicalMemberName(member)).join(', ')
          )
        })
      }
    } catch (error) {
      const next = canonicalGroupCreateNotice(error, b.canonical)

      if (!next) {
        const message = canonicalGroupCreateError(error, b.canonical)

        if (draft.current === submitted) {
          setCreateError(message)
        }

        host.notify({ kind: 'error', message })
      } else if (draft.current === submitted) {
        setNotice(next)
      }
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
          <DialogDescription>
            {b.crossGateway.pickBots(GROUP_CHAT_MAX_MEMBERS)} {b.crossGateway.gatewayMembership}
          </DialogDescription>
        </DialogHeader>
        {mode === 'unavailable' && <p role="status">{b.canonical.driverUnavailable}</p>}
        <GroupPlanNote connectionId={connectionId} owner={owner} plan={plan} selected={selected} />
        {engine === 'unavailable' && (
          <Button onClick={() => setPeerCheck(value => value + 1)} size="sm" variant="ghost">
            {t.common.retry}
          </Button>
        )}
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
            onToggle={(key, value) => {
              newDraft()
              setChecked(prev => ({ ...prev, [key]: value }))
            }}
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
                onChange={event => {
                  setName(event.target.value)
                  newDraft()
                }}
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
        {notice && (
          <p className="text-xs text-(--ui-text-secondary)" role="status">
            {notice}
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
