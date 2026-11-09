import { useStore } from '@nanostores/react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { getHermesConfigDefaults, getHermesConfigRecord, saveHermesConfig } from '@/hermes'
import { useI18n } from '@/i18n'
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from '@/lib/escape-layers'
import { triggerHaptic } from '@/lib/haptics'
import { Archive, Bell, Globe, Info, Keyboard, UserCircle, Zap } from '@/lib/icons'
import { isEditableTarget } from '@/lib/keybinds/combo'
import { typeToFocusChar } from '@/lib/keybinds/composer-focus-keys'
import { $commandPaletteOpen, openCommandPalettePage } from '@/store/command-palette'
import { confirm } from '@/store/confirm'
import { $activeConnectionId } from '@/store/connections'
import { notifyError } from '@/store/notifications'
import { $settingsScopeProfile } from '@/store/settings-scope'

import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import type { OverlayNavGroup } from '../overlays/overlay-split-layout'

import { AboutSettings } from './about-settings'
import { AccountSettings } from './account-settings'
import { AppearanceSettings } from './appearance-settings'
import { ConfigSettings } from './config-settings'
import { SECTIONS } from './constants'
import { GatewaySettings } from './gateway-settings'
import { KeybindSettings } from './keybind-settings'
import { KeysSettings } from './keys-settings'
import { movedSettingsTabRedirect } from './moved-tabs'
import { NotificationsSettings } from './notifications-settings'
import {
  PAGE_SCOPED_PARAMS,
  PLUGINS_NAV_ICON,
  pluginSettingsNavChildren,
  PluginSettingsPane,
  usePluginSettingsRoute
} from './plugin-settings'
import { PROVIDER_VIEWS, ProvidersSettings, type ProviderView } from './providers-settings'
import { SessionsSettings } from './sessions-settings'
import { SettingsShell } from './settings-shell'
import { SettingsSystemControls } from './system-status-controls'
import type { SettingsPageProps, SettingsView as SettingsViewId } from './types'
import { vaultOwnerKey, VaultSettings } from './vault-settings'
import { SettingsVersionControl } from './version-control'
import { useWebAccessAvailable, WebAccessSettings } from './web-access-settings'

const SETTINGS_VIEWS: readonly SettingsViewId[] = [
  ...SECTIONS.map(s => `config:${s.id}` as SettingsViewId),
  'account',
  'providers',
  'gateway',
  'web-access',
  // Legacy alias: the Connections page merged into Gateways. Kept in the enum
  // so saved `?tab=connections` deep links still resolve (redirected below).
  'connections',
  'keybinds',
  'keys',
  'vault',
  'notifications',
  'sessions',
  'plugins',
  'about'
]

