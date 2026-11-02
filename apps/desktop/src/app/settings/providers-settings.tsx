import { useEffect, useState } from 'react'

import { useI18n } from '@/i18n'
import { modelSourceCopy } from '@/i18n/model-source'
import { Cpu, Globe, Plug } from '@/lib/icons'
import { $localModelsEnabled } from '@/store/local-models-flag'

import { CustomEndpointsSettings } from './custom-endpoints-settings'
import { LocalModelsSettings } from './local-models-settings'
import { SettingsContent, SettingsDisclosure } from './primitives'
import { SettingsProfileScope } from './profile-scope'
import { ThirdPartyModelSettings } from './third-party-model-settings'

export const PROVIDER_VIEWS = ['third-party', 'custom-endpoints', 'local'] as const

export type ProviderView = (typeof PROVIDER_VIEWS)[number]

type ProviderSection = ProviderView

function availableView(view: ProviderView): ProviderSection {
  return view === 'local' && !$localModelsEnabled.get() ? 'custom-endpoints' : view
}

export function ProvidersSettings({ onConfigSaved, onMainModelChanged, view }: ProvidersSettingsProps) {
  const { t, locale } = useI18n()
  const copy = modelSourceCopy(locale)
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
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
  view: ProviderView
}
