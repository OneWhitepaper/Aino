import type { ModelOptionProvider } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { replaceEqualDeep, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { $apiRequestScope } from '@/api/client'
import { getEnvVars, getGlobalModelOptions } from '@/hermes'

interface SettingsModelCatalog {
  providers: ModelOptionProvider[]
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

      const models = await getGlobalModelOptions({ includeUnconfigured: true }, owner)

      const current = client.getQueryData<SettingsModelCatalog>(key)

      const main =
        typeof models.provider === 'string' && typeof models.model === 'string'
          ? { provider: models.provider, model: models.model }
          : null

      return {
        providers: models.providers || [],
        // A model applied after this read started owns the summary. The revision lives in
        // this same owner-scoped query so remounts and concurrent observers share the fence.
        main:
          current?.mainRevision !== undefined && current.mainRevision !== revision
            ? current.main
            : (main ?? current?.main ?? null),
        mainRevision: current?.mainRevision ?? revision
      }
    },
    staleTime: 60_000,
    structuralSharing: (previous: unknown, next: unknown) => {
      const before = previous as SettingsModelCatalog | undefined
      const incoming = next as SettingsModelCatalog

      // A config-only read can publish between queryFn's return and the cache commit.
      return replaceEqualDeep(previous, before && before.mainRevision > incoming.mainRevision
        ? { ...incoming, main: before.main, mainRevision: before.mainRevision }
        : incoming)
    }
  })

  // Credential hints enrich the provider picker; they never own the saved model's readiness.
  const credentials = useQuery({
    queryKey: [...key, 'credentials'],
    queryFn: () => getEnvVars(owner),
    staleTime: 60_000
  })

  const refetchQuery = query.refetch
  const refetchCredentials = credentials.refetch

  const refresh = useCallback(async () => {
    void refetchCredentials({ cancelRefetch: false })
    const result = await refetchQuery({ cancelRefetch: false })

    if (result.error) {
      throw result.error
    }

    return result.data
  }, [refetchCredentials, refetchQuery])

  const replaceProviders = useCallback(
    (providers: ModelOptionProvider[]) => {
      client.setQueryData<SettingsModelCatalog>(key, previous => ({
        providers,
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
    envVars: credentials.data ?? {},
    main: query.data?.main ?? null,
    owner,
    key: key.join(':'),
    refresh,
    replaceProviders,
    replaceMain,
    readMainRevision
  }
}