export function SettingsView({
  onClose,
  onConfigSaved,
  onMainModelChanged,
  onOpenCommandCenter,
  onOpenCommandCenterSection,
  requestGateway
}: SettingsPageProps) {
  const scopeProfile = useStore($settingsScopeProfile)
  const activeConnectionId = useStore($activeConnectionId)
  const { t } = useI18n()
  const navigate = useNavigate()
  const { hash, pathname, search } = useLocation()

  // Settings is a page surface rather than an OverlayView, so own the Escape
  // layer here. Nested dialogs still claim the higher-priority layer first.
  useEffect(() => {
    const releaseLayer = pushEscapeLayer(ESCAPE_PRIORITY.overlay)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.overlay)) {
        return
      }

      event.preventDefault()
      triggerHaptic('close')
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      releaseLayer()
    }
  }, [onClose])

  // MCP and Plugins moved out of Settings into Capabilities. Keep old
  // `/settings?tab=mcp|plugins` deep links working — `useRouteEnumParam` would
  // silently coerce the unknown tab to the default view otherwise.
  useEffect(() => {
    const redirect = movedSettingsTabRedirect(search)

    if (redirect) {
      navigate(redirect, { replace: true })
    }
  }, [navigate, search])

  const [routeActiveView] = useRouteEnumParam('tab', SETTINGS_VIEWS, 'account' as SettingsViewId)

  const activeView =
    routeActiveView === 'keys'
      ? ('config:advanced' as SettingsViewId)
      : routeActiveView === 'vault'
        ? ('config:safety' as SettingsViewId)
        : routeActiveView

  const vaultDefaultExpanded =
    routeActiveView === 'vault' ||
    new URLSearchParams(search).get('vault') === 'open' ||
    ['kind', 'label', 'origin'].some(param => new URLSearchParams(search).has(param))

  const plugins = usePluginSettingsRoute(activeView === 'plugins')

  const setActiveView = useCallback(
    (view: SettingsViewId) => {
      const next = new URLSearchParams(search)

      for (const key of [
        ...PAGE_SCOPED_PARAMS,
        'page',
        'field',
        'setting',
        'key',
        'aux',
        'session',
        'kind',
        'label',
        'origin',
        'pview',
        'kview',
        'bview',
        'vault'
      ]) {
        next.delete(key)
      }

      next.set('tab', view)
      navigate({ hash, pathname, search: `?${next}` }, { replace: true })
    },
    [hash, navigate, pathname, search]
  )

  // Connections merged into the unified Gateways page: land old
  // `?tab=connections` routes/bookmarks there instead of a dead entry.
  useEffect(() => {
    if (activeView === 'connections') {
      setActiveView('gateway')
    }
  }, [activeView, setActiveView])
  // Local runtimes and custom endpoints remain separately addressable within
  // Model Services; retired account/key routes are redirected above.
  const [providerView] = useRouteEnumParam<ProviderView>('pview', PROVIDER_VIEWS, 'custom-endpoints')

  // Jump to a section + its sub-view in one navigate. Two sequential setters
  // would each read the same stale `search` and the second would clobber the
  // first's `tab` — so the sub-view never opened on narrow screens.
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const fallbackImportInputRef = useRef<HTMLInputElement | null>(null)
  const [pendingImport, setPendingImport] = useState<{ file: File; owner: string } | null>(null)
  const importOwner = JSON.stringify([activeConnectionId, scopeProfile])
  const importPickerOwnerRef = useRef(importOwner)

  useEffect(() => {
    if (pendingImport && (pendingImport.owner !== importOwner || activeView !== 'config:advanced')) {
      setPendingImport(null)
    }
  }, [activeView, importOwner, pendingImport])

  const openImport = () => {
    triggerHaptic('open')
    setPendingImport(null)
    const input = importInputRef.current

    if (input && !input.disabled) {
      input.click()

      return
    }

    importPickerOwnerRef.current = importOwner
    fallbackImportInputRef.current?.click()
  }

  const exportConfig = async () => {
    try {
      const cfg = await getHermesConfigRecord()
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'hermes-config.json'
      a.click()
      URL.revokeObjectURL(url)
      triggerHaptic('success')
    } catch (err) {
      notifyError(err, t.settings.exportFailed)
    }
  }

  const resetConfig = async () => {
    const ok = await confirm({
      confirmLabel: t.settings.resetToDefaults,
      destructive: true,
      title: t.settings.resetConfirm
    })

    if (!ok) {
      return
    }

    try {
      await saveHermesConfig(await getHermesConfigDefaults())
      triggerHaptic('success')
      onConfigSaved?.()
    } catch (err) {
      notifyError(err, t.settings.resetFailed)
    }
  }

  const webAccessAvailable = useWebAccessAvailable()

  // Where the nav hides Web Access, its deep link lands on Gateways, like the Connections alias.
  useEffect(() => {
    if (activeView === 'web-access' && !webAccessAvailable) {
      setActiveView('gateway')
    }
  }, [activeView, setActiveView, webAccessAvailable])

  const navGroups: OverlayNavGroup[] = useMemo(
    () =>
      [
        {
          active: activeView === 'account',
          icon: UserCircle,
          id: 'account',
          label: t.settings.nav.account,
          onSelect: () => setActiveView('account')
        },
        ...SECTIONS.flatMap(s => {
          const view = `config:${s.id}` as SettingsViewId

          const entry = {
            active: activeView === view,
            icon: s.icon,
            id: view,
            label: t.settings.sections[s.id] ?? s.label,
            onSelect: () => setActiveView(view)
          }

          return [entry]
        }),
        {
          active: activeView === 'notifications',
          icon: Bell,
          id: 'notifications',
          label: t.settings.nav.notifications,
          onSelect: () => setActiveView('notifications')
        },
        {
          active: activeView === 'providers',
          gapBefore: true,
          icon: Zap,
          id: 'providers',
          label: t.settings.nav.providers,
          onSelect: () => setActiveView('providers')
        },
        {
          active: activeView === 'gateway',
          icon: Globe,
          id: 'gateway',
          label: t.settings.nav.gateway,
          onSelect: () => setActiveView('gateway')
        },
        ...(webAccessAvailable
          ? [
              {
                active: activeView === 'web-access',
                icon: Globe,
                id: 'web-access',
                label: t.settings.gateway.webAccess.title,
                onSelect: () => setActiveView('web-access')
              }
            ]
          : []),
        {
          active: activeView === 'keybinds',
          icon: Keyboard,
          id: 'keybinds',
          label: t.settings.nav.keybinds,
          onSelect: () => setActiveView('keybinds')
        },
        {
          active: activeView === 'sessions',
          icon: Archive,
          id: 'sessions',
          label: t.settings.nav.archivedChats,
          onSelect: () => setActiveView('sessions')
        },
        {
          active: activeView === 'plugins',
          children: pluginSettingsNavChildren(plugins.entries, plugins.target, plugins.open),
          icon: PLUGINS_NAV_ICON,
          id: 'plugins',
          label: t.settings.nav.plugins,
          onSelect: () => plugins.open(null)
        },
        {
          active: activeView === 'about',
          gapBefore: true,
          icon: Info,
          id: 'about',
          label: t.settings.nav.about,
          onSelect: () => setActiveView('about')
        }
      ] as OverlayNavGroup[],
    [activeView, plugins, t, setActiveView, webAccessAvailable]
  )

  // Type-to-search: printable keystrokes on the Settings surface (outside any
  // field) open the settings-scoped palette, seeded with the character — same
  // reflex as the chat surface's type-to-focus, pointed at search instead.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ($commandPaletteOpen.get() || isEditableTarget(event.target)) {
        return
      }

      const char = typeToFocusChar(event)

      if (char === null || char === ' ') {
        return
      }

      event.preventDefault()
      openCommandPalettePage('settings', char)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const toolbar = (
    <>
      <SettingsSystemControls
        onOpenCommandCenter={onOpenCommandCenter}
        onOpenCommandCenterSection={onOpenCommandCenterSection}
        requestGateway={requestGateway}
      />
      <SettingsVersionControl
        onExport={() => void exportConfig()}
        onImport={openImport}
        onOpenAbout={() => setActiveView('about')}
        onReset={() => void resetConfig()}
      />
    </>
  )

  const activeSettingsContent =
    activeView === 'plugins' ? (
      <PluginSettingsPane
        entries={plugins.entries}
        missing={plugins.missing}
        onOpen={plugins.open}
        pending={plugins.pending}
        target={plugins.target}
      />
    ) : activeView === 'account' ? (
      <AccountSettings />
    ) : activeView === 'config:appearance' ? (
      <AppearanceSettings />
    ) : activeView === 'about' ? (
      <AboutSettings />
    ) : activeView === 'gateway' || activeView === 'connections' ? (
      // 'connections' renders the unified page too so the frame before
      // the alias redirect lands doesn't flash the fallback view.
      <GatewaySettings />
    ) : activeView === 'web-access' ? (
      <WebAccessSettings />
    ) : activeView === 'keybinds' ? (
      <KeybindSettings />
    ) : activeView.startsWith('config:') ? (
      <ConfigSettings
        activeSectionId={activeView.slice('config:'.length)}
        afterContent={
          activeView === 'config:advanced' ? (
            <KeysSettings embedded view="all" />
          ) : activeView === 'config:safety' ? (
            <VaultSettings
              defaultExpanded={vaultDefaultExpanded}
              embedded
              key={vaultOwnerKey(activeConnectionId, scopeProfile)}
            />
          ) : undefined
        }
        importFile={
          activeView === 'config:advanced' && pendingImport?.owner === importOwner ? pendingImport.file : undefined
        }
        importInputRef={importInputRef}
        onConfigSaved={onConfigSaved}
        onImportConsumed={file => {
          setPendingImport(previous => (previous?.file === file ? null : previous))
        }}
        onMainModelChanged={onMainModelChanged}
      />
    ) : activeView === 'providers' ? (
      <ProvidersSettings
        key={scopeProfile}
        onClose={onClose}
        onConfigSaved={onConfigSaved}
        onMainModelChanged={onMainModelChanged}
        view={providerView}
      />
    ) : activeView === 'notifications' ? (
      <NotificationsSettings />
    ) : (
      <SessionsSettings />
    )

  return (
    <SettingsShell groups={navGroups} onClose={onClose} toolbar={toolbar}>
      {activeSettingsContent}
      <input
        accept=".json,application/json"
        aria-label={t.settings.importConfig}
        className="hidden"
        data-settings-import-picker=""
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''

          if (file && importPickerOwnerRef.current === importOwner) {
            // The file and destination must commit together so the previous
            // page cannot cancel the import before Advanced mounts.
            startTransition(() => {
              setPendingImport({ file, owner: importOwner })
              setActiveView('config:advanced')
            })
          }
        }}
        ref={fallbackImportInputRef}
        type="file"
      />
    </SettingsShell>
  )
}

export { SettingsView as SettingsPage }
