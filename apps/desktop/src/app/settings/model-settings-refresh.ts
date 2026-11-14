import { useCallback, useState } from 'react'

import { getAuxiliaryModels, getGlobalModelInfo, getMoaModels } from '@/hermes'
import type { AuxiliaryModelsResponse, MoaConfigResponse } from '@/hermes'

/** Fast config results belong to one settings owner, never the previously visible profile. */
export function useSettingsAuxiliaryData(ownerKey: string, main: { provider: string; model: string } | null) {
  const [records, setRecords] = useState<Record<string, AuxiliaryModelsResponse>>({})
  const auxiliary = records[ownerKey]
  const setAuxiliary = useCallback((value: AuxiliaryModelsResponse) => setRecords({ [ownerKey]: value }), [ownerKey])

  return { auxiliary, setAuxiliary, mainModel: main ?? auxiliary?.main ?? null }
}

interface ModelSettingsRefresh {
  profile?: string
  isCurrent(): boolean
  canReplaceMain(): boolean
  readMainRevision(): number
  replaceMain(value: { provider: string; model: string }, revision: number): void
  refreshCatalog(): Promise<unknown>
  onReady(): void
  onAuxiliary(value: AuxiliaryModelsResponse): void
  onMoa(value: MoaConfigResponse): void
  onFailure(error: unknown): void
}

/** Config reads publish independently; live context probing must never gate settings readiness. */
export async function refreshModelSettingsData(options: ModelSettingsRefresh): Promise<void> {
  let revision = options.readMainRevision()

  const replaceMain = (value: { provider: string; model: string }) => {
    if (options.isCurrent() && options.canReplaceMain() && options.readMainRevision() === revision) {
      options.replaceMain(value, revision)
      revision = options.readMainRevision()
    }
  }

  const failed = (error: unknown) => {
    if (options.isCurrent()) {
      options.onFailure(error)
    }
  }

  // This endpoint resolves context capabilities against the provider. Its result enriches
  // the configured assignment, but the fast config-only reads below own page readiness.
  void getGlobalModelInfo(options.profile)
    .then(info => {
      if (options.isCurrent()) {
        replaceMain(info)
        options.onReady()
      }
    })
    .catch(failed)

  await Promise.allSettled([
    options
      .refreshCatalog()
      .then(() => {
        if (options.isCurrent()) {
          options.onReady()
        }
      })
      .catch(failed),
    getAuxiliaryModels(options.profile)
      .then(auxiliary => {
        if (!options.isCurrent()) {
          return
        }
        options.onAuxiliary(auxiliary)
        options.onReady()
      })
      .catch(failed),
    getMoaModels(options.profile).then(moa => {
      if (options.isCurrent() && moa) {
        options.onMoa(moa)
      }
    })
  ])
}
