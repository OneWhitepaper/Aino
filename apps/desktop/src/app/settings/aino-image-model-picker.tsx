import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PlatformModelList, usePlatformModels } from '@/components/platform-model-list'
import { getToolsetModels, type ProfileScope, selectToolsetModel } from '@/hermes'
import { useI18n } from '@/i18n'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { $activeConnectionId } from '@/store/connections'
import { $gatewayManagedImageCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { notify, notifyError } from '@/store/notifications'
import { platformModelCatalog, requirePlatformSelection } from '@/store/platform-models'
import { $activeGatewayProfile } from '@/store/profile'

import type { PlatformModel } from '../../../shared/platform-contract'

import { AinoImageQuality, resolveAinoImageQuality } from './aino-image-quality'

interface AinoImageModelPickerProps {
  isActiveBackend: boolean
  profile?: ProfileScope
  providerName: string
  onSelected?: () => void
}

/** The existing image toolset owns persistence; account credentials stay in native main. */
export function AinoImageModelPicker({
  isActiveBackend,
  profile,
  providerName,
  onSelected
}: AinoImageModelPickerProps) {
  const { t } = useI18n()
  const copy = t.settings.toolsets
  useStore($activeGatewayProfile)
  useStore($activeConnectionId)
  const { connectionId, profile: profileName } = platformDefaultScope(profile).route
  const scope = useMemo(() => platformDefaultScope({ connectionId, profile: profileName }), [connectionId, profileName])
  const capabilities = useStore($gatewayManagedImageCapabilities)
  const capability = managedModelRouteCapabilityFrom(capabilities, scope.route)
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [qualityConfigurable, setQualityConfigurable] = useState(false)
  const savingRef = useRef(false)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [quality, setQuality] = useState<string | null>(null)
  const imageCatalog = usePlatformModels('image')
  const selected = imageCatalog.models.find(model => model.id === selectedId)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setQualityConfigurable(false)
    getToolsetModels('image_gen', providerName, scope.route)
      .then(result => {
        if (!cancelled) {
          setSelectedId(isActiveBackend ? (result.current ?? result.default ?? undefined) : undefined)
          setQuality(result.quality ?? null)
          setQualityConfigurable(result.quality_configurable === true)
        }
      })
      .catch(error => {
        if (!cancelled) {
          notifyError(error, copy.failedSelectModel(providerName))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => void (cancelled = true)
  }, [copy, isActiveBackend, providerName, scope])

  async function save(model: PlatformModel, selectedQuality: string | null) {
    if (savingRef.current) {
      return false
    }

    const catalog = platformModelCatalog()
    const account = catalog.account.get()
    requirePlatformSelection(account, catalog.state.get().models, model.id, account?.account?.id || '', 'image')
    savingRef.current = true
    setSaving(true)
    const nextQuality = resolveAinoImageQuality(model, selectedQuality)

    try {
      await selectToolsetModel('image_gen', model.id, providerName, scope.route, {
        activate: true,
        ...(qualityConfigurable ? { quality: nextQuality } : {})
      })

      if (scopeRef.current !== scope) {
        return false
      }

      setSelectedId(model.id)
      setQuality(nextQuality)
      onSelected?.()
      notify({
        kind: 'success',
        ...(model.id === selectedId
          ? {
              title: t.settings.model.imageGeneration.qualitySaved,
              message: t.settings.model.imageGeneration.qualitySavedHint
            }
          : { title: copy.modelSelectedTitle, message: copy.modelSelectedMessage(model.display_name) })
      })

      return true
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-1.5" data-aino-image-models="">
      <span className="text-sm font-medium">{t.settings.model.defaultMain.builtIn}</span>
      <PlatformModelList
        disabled={loading || saving}
        fitContent
        managedCapability={capability}
        onSelect={model => save(model, model.id === selectedId ? quality : null)}
        purpose="image"
        selectedId={selectedId}
      />
      {selected && (
        <AinoImageQuality
          configurable={qualityConfigurable}
          disabled={loading || saving || capability !== 'supported' || selected.state !== 'available'}
          model={selected}
          onChange={value =>
            void save(selected, value).catch(error => notifyError(error, copy.failedSelectModel(providerName)))
          }
          quality={quality}
        />
      )}
    </div>
  )
}
