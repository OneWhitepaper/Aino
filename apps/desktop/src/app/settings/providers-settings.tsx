import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { useI18n } from '@/i18n'
import { modelSourceCopy } from '@/i18n/model-source'
import { Cpu, Globe, KeyRound, Plug } from '@/lib/icons'
import { $localModelsEnabled } from '@/store/local-models-flag'
import { $settingsRequestProfile } from '@/store/settings-scope'

import { CustomEndpointsSettings } from './custom-endpoints-settings'
import { LocalModelsSettings } from './local-models-settings'
import { SettingsContent, SettingsDisclosure } from './primitives'
import { SettingsProfileScope } from './profile-scope'
import { ServiceAuthorization } from './service-authorization'
import { ThirdPartyModelSettings } from './third-party-model-settings'

export const PROVIDER_VIEWS = ['third-party', 'custom-endpoints', 'local', 'service-authorization', 'accounts'] as const

export type ProviderView = (typeof PROVIDER_VIEWS)[number]

type ProviderSection = Exclude<ProviderView, 'accounts'>

function availableView(view: ProviderView): ProviderSection {
  if (view === 'accounts') {
    return 'service-authorization'
  }

  return view === 'local' && !$localModelsEnabled.get() ? 'custom-endpoints' : view
}

export function ProvidersSettings({ onClose, onConfigSaved, onMainModelChanged, view }: ProvidersSettingsProps) {
  const { t, locale } = useI18n()
  const copy = modelSourceCopy(locale)
  const profile = useStore($settingsRequestProfile)
  const activeView = availableView(view)
  const [expandedSections, setExpandedSections] = useState<Set<ProviderSection>>(() => new Set([activeView]))
  const [mountedSections, setMountedSections] = useState<Set<ProviderSection>>(() => new Set([activeView]))

  useEffect(() => {
    setMountedSections(current => (current.has(activeView) ? current : new Set(current).add(activeView)))
    setExpandedSections(current => (current.has(activeView) ? current : new Set(current).add(activeView)))
    const target = document.getElementById(`provider-section-${activeView}`)
    target?.scrollIntoView?.({ block: 'start' })
  }, [activeView])

  const toggleSection = (section: ProviderSection) => {
    if (expandedSections.has(section)) {
      setExpandedSections(current => {
        const next = new Set(current)
        next.delete(section)

        return next
      })
    } else {
      setMountedSections(current => (current.has(section) ? current : new Set(current).add(section)))
      setExpandedSections(current => new Set(current).add(section))
    }
  }

  return (
    <SettingsContent>
      <SettingsProfileScope className="mb-5" />
      <div>
        <SettingsDisclosure
          expanded={expandedSections.has('third-party')}
          icon={Globe}
          label={copy.providerSource}
          mounted={mountedSections.has('third-party')}
          onToggle={() => toggleSection('third-party')}
          sectionId="provider-section-third-party"
        >
          <ThirdPartyModelSettings embedded onConfigSaved={onConfigSaved} />
        </SettingsDisclosure>
        <SettingsDisclosure
          expanded={expandedSections.has('custom-endpoints')}
          icon={Plug}
          label={copy.customApiTitle}
          mounted={mountedSections.has('custom-endpoints')}
          onToggle={() => toggleSection('custom-endpoints')}
          sectionId="provider-section-custom-endpoints"
        >
          <CustomEndpointsSettings embedded onConfigSaved={onConfigSaved} onMainModelChanged={onMainModelChanged} />
        </SettingsDisclosure>
        <SettingsDisclosure
          expanded={expandedSections.has('service-authorization')}
          icon={KeyRound}
          label={t.desktop.serviceAuthorizationTitle}
          mounted={mountedSections.has('service-authorization')}
          onToggle={() => toggleSection('service-authorization')}
          sectionId="provider-section-service-authorization"
        >
          <p className="mb-3 text-[length:var(--aino-text-label)] text-muted-foreground">
            {t.desktop.serviceAuthorizationDescription}
          </p>
          <ServiceAuthorization onClose={onClose} profile={profile} />
        </SettingsDisclosure>
        {$localModelsEnabled.get() && (
          <SettingsDisclosure
            expanded={expandedSections.has('local')}
            icon={Cpu}
            label={t.settings.nav.providerLocalModels}
            mounted={mountedSections.has('local')}
            onToggle={() => toggleSection('local')}
            sectionId="provider-section-local"
          >
            <LocalModelsSettings embedded visible={expandedSections.has('local')} />
          </SettingsDisclosure>
        )}
      </div>
    </SettingsContent>
  )
}

interface ProvidersSettingsProps {
  onClose?: () => void
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
  view: ProviderView
}
