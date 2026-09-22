import { useStore } from '@nanostores/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { CodeEditor } from '@/components/chat/code-editor'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { getProfileSoul, type ProfileInfo, updateProfileSoul } from '@/hermes'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { AlertTriangle, Save } from '@/lib/icons'
import { resolveProfileColor } from '@/lib/profile-color'
import { normalize } from '@/lib/text'
import { $activeGatewayConnectionId } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import {
  $activeGatewayProfile,
  $profileColors,
  $profiles,
  normalizeProfileKey,
  profileLabel,
  refreshProfiles,
  selectProfile
} from '@/store/profile'
import { setSettingsScope } from '@/store/settings-scope'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import {
  PanelAddButton,
  PanelBody,
  PanelDetail,
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelListRow,
  type PanelMenuItem,
  PanelMeta,
  PanelPill,
  PanelSectionLabel
} from '../overlays/panel'
import { navigateToWorkspacePage, SETTINGS_ROUTE } from '../routes'

import { CreateProfileDialog } from './create-profile-dialog'
import { DeleteProfileDialog } from './delete-profile-dialog'
import { RenameProfileDialog } from './rename-profile-dialog'
import { WorkspaceControls } from './workspace-controls'

const CapabilitiesView = lazy(async () => ({ default: (await import('../capabilities')).CapabilitiesView }))

export function ProfilesView() {
  const connectionId = useStore($activeGatewayConnectionId)

  return <ProfilesManager key={connectionId ?? ''} />
}

function ProfilesManager() {
  const { t } = useI18n()
  const p = t.profiles
  const activeProfile = useStore($activeGatewayProfile)
  const profiles = useStore($profiles)
  const [loaded, setLoaded] = useState(false)
  const [selectedName, setSelectedName] = useState<null | string>(null)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingRename, setPendingRename] = useState<null | ProfileInfo>(null)
  const [pendingDelete, setPendingDelete] = useState<null | ProfileInfo>(null)

  const refresh = useCallback(async () => {
    try {
      await refreshProfiles()
      setLoaded(true)
    } catch (err) {
      notifyError(err, p.failedLoad)
    }
  }, [p])

  useRefreshHotkey(refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!loaded) {
      return
    }

    setSelectedName(current =>
      current && profiles.some(profile => profile.name === current)
        ? current
        : (profiles.find(profile => normalizeProfileKey(profile.name) === normalizeProfileKey(activeProfile))?.name ??
          profiles[0]?.name ??
          null)
    )
  }, [activeProfile, loaded, profiles])

  const selected = useMemo(() => {
    return profiles.find(p => p.name === selectedName) ?? profiles[0] ?? null
  }, [profiles, selectedName])

  const visibleProfiles = useMemo(() => {
    const q = normalize(query)

    if (!q) {
      return profiles
    }

    return profiles.filter(
      profile => profile.name.toLowerCase().includes(q) || (profile.model ?? '').toLowerCase().includes(q)
    )
  }, [profiles, query])

  // The shared Create/Rename dialogs own the createProfile / renameProfile /
  // updateProfileSoul calls; the panel just selects the resulting profile and
  // re-pulls the list.
  const selectAndRefresh = useCallback(
    async (name: string) => {
      setSelectedName(name)
      await refresh()
    },
    [refresh]
  )

  return (
    <section
      aria-label={t.sidebar.nav.profiles}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-4 sm:p-5"
      data-aino-page-shell=""
      data-workspaces-page=""
    >
      <PanelHeader subtitle={loaded ? p.count(profiles.length) : undefined} title={t.sidebar.nav.profiles} />
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{p.workspaceDesc}</p>
      {!loaded ? (
        <PageLoader label={p.loading} />
      ) : profiles.length === 0 ? (
        <PanelEmpty
          action={
            <Button onClick={() => setCreateOpen(true)} size="sm">
              {p.newProfile}
            </Button>
          }
          description={p.createDesc}
          icon="organization"
          title={p.noProfiles}
        />
      ) : (
        <>
          <PanelBody>
            <PanelList
              onSearchChange={setQuery}
              searchLabel={p.search}
              searchPlaceholder={p.search}
              searchValue={query}
            >
              {visibleProfiles.map(profile => (
                <ProfileRow
                  active={selected?.name === profile.name}
                  current={normalizeProfileKey(profile.name) === normalizeProfileKey(activeProfile)}
                  key={profile.name}
                  menuItems={
                    profile.is_default
                      ? // Renaming the default profile sets a presentation-only
                        // display name (the canonical id stays "default").
                        [{ icon: 'edit', label: p.renameMenu, onSelect: () => setPendingRename(profile) }]
                      : [
                          { icon: 'edit', label: p.renameMenu, onSelect: () => setPendingRename(profile) },
                          {
                            icon: 'trash',
                            label: t.common.delete,
                            onSelect: () => setPendingDelete(profile),
                            tone: 'danger'
                          }
                        ]
                  }
                  onSelect={() => setSelectedName(profile.name)}
                  profile={profile}
                />
              ))}
              <PanelAddButton label={p.newProfile} onClick={() => setCreateOpen(true)} />
              <div className="mt-auto border-t border-(--ui-stroke-tertiary) pt-2">
                <WorkspaceControls />
              </div>
            </PanelList>

            {selected ? (
              <ProfileDetail
                current={normalizeProfileKey(selected.name) === normalizeProfileKey(activeProfile)}
                key={selected.name}
                profile={selected}
              />
            ) : (
              <PanelEmpty description={p.selectPrompt} icon="account" />
            )}
          </PanelBody>
        </>
      )}

      <RenameProfileDialog
        currentName={pendingRename?.name ?? ''}
        isDefault={pendingRename?.is_default ?? false}
        onClose={() => setPendingRename(null)}
        onRenamed={selectAndRefresh}
        open={pendingRename !== null}
      />

      <CreateProfileDialog
        onClose={() => setCreateOpen(false)}
        onCreated={selectAndRefresh}
        open={createOpen}
        profiles={profiles}
      />

      <DeleteProfileDialog
        onClose={() => setPendingDelete(null)}
        onDeleted={async () => {
          setSelectedName(null)
          await refresh()
        }}
        open={pendingDelete !== null}
        profile={pendingDelete}
      />
    </section>
  )
}

