import type { ModelOptionProvider } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { $apiRequestScope } from '@/api/client'
import { getEnvVars, getGlobalModelOptions } from '@/hermes'
import type { EnvVarInfo } from '@/types/hermes'

interface SettingsModelCatalog {
  providers: ModelOptionProvider[]
  envVars: Record<string, EnvVarInfo>
  main: MainModelAssignment | null
  mainRevision: number
}

interface MainModelAssignment {
  provider: string
  model: string
}

/** A settings observer on the existing catalog cache; configuration dialogs already invalidate this root. */
export function useSettingsModelCatalog(profile?: string) {
  const ambient = useStore($apiRequestScope)

  const owner = useMemo(
    () => ({
      ...(ambient.connectionId ? { connectionId: ambient.connectionId } : {}),
      profile: profile ?? ambient.profile
    }),
    [ambient.connectionId, ambient.profile, profile]
  )

  const key = useMemo(
    () => ['model-options', owner.profile, 'settings', 'owner', owner.connectionId ?? 'ambient'] as const,
    [owner]
  )

  const client = useQueryClient()

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<SettingsModelCatalog> => {
      const revision = client.getQueryData<SettingsModelCatalog>(key)?.mainRevision ?? 0

      const [models, credentials] = await Promise.allSettled([
        getGlobalModelOptions({ includeUnconfigured: true }, owner),
        Promise.resolve().then(() => getEnvVars(owner))
      ])

      if (models.status === 'rejected') {
        throw models.reason
      }

      const current = client.getQueryData<SettingsModelCatalog>(key)

      const main =
        typeof models.value.provider === 'string' && typeof models.value.model === 'string'
          ? { provider: models.value.provider, model: models.value.model }
          : null

      return {
        providers: models.value.providers || [],
        envVars: credentials.status === 'fulfilled' ? credentials.value : {},
        // A model applied after this read started owns the summary. The revision lives in
        // this same owner-scoped query so remounts and concurrent observers share the fence.
        main:
          current?.mainRevision !== undefined && current.mainRevision !== revision
            ? current.main
            : (main ?? current?.main ?? null),
        mainRevision: current?.mainRevision ?? revision
      }
    },
    staleTime: 60_000
  })

  const refetchQuery = query.refetch

  const refresh = useCallback(async () => {
    const result = await refetchQuery({ cancelRefetch: false })

    if (result.error) {
      throw result.error
    }

    return result.data
  }, [refetchQuery])

  const replaceProviders = useCallback(
    (providers: ModelOptionProvider[]) => {
      client.setQueryData<SettingsModelCatalog>(key, previous => ({
        providers,
        envVars: previous?.envVars ?? {},
        main: previous?.main ?? null,
        mainRevision: previous?.mainRevision ?? 0
      }))
    },
    [client, key]
  )

  const replaceMain = useCallback(
    (main: MainModelAssignment, expectedRevision?: number) => {
      client.setQueryData<SettingsModelCatalog>(key, previous => {
        const revision = previous?.mainRevision ?? 0

        if (expectedRevision !== undefined && expectedRevision !== revision) {
          return previous
        }

        return {
          providers: previous?.providers ?? [],
          envVars: previous?.envVars ?? {},
          main,
          mainRevision: revision + 1
        }
      })
    },
    [client, key]
  )

  const readMainRevision = useCallback(
    () => client.getQueryData<SettingsModelCatalog>(key)?.mainRevision ?? 0,
    [client, key]
  )

  return {
    providers: query.data?.providers ?? [],
    envVars: query.data?.envVars ?? {},
    main: query.data?.main ?? null,
    owner,
    key: key.join(':'),
    refresh,
    replaceProviders,
    replaceMain,
    readMainRevision
  }
}
