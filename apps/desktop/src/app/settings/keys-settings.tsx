import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useI18n } from '@/i18n'
import { KeyRound, Wrench } from '@/lib/icons'
import { $settingsRequestProfile } from '@/store/settings-scope'

import { CredentialKeyCard, credentialPlaceholder, credentialRowLabel } from './credential-key-ui'
import { useEnvCredentials } from './env-credentials'
import { asText } from './helpers'
import { SectionHeading, SettingsContent, SettingsDisclosure } from './primitives'
import { SettingsProfileScope } from './profile-scope'
import { useDeepLinkHighlight } from './use-deep-link-highlight'

// Legacy route aliases remain supported; the settings page presents both groups
// together under Advanced.
export const KEYS_VIEWS = ['tools', 'settings'] as const

export type KeysView = (typeof KEYS_VIEWS)[number]
type KeysSettingsView = KeysView | 'all'

// Providers live on their own page; messaging-platform credentials live on the
// dedicated Messaging page (and are hidden here via `channel_managed`). This
// view covers tool API keys plus server/setting env vars (API server, webhook,
// gateway), which are shown together on the Advanced page.

// Backend categories that surface under each section. Platform credentials use the
// `messaging` category but are flagged ``channel_managed`` and configured on
// the Messaging page; only gateway-wide ``messaging`` rows (e.g. GATEWAY_PROXY)
// appear here alongside ``setting``.
const VIEW_CATEGORIES: Record<KeysSettingsView, readonly string[]> = {
  all: ['tool', 'setting', 'messaging'],
  settings: ['setting', 'messaging'],
  tools: ['tool']
}

const credentialElementId = (key: string) => `credential-key-${key}`

export function KeysSettings({ embedded = false, view }: KeysSettingsProps) {
  const { t } = useI18n()
  // Shared settings "Applies to" scope: fetch + edit the selected profile's
  // env store instead of the active one (undefined → active, the default
  // path — request-shaped so the API helpers never see a primary-targeting
  // null).
  const scopeProfile = useStore($settingsRequestProfile)
  const { rowProps, vars } = useEnvCredentials(scopeProfile)
  const [openKey, setOpenKey] = useState<null | string>(null)
  const [openSections, setOpenSections] = useState<Record<KeysView, boolean>>({ settings: false, tools: false })

  useEffect(() => {
    setOpenKey(null)
  }, [scopeProfile, view])

  const entries = useMemo(() => {
    if (!vars) {
      return []
    }

    const cats = VIEW_CATEGORIES[view]

    return Object.entries(vars)
      .filter(([, info]) => !info.channel_managed && cats.includes(asText(info.category)))
      .sort(([a], [b]) => a.localeCompare(b))
  }, [vars, view])

  const renderableKeys = useMemo(() => new Set(entries.map(([key]) => key)), [entries])

  const resolveDeepLink = useCallback(
    (key: string) => {
      setOpenKey(key)
      const section: KeysView = asText(vars?.[key]?.category) === 'tool' ? 'tools' : 'settings'
      setOpenSections(current => ({ ...current, [section]: true }))
    },
    [vars]
  )

  const deepLinkReady = useCallback((key: string) => renderableKeys.has(key), [renderableKeys])

  const sections: readonly KeysView[] = view === 'all' ? KEYS_VIEWS : [view]

  // Deep link from ⌘K / Capabilities env-var rows (?tab=keys&key=<ENV_KEY>):
  // scroll the credential card into view, flash it, and expand its section.
  // Only consume keys rendered by this page so a stale route cannot target a
  // row that is absent from the selected profile.
  useDeepLinkHighlight({
    elementId: credentialElementId,
    onResolve: resolveDeepLink,
    param: 'key',
    ready: deepLinkReady
  })

  const renderCredentialEntries = (sectionEntries: typeof entries) =>
    sectionEntries.length > 0 ? (
      <div className="grid gap-2">
        {sectionEntries.map(([key, info]) => {
          const label = credentialRowLabel(key, info)

          return (
            <div className="scroll-mt-6 rounded-(--aino-radius-control)" id={credentialElementId(key)} key={key}>
              <CredentialKeyCard
                expanded={openKey === key}
                info={info}
                label={label}
                onExpand={() => setOpenKey(key)}
                onToggle={() => setOpenKey(prev => (prev === key ? null : key))}
                placeholder={credentialPlaceholder(key, info, label)}
                rowProps={rowProps}
                varKey={key}
              />
            </div>
          )
        })}
      </div>
    ) : vars ? (
      <div className="py-3 text-center text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
        {t.settings.keys.empty}
      </div>
    ) : (
      <div
        aria-busy="true"
        aria-label={t.common.loading}
        className="py-3 text-[length:var(--conversation-caption-font-size)] text-muted-foreground"
        role="status"
      >
        {t.common.loading}
      </div>
    )

  const content = (
    <>
      {embedded && <SectionHeading icon={KeyRound} title={t.settings.nav.apiKeys} />}
      {!embedded && <SettingsProfileScope className="mb-5" />}
      {sections.map(section => {
        const categories = VIEW_CATEGORIES[section]
        const sectionEntries = entries.filter(([, info]) => categories.includes(asText(info.category)))
        const SectionIcon = section === 'tools' ? Wrench : KeyRound
        const sectionLabel = section === 'tools' ? t.settings.nav.keysTools : t.settings.nav.keysCredentials
        const expanded = openSections[section]

        const sectionContent = (
          <>
            {section === 'tools' && (
              <p className="mb-4 max-w-3xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                {t.settings.credentials.toolPageIntro}
              </p>
            )}
            {renderCredentialEntries(sectionEntries)}
          </>
        )

        if (!embedded) {
          return <section key={section}>{sectionContent}</section>
        }

        return (
          <SettingsDisclosure
            expanded={expanded}
            icon={SectionIcon}
            key={section}
            label={sectionLabel}
            onToggle={() => setOpenSections(current => ({ ...current, [section]: !current[section] }))}
          >
            {sectionContent}
          </SettingsDisclosure>
        )
      })}
    </>
  )

  return embedded ? <div className="mt-8">{content}</div> : <SettingsContent>{content}</SettingsContent>
}

interface KeysSettingsProps {
  embedded?: boolean
  view: KeysSettingsView
}
