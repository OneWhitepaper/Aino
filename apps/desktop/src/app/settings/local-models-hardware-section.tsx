import type { ReactElement } from 'react'

import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Cpu, FolderOpen, Monitor, Package, Zap } from '@/lib/icons'
import type { LocalHardware } from '@/types/hermes'

import { gbLabel } from './local-model-download-progress'
import { SettingsSection } from './primitives'

function storageLabel(bytes: number | null | undefined): string {
  if (bytes == null) {
    return '\u2014'
  }

  return bytes >= 1e12 ? `${(bytes / 1e12).toFixed(2)} TB` : `${(bytes / 1e9).toFixed(1)} GB`
}

export interface LocalModelsHardwareSectionProps {
  hardware: LocalHardware | undefined
}

export function LocalModelsHardwareSection({ hardware }: LocalModelsHardwareSectionProps): ReactElement {
  const { t } = useI18n()
  const copy = t.settings.localModels

  return (
    <SettingsSection icon={Monitor} title={copy.hardwareTitle}>
      {hardware ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 py-1 text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
            {hardware.gpu_name && (
              <span className="inline-flex items-center gap-1.5">
                <Zap className="size-3.5" />
                {hardware.gpu_name}
              </span>
            )}

            {hardware.uma ? (
              <span className="inline-flex items-center gap-1.5">
                <Package className="size-3.5" />
                {gbLabel(hardware.vram_total_bytes)} {copy.unifiedMemory}
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <Cpu className="size-3.5" />
                  {copy.vram(gbLabel(hardware.vram_total_bytes))}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Package className="size-3.5" />
                  {copy.ram(gbLabel(hardware.ram_total_bytes))}
                </span>
              </>
            )}
            {hardware.storage_total_bytes != null && (
              <Tip label={hardware.storage_path}>
                <span className="inline-flex items-center gap-1.5">
                  <FolderOpen className="size-3.5 shrink-0" />
                  {copy.storage(
                    storageLabel(hardware.storage_total_bytes),
                    storageLabel(hardware.storage_available_bytes)
                  )}
                </span>
              </Tip>
            )}
        </div>
      ) : (
        <p className="py-1 text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
          {copy.hardwareLoading}
        </p>
      )}
    </SettingsSection>
  )
}
