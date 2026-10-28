import './workspaces.css'

import { useStore } from '@nanostores/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import ainoLogo from '@/assets/aino-account/logo.png'
import { CodeEditor } from '@/components/chat/code-editor'
import { PageLoader } from '@/components/page-loader'
import { ActionsContextMenu } from '@/components/ui/actions-menu'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { RowButton } from '@/components/ui/row-button'
import { SearchField } from '@/components/ui/search-field'
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
import { PanelEmpty, type PanelMenuItem, PanelRowMenu, renderPanelMenuItems } from '../overlays/panel'
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
  // undefined chooses the initial workspace; null is an explicitly closed inspector.
  const [selectedName, setSelectedName] = useState<null | string | undefined>(undefined)
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

    setSelectedName(current => {
      if (current === null || (current && profiles.some(profile => profile.name === current))) {
        return current
      }

      return (
        profiles.find(profile => normalizeProfileKey(profile.name) === normalizeProfileKey(activeProfile))?.name ??
        profiles[0]?.name ??
        null
      )
    })
  }, [activeProfile, loaded, profiles])

  const selected = useMemo(
    () => profiles.find(profile => profile.name === selectedName) ?? null,
    [profiles, selectedName]
  )

  const visibleProfiles = useMemo(() => {
    const q = normalize(query)

    return profiles.filter(
      profile =>
        !q ||
        normalize(profileLabel(profile)).includes(q) ||
        profile.name.toLowerCase().includes(q) ||
        (profile.model ?? '').toLowerCase().includes(q)
    )
  }, [profiles, query])

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
      className="workspace-manager"
      data-aino-page-shell=""
      data-workspaces-page=""
    >
      <header className="workspace-header">
        <div className="min-w-0">
          <div className="workspace-heading">
            <h2>{t.sidebar.nav.profiles}</h2>
            {loaded && <span className="workspace-count">{p.count(profiles.length)}</span>}
          </div>
          <p>{p.workspaceDesc}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Codicon name="add" />
          {p.newProfile}
        </Button>
      </header>
      <div className="workspace-layout" data-inspecting={selected !== null}>
        <div className="workspace-overview-pane">
          {!loaded ? (
            <PageLoader label={p.loading} />
          ) : profiles.length === 0 ? (
            <PanelEmpty description={p.createDesc} icon="organization" title={p.noProfiles} />
          ) : (
            <>
              <div className="workspace-toolbar">
                <h3>{p.workspaceListTitle}</h3>
                <SearchField
                  containerClassName="workspace-search"
                  onChange={setQuery}
                  placeholder={p.search}
                  value={query}
                  variant="box"
                />
              </div>
              <div className="workspace-grid">
                {visibleProfiles.map(profile => (
                  <ProfileRow
                    active={selected?.name === profile.name}
                    current={normalizeProfileKey(profile.name) === normalizeProfileKey(activeProfile)}
                    key={profile.name}
                    menuItems={
                      profile.is_default
                        ? [{ icon: 'edit', label: p.renameMenu, onSelect: () => setPendingRename(profile) }]
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
              </div>
              {visibleProfiles.length === 0 && <PanelEmpty icon="search" title={t.catalog.noResults} />}
              <p className="workspace-preview-hint">
                <Codicon name="info" size="0.875rem" />
                {p.previewHint}
              </p>
            </>
          )}
          <footer className="workspace-footer">
            <p className="workspace-help">
              <Codicon name="layers" size="1rem" />
              <span>{p.workspaceHint}</span>
            </p>
            <WorkspaceControls />
          </footer>
        </div>
        {selected && (
          <ProfileDetail
            current={normalizeProfileKey(selected.name) === normalizeProfileKey(activeProfile)}
            key={selected.name}
            onClose={() => setSelectedName(null)}
            profile={selected}
          />
        )}
      </div>
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
          setSelectedName(undefined)
          await refresh()
        }}
        open={pendingDelete !== null}
        profile={pendingDelete}
      />
    </section>
  )
}

function WorkspaceGlyph({ profile }: { profile: ProfileInfo }) {
  const colors = useStore($profileColors)

  return profile.is_default ? (
    <span aria-hidden="true" className="workspace-brand-glyph">
      <img alt="" src={ainoLogo} />
    </span>
  ) : (
    <ProfileGlyph
      aria-hidden="true"
      color={resolveProfileColor(profile.name, colors)}
      isDefault={false}
      name={profileLabel(profile)}
      size="lg"
    />
  )
}

interface ProfileRowProps {
  active: boolean
  current: boolean
  menuItems: PanelMenuItem[]
  onSelect: () => void
  profile: ProfileInfo
}

function ProfileRow({ active, current, menuItems, onSelect, profile }: ProfileRowProps) {
  const { t } = useI18n()
  const p = t.profiles
  const label = profileLabel(profile)

  return (
    <ActionsContextMenu ariaLabel={label} contentClassName="w-40" items={renderPanelMenuItems(menuItems)}>
      <div className="workspace-card" data-active={active} data-panel-row={profile.name}>
        <RowButton
          aria-current={current ? 'true' : undefined}
          aria-label={label}
          aria-pressed={active}
          className="workspace-card-select"
          onClick={onSelect}
        >
          <span className="workspace-card-top">
            <WorkspaceGlyph profile={profile} />
            {current && (
              <span className="workspace-current-badge">
                <Codicon name="check" size="0.75rem" />
                {p.currentBadge}
              </span>
            )}
          </span>
          <span className="workspace-card-title">
            <span className="truncate">{label}</span>
            {profile.is_default && <span className="workspace-default-badge">{p.defaultBadge}</span>}
          </span>
          <dl className="workspace-card-facts">
            <div className="min-w-0">
              <dt className="sr-only">{p.modelLabel}</dt>
              <dd title={profile.model ?? undefined}>
                <Codicon name="hubot" size="0.8125rem" />
                <span className="truncate">{profile.model ?? p.notSet}</span>
              </dd>
            </div>
            <div className="shrink-0">
              <dt className="sr-only">{p.skillsLabel}</dt>
              <dd>
                <Codicon name="extensions" size="0.8125rem" />
                <span>{p.skills(profile.skill_count)}</span>
              </dd>
            </div>
          </dl>
        </RowButton>
        <div className="workspace-card-menu">
          <PanelRowMenu items={menuItems} label={label} />
        </div>
      </div>
    </ActionsContextMenu>
  )
}

