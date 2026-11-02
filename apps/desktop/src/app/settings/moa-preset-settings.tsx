import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { MoaConfigResponse } from '@/hermes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { CONTROL_TEXT } from './constants'
import { ListRow } from './primitives'
import type { useMoaEditing } from './use-moa-editing'

interface MoaPresetSettingsProps {
  applying: boolean
  currentMoaPreset: MoaConfigResponse['presets'][string]
  moa: MoaConfigResponse
  newMoaPresetName: string
  selectedMoaPreset: string
  saveMoa: ReturnType<typeof useMoaEditing>['saveMoa']
  updateMoaPreset: ReturnType<typeof useMoaEditing>['updateMoaPreset']
  setNewMoaPresetName: (value: string) => void
  setSelectedMoaPreset: (value: string) => void
}

export function MoaPresetSettings({
  applying,
  currentMoaPreset,
  moa,
  newMoaPresetName,
  selectedMoaPreset,
  saveMoa,
  updateMoaPreset,
  setNewMoaPresetName,
  setSelectedMoaPreset
}: MoaPresetSettingsProps) {
  const { t } = useI18n()
  const m = t.settings.model

  return (
    <div className="model-settings-moa-preset">
      <ListRow
        action={
          <div className="model-settings-moa-preset-controls">
            <Select onValueChange={setSelectedMoaPreset} value={selectedMoaPreset || moa.default_preset}>
              <SelectTrigger aria-label={m.moaPreset} className={cn('min-w-40', CONTROL_TEXT)}>
                <SelectValue placeholder={m.moaPreset} />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(moa.presets).map(name => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              disabled={applying}
              onClick={() => {
                const next: MoaConfigResponse = {
                  ...moa,
                  default_preset: selectedMoaPreset || moa.default_preset
                }

                void saveMoa(next)
              }}
              size="sm"
              variant="text"
            >
              {m.moaSetDefault}
            </Button>
            <Button
              disabled={Object.keys(moa.presets).length <= 1 || applying}
              onClick={() => {
                if (Object.keys(moa.presets).length <= 1) {
                  return
                }

                const presets = { ...moa.presets }
                delete presets[selectedMoaPreset]
                const fallback = Object.keys(presets)[0]

                const next: MoaConfigResponse = {
                  ...moa,
                  presets,
                  default_preset: moa.default_preset === selectedMoaPreset ? fallback : moa.default_preset,
                  active_preset: moa.active_preset === selectedMoaPreset ? '' : moa.active_preset
                }

                setSelectedMoaPreset(Object.keys(moa.presets).find(name => name !== selectedMoaPreset) || '')
                void saveMoa(next)
              }}
              size="sm"
              variant="ghost"
            >
              {t.common.delete}
            </Button>
          </div>
        }
        title={m.moaPreset}
      />
      <div className="model-settings-moa-preset-new">
        <span className="model-settings-moa-default">
          {m.moaDefault} {moa.default_preset}
        </span>
        <div>
          <Input
            className={cn('min-w-0', CONTROL_TEXT)}
            onChange={event => setNewMoaPresetName(event.target.value)}
            placeholder={m.moaNewPresetPlaceholder}
            value={newMoaPresetName}
          />
          <Button
            disabled={!newMoaPresetName.trim() || !!moa.presets[newMoaPresetName.trim()] || applying}
            onClick={() => {
              const name = newMoaPresetName.trim()

              const next: MoaConfigResponse = {
                ...moa,
                presets: {
                  ...moa.presets,
                  [name]: { ...currentMoaPreset, reference_models: [...currentMoaPreset.reference_models] }
                }
              }

              setSelectedMoaPreset(name)
              setNewMoaPresetName('')
              void saveMoa(next)
            }}
            size="sm"
            variant="outline"
          >
            {m.moaAddPreset}
          </Button>
        </div>
      </div>
      <ListRow
        action={
          <Switch
            aria-label={m.moaEnabled}
            checked={currentMoaPreset.enabled !== false}
            disabled={applying}
            onCheckedChange={checked => updateMoaPreset(prev => ({ ...prev, enabled: checked }))}
            size="xs"
          />
        }
        className="model-settings-moa-enable"
        description={m.pages.moaEnableDescription}
        title={m.moaEnabled}
      />
    </div>
  )
}
