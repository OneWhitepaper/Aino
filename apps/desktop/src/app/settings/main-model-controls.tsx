import type { ModelOptionProvider } from '@hermes/shared'
import { REASONING_EFFORT_VALUES } from '@hermes/shared'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { modelSourceCopy } from '@/i18n/model-source'
import type { ModelSettingsTranslations } from '@/i18n/types_model_settings'
import { KeyRound, SlidersHorizontal } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { CONTROL_TEXT } from './constants'
import { customModelConfigCopy } from './custom-model-config-copy'
import { MainModelConnectionEditor, MainModelSetupEmpty } from './main-model-connection-editor'
import { ModelSelect } from './model-select'
import { ListRow, SectionHeading } from './primitives'

export type SpeedTier = 'fast' | 'normal' | 'ultrafast'

export function MainModelDefaults({
  effortValue,
  fastOn,
  fastSupported,
  onChange,
  reasoningSupported,
  speedValue,
  ultrafastSupported
}: {
  effortValue: string
  fastOn: boolean
  fastSupported: boolean
  onChange: (key: string, value: boolean | string) => Promise<void>
  reasoningSupported: boolean
  speedValue: SpeedTier
  ultrafastSupported: boolean
}) {
  const { t } = useI18n()
  const m = t.settings.model

  return (
    <div className="default-main-model-parameters">
      <SectionHeading icon={SlidersHorizontal} title={m.defaultMain.defaultsTitle} />
      <p className="mb-3 text-xs text-muted-foreground">{m.defaultMain.defaultsDescription}</p>
      {reasoningSupported && (
        <ListRow
          action={
            <div aria-label={m.reasoning} role="group">
              <SegmentedControl
                onChange={value => void onChange('agent.reasoning_effort', value)}
                options={REASONING_EFFORT_VALUES.map(value => ({
                  id: value,
                  label: value === 'none' ? m.reasoningOff : t.shell.modelOptions[value]
                }))}
                value={effortValue}
              />
            </div>
          }
          description={m.defaultMain.reasoningDescription}
          title={m.reasoning}
        />
      )}
      {ultrafastSupported ? (
        <ListRow
          action={
            <div aria-label={m.speed} role="group">
              <SegmentedControl
                onChange={value => void onChange('agent.service_tier', value)}
                options={[
                  { id: 'normal', label: m.speedStandard },
                  ...(fastSupported ? [{ id: 'fast', label: t.shell.modelOptions.fast }] : []),
                  { id: 'ultrafast', label: t.shell.modelOptions.ultrafast }
                ]}
                value={speedValue}
              />
            </div>
          }
          description={m.defaultMain.speedDescription}
          title={m.speed}
        />
      ) : (
        fastSupported && (
          <ListRow
            action={
              <Switch
                aria-label={t.shell.modelOptions.fast}
                checked={fastOn}
                onCheckedChange={checked => void onChange('agent.service_tier', checked ? 'fast' : 'normal')}
                size="xs"
              />
            }
            description={m.defaultMain.speedDescription}
            title={t.shell.modelOptions.fast}
          />
        )
      )}
    </div>
  )
}

export function MainModelPicker({
  activateApiKeyProvider,
  activating,
  apiKeyDraft,
  m,
  mainProviderOptions,
  needsSetup,
  selectedModel,
  selectedProvider,
  selectedProviderModels,
  selectedProviderRow,
  setApiKeyDraft,
  setSelectedModel,
  setupIsApiKey,
  startProviderSetup,
  switchProvider,
  source
}: {
  activateApiKeyProvider: () => Promise<boolean>
  activating: boolean
  apiKeyDraft: string
  m: ModelSettingsTranslations
  mainProviderOptions: readonly ModelOptionProvider[]
  needsSetup: boolean
  selectedModel: string
  selectedProvider: string
  selectedProviderModels: string[]
  selectedProviderRow: ModelOptionProvider | undefined
  setApiKeyDraft: (value: string) => void
  setSelectedModel: (value: string) => void
  setupIsApiKey: boolean
  startProviderSetup: () => void
  switchProvider: (value: string) => void
  source: 'provider' | 'custom'
}) {
  const { locale } = useI18n()
  const copy = modelSourceCopy(locale)
  const customCopy = customModelConfigCopy(locale)
  const providerLabel = source === 'custom' ? customCopy.connectionLabel : m.provider
  const [editingConnection, setEditingConnection] = useState(false)

  const canEditApiKey =
    source === 'provider' && selectedProviderRow?.auth_type === 'api_key' && !!selectedProviderRow.key_env

  const showKeyEditor = canEditApiKey && (setupIsApiKey || editingConnection)

  useEffect(() => {
    setEditingConnection(false)
  }, [selectedProvider, source])

  const saveKey = async () => {
    if (await activateApiKeyProvider()) {
      setEditingConnection(false)
    }
  }

  if (!mainProviderOptions.some(provider => provider.slug)) {
    return <MainModelSetupEmpty onSetup={startProviderSetup} source={source} />
  }

  return (
    <div className="default-main-model-custom">
      <ListRow
        action={
          <div className="flex w-full min-w-0 items-center gap-2">
            <Select onValueChange={switchProvider} value={selectedProviderRow?.slug ?? selectedProvider}>
              <SelectTrigger
                aria-label={providerLabel}
                className={cn('w-full min-w-0 max-w-full flex-1 [&_[data-slot=select-value]]:truncate', CONTROL_TEXT)}
              >
                <SelectValue placeholder={providerLabel} />
              </SelectTrigger>
              <SelectContent>
                {mainProviderOptions.map(provider => (
                  <SelectItem key={provider.slug || 'none'} value={provider.slug || 'none'}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(selectedProvider || source === 'custom') && (
              <Button
                aria-expanded={canEditApiKey ? showKeyEditor : undefined}
                onClick={() => (canEditApiKey ? setEditingConnection(value => !value) : startProviderSetup())}
                size="sm"
                variant="outline"
              >
                <KeyRound />
                {source === 'custom' ? copy.configureCustom : copy.configureProvider}
              </Button>
            )}
          </div>
        }
        title={providerLabel}
      />
      {showKeyEditor && (
        <MainModelConnectionEditor
          activating={activating}
          apiKeyDraft={apiKeyDraft}
          keyEnv={selectedProviderRow?.key_env}
          m={m}
          needsSetup={needsSetup}
          onCancel={() => setEditingConnection(false)}
          onKeyChange={setApiKeyDraft}
          onSave={saveKey}
        />
      )}
      {(!needsSetup || !setupIsApiKey) && (
        <ListRow
          action={
            needsSetup ? (
              <span className="text-[length:var(--aino-text-caption)] leading-relaxed text-muted-foreground">
                {source === 'custom' ? copy.customEmpty : copy.noModels}
              </span>
            ) : (
              <ModelSelect
                aria-label={m.model}
                className="w-full min-w-0 max-w-full [&_[data-slot=select-value]]:truncate"
                models={selectedProviderModels}
                onValueChange={setSelectedModel}
                provider={selectedProviderRow}
                providerSlug={selectedProvider}
                value={selectedModel}
              />
            )
          }
          title={m.model}
        />
      )}
      {!needsSetup && selectedProvider && !editingConnection && (
        <p className="default-main-model-connection" data-connected="">
          {m.defaultMain.connectionSaved}
        </p>
      )}
    </div>
  )
}