interface ProfileDetailProps {
  current: boolean
  onClose: () => void
  profile: ProfileInfo
}

function ProfileDetail({ current, onClose, profile }: ProfileDetailProps) {
  const { t } = useI18n()
  const p = t.profiles
  const navigate = useNavigate()
  const [section, setSection] = useState<'overview' | 'capabilities'>('overview')
  const [capabilitiesVisited, setCapabilitiesVisited] = useState(false)

  return (
    <aside aria-label={profileLabel(profile)} className="workspace-inspector">
      <header className="workspace-inspector-heading">
        <div className="flex min-w-0 items-center gap-3">
          <WorkspaceGlyph profile={profile} />
          <div className="min-w-0">
            <h3>{profileLabel(profile)}</h3>
            <div className="workspace-inspector-meta">{profile.is_default && <span>{p.defaultBadge}</span>}</div>
          </div>
        </div>
        <Button aria-label={t.common.close} onClick={onClose} size="icon-sm" variant="ghost">
          <Codicon name="close" />
        </Button>
      </header>
      {current ? (
        <p className="workspace-current-status">
          <Codicon name="check" size="0.8125rem" />
          {p.currentBadge}
        </p>
      ) : (
        <Button className="w-full shrink-0" onClick={() => selectProfile(profile.name)} size="sm">
          <Codicon name="arrow-swap" />
          {p.switchToProfile(profileLabel(profile))}
        </Button>
      )}
      <SegmentedControl
        className="w-full shrink-0"
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
        variant="underline"
      />
      <div className={section === 'overview' ? 'workspace-detail-overview' : 'hidden'}>
        <section className="workspace-model">
          <div className="workspace-section-heading">
            <h4>{p.modelLabel}</h4>
            <Button
              onClick={() => {
                setSettingsScope(profile.name)
                navigateToWorkspacePage(navigate, SETTINGS_ROUTE + '?tab=config:model')
              }}
              size="sm"
              variant="outline"
            >
              {p.configureModel}
            </Button>
          </div>
          <div className="workspace-model-value">
            <span className="workspace-model-glyph">
              <Codicon name="hubot" />
            </span>
            <div className="min-w-0">
              <p className="truncate" title={profile.model ?? undefined}>
                {profile.model ?? p.notSet}
              </p>
              {profile.provider && <p className="workspace-provider">{profile.provider}</p>}
            </div>
          </div>
        </section>
        <SoulEditor profileName={profile.name} />
        <details className="workspace-storage">
          <summary className="flex cursor-pointer items-center gap-2">
            <Codicon name="folder" size="0.875rem" />
            {p.storageLocation}
            <Codicon name="chevron-down" size="0.75rem" />
          </summary>
          <p className="mt-2 break-all font-mono text-[0.6875rem]">{displayPath(profile.path)}</p>
          {profile.has_env && <p className="mt-1">.env</p>}
        </details>
      </div>
      {capabilitiesVisited && (
        <div className={section === 'capabilities' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}>
          <Suspense fallback={<PageLoader label={p.loading} />}>
            <CapabilitiesView embedded fixedProfile={profile.name} />
          </Suspense>
        </div>
      )}
    </aside>
  )
}

function SoulEditor({ profileName }: { profileName: string }) {
  const { t } = useI18n()
  const p = t.profiles
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [missing, setMissing] = useState(false)
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
    setMissing(false)

    void (async () => {
      try {
        const soul = await getProfileSoul(profileName)

        if (requestRef.current === profileName) {
          setContent(soul.content)
          setOriginal(soul.content)
          setMissing(soul.exists === false)
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
      setMissing(false)
      notify({ kind: 'success', title: p.soulSaved, message: profileName })
    } catch (err) {
      setError(err instanceof Error ? err.message : p.failedSaveSoul)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="workspace-soul" data-workspace-soul="">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-foreground">{p.soulTitle}</h4>
          <p className="mt-2 text-xs leading-relaxed text-(--ui-text-tertiary)">
            {missing ? p.soulMissing : p.soulDesc}
          </p>
        </div>
        {dirty && <span className="text-[0.65rem] text-muted-foreground">{p.unsavedChanges}</span>}
      </div>

      {loading ? (
        <PageLoader className="min-h-44" label={p.loadingSoul} />
      ) : (
        <div className="workspace-soul-surface">
          <CodeEditor
            className="workspace-soul-editor rounded-(--aino-radius-panel)"
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

      <div className="workspace-editor-footer">
        <span>{p.soulApplyHint}</span>
        <Button disabled={!dirty || saving || loading} onClick={() => void handleSave()} size="sm">
          <Save />
          {saving ? p.saving : p.saveSoul}
        </Button>
      </div>
    </section>
  )
}