function ProfileRow({
  active,
  current,
  menuItems,
  onSelect,
  profile
}: {
  active: boolean
  current: boolean
  menuItems: PanelMenuItem[]
  onSelect: () => void
  profile: ProfileInfo
}) {
  const { t } = useI18n()
  const colors = useStore($profileColors)

  return (
    <PanelListRow
      active={active}
      lead={
        <ProfileGlyph
          aria-hidden="true"
          color={resolveProfileColor(profile.name, colors)}
          isDefault={profile.is_default}
          name={profile.name}
        />
      }
      menuItems={menuItems}
      menuLabel={profileLabel(profile)}
      meta={current ? t.profiles.currentBadge : undefined}
      onSelect={onSelect}
      rowKey={profile.name}
      title={profileLabel(profile)}
    />
  )
}

function ProfileDetail({ current, profile }: { current: boolean; profile: ProfileInfo }) {
  const { t } = useI18n()
  const p = t.profiles
  const navigate = useNavigate()
  const [section, setSection] = useState<'overview' | 'capabilities'>('overview')
  const [capabilitiesVisited, setCapabilitiesVisited] = useState(false)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[0.95rem] font-semibold tracking-tight text-foreground">{profileLabel(profile)}</h3>
            {profile.is_default && <PanelPill tone="good">{p.defaultBadge}</PanelPill>}
            {current && <PanelPill tone="good">{p.currentBadge}</PanelPill>}
            {profile.has_env && <PanelPill tone="muted">.env</PanelPill>}
          </div>
          <p
            className="mt-1 truncate font-mono text-[0.66rem] text-muted-foreground/55"
            title={displayPath(profile.path)}
          >
            {displayPath(profile.path)}
          </p>
        </div>
        <Button disabled={current} onClick={() => selectProfile(profile.name)} size="sm" variant="outline">
          {current ? p.currentBadge : p.switchToProfile(profileLabel(profile))}
        </Button>
      </header>

      <SegmentedControl
        onChange={value => {
          setSection(value)

          if (value === 'capabilities') {
            setCapabilitiesVisited(true)
          }
        }}
        options={[
          { id: 'overview', label: p.overview },
          { id: 'capabilities', label: p.capabilities }
        ]}
        value={section}
      />

      <div className={section === 'overview' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <PanelDetail>
          <PanelMeta
            rows={[
              {
                label: p.modelLabel,
                value: profile.model ? (
                  <span className="font-mono">
                    {profile.model}
                    {profile.provider ? <span className="text-muted-foreground/55"> · {profile.provider}</span> : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground/55">{p.notSet}</span>
                )
              },
              { label: p.skillsLabel, value: profile.skill_count }
            ]}
          />
          <Button
            onClick={() => {
              setSettingsScope(profile.name)
              navigateToWorkspacePage(navigate, `${SETTINGS_ROUTE}?tab=config:model`)
            }}
            size="sm"
            variant="outline"
          >
            {p.configureModel}
          </Button>
          <SoulEditor profileName={profile.name} />
        </PanelDetail>
      </div>
      {capabilitiesVisited && (
        <div className={section === 'capabilities' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}>
          <Suspense fallback={<PageLoader label={p.loading} />}>
            <CapabilitiesView embedded fixedProfile={profile.name} />
          </Suspense>
        </div>
      )}
    </div>
  )
}

function SoulEditor({ profileName }: { profileName: string }) {
  const { t } = useI18n()
  const p = t.profiles
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const requestRef = useRef<string>(profileName)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    requestRef.current = profileName
    setLoading(true)
    setError(null)
    setContent('')
    setOriginal('')

    void (async () => {
      try {
        const soul = await getProfileSoul(profileName)

        if (requestRef.current === profileName) {
          setContent(soul.content)
          setOriginal(soul.content)
        }
      } catch (err) {
        if (requestRef.current === profileName) {
          setError(err instanceof Error ? err.message : p.failedLoadSoul)
        }
      } finally {
        if (requestRef.current === profileName) {
          setLoading(false)
        }
      }
    })()
  }, [p, profileName])

  const dirty = content !== original

  async function handleSave() {
    setSaving(true)
    setError(null)

    try {
      await updateProfileSoul(profileName, content)
      setOriginal(content)
      notify({ kind: 'success', title: p.soulSaved, message: profileName })
    } catch (err) {
      setError(err instanceof Error ? err.message : p.failedSaveSoul)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <PanelSectionLabel className="text-[0.7rem] tracking-[0.14em]">SOUL.md</PanelSectionLabel>
          <p className="text-xs text-muted-foreground">{p.soulDesc}</p>
        </div>
        {dirty && <span className="text-[0.65rem] text-muted-foreground">{p.unsavedChanges}</span>}
      </div>

      {loading ? (
        <PageLoader className="min-h-44" label={p.loadingSoul} />
      ) : (
        <div className="min-h-48">
          <CodeEditor
            filePath="SOUL.md"
            framed
            initialValue={content}
            key={profileName}
            onChange={setContent}
            onSave={() => void handleSave()}
          />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button disabled={!dirty || saving || loading} onClick={() => void handleSave()} size="sm">
          <Save />
          {saving ? p.saving : p.saveSoul}
        </Button>
      </div>
    </section>
  )
}
