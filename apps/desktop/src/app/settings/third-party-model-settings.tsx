import { useStore } from '@nanostores/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { $apiRequestScope, type ProfileScope, profileScopeKey } from '@/api/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getEnvVars, getGlobalModelOptions } from '@/hermes'
import { useI18n } from '@/i18n'
import { modelSourceCopy } from '@/i18n/model-source'
import { Globe } from '@/lib/icons'
import { findCatalogProvider } from '@/lib/model-options'
import { readableError } from '@/store/notifications'
import { $settingsRequestProfile } from '@/store/settings-scope'

import { ComboboxInput } from './combobox-input'
import { customModelConfigCopy } from './custom-model-config-copy'
import { isCustomModelProvider, officialModelProviders } from './model-provider-source'
import { EmptyState, SectionHeading, SettingsContent, SettingsSkeleton } from './primitives'
import { SettingsProfileScope } from './profile-scope'
import { connectProviderApiKey } from './provider-connection'
import { ProviderConnectionSubmit, ProviderCredentialInput } from './provider-credential-fields'

interface ProviderConnectionFormProps {
  scope: ProfileScope
  providerId?: string
  onConfigSaved?: () => void
}

function ProviderConnectionForm({ scope, providerId, onConfigSaved }: ProviderConnectionFormProps) {
  const { t, locale } = useI18n()
  const copy = modelSourceCopy(locale)
  const formCopy = customModelConfigCopy(locale)
  const queryClient = useQueryClient()
  const scopeKey = profileScopeKey(scope)
  const [providerDraft, setProviderDraft] = useState(providerId || '')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState('')
  const [resultCount, setResultCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const catalogKey = ['model-options', scopeKey, 'provider-setup']
  const credentialKey = ['env-vars', scopeKey]

  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => getGlobalModelOptions({ includeUnconfigured: true }, scope)
  })

  const credentials = useQuery({ queryKey: credentialKey, queryFn: () => getEnvVars(scope) })

  const providers = useMemo(
    () =>
      officialModelProviders(catalog.data?.providers || [], credentials.data || {}).filter(
        row => row.auth_type === 'api_key' && Boolean(row.key_env)
      ),
    [catalog.data, credentials.data]
  )

  const selected = providers.find(row => row.slug === providerDraft) || providers[0]
  const selectedSlug = selected?.slug || ''
  const models = selected?.models || []

  // Retire requests and unsaved credentials when their service or owner changes.
  // eslint-disable-next-line no-restricted-syntax -- this generation retires async work; it does not mirror an atom value
  useEffect(() => {
    generation.current += 1
    setKey('')
    setShowKey(false)
    setBusy(false)
    setError('')
    setModel('')
    setResultCount(null)

    return () => {
      generation.current += 1
    }
  }, [scopeKey, selectedSlug])

  const connect = async () => {
    if (!selected || busy || (!key.trim() && !selected.authenticated)) {
      return
    }

    const request = generation.current
    const provider = selected
    setBusy(true)
    setError('')
    setResultCount(null)

    try {
      const result = await connectProviderApiKey(provider, key, scope)

      if (request !== generation.current) {
        return
      }

      queryClient.setQueryData(catalogKey, { providers: result.providers })
      setModel(result.recommendedModel)
      setResultCount(
        findCatalogProvider(
          result.providers.filter(row => !isCustomModelProvider(row)),
          provider.slug
        )?.models?.length || 0
      )
      setKey('')
      setShowKey(false)
      void queryClient.invalidateQueries({ queryKey: ['model-options'] })
      void queryClient.invalidateQueries({ queryKey: credentialKey })
      onConfigSaved?.()
    } catch (failure) {
      if (request === generation.current) {
        setError(readableError(failure, copy.saveFailed).message)
      }
    } finally {
      if (request === generation.current) {
        setBusy(false)
      }
    }
  }

  if (catalog.isPending || credentials.isPending) {
    return <SettingsSkeleton sections={[{ rows: 3 }]} />
  }

  const loadError = catalog.error || credentials.error

  if (loadError) {
    return (
      <Alert variant="destructive">
        <Codicon aria-hidden className="mt-0.5 text-destructive" name="error" />
        <AlertDescription>
          <p>{readableError(loadError, copy.saveFailed).message}</p>
          <Button
            className="max-w-full whitespace-normal text-left"
            onClick={() => {
              void catalog.refetch()
              void credentials.refetch()
            }}
            variant="outline"
          >
            {t.common.retry}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!selected) {
    return <EmptyState description={copy.noProviders} title={copy.providerSource} />
  }

  const fieldClass = 'grid min-w-0 gap-2 text-[length:var(--aino-text-label)] font-medium text-(--ui-text-secondary)'

  return (
    <div className="grid gap-5">
      <label className={fieldClass}>
        {formCopy.provider}
        <Select
          disabled={busy}
          onValueChange={slug => {
            generation.current += 1
            setKey('')
            setProviderDraft(slug)
          }}
          value={selected.slug}
        >
          <SelectTrigger aria-label={formCopy.provider} className="w-full font-normal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map(provider => (
              <SelectItem key={provider.slug} value={provider.slug}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <ProviderCredentialInput
        apiKey={key}
        busy={busy}
        className={fieldClass}
        onKeyChange={value => {
          setKey(value)
          setError('')
        }}
        onToggleVisibility={() => setShowKey(value => !value)}
        provider={selected}
        showKey={showKey}
      />
      {models.length > 0 && (
        <label className={fieldClass}>
          {formCopy.modelName}
          <ComboboxInput
            aria-label={formCopy.modelName}
            disabled={busy}
            onChange={setModel}
            options={models}
            value={models.includes(model) ? model : models[0]}
          />
        </label>
      )}
      {error && (
        <Alert variant="destructive">
          <Codicon aria-hidden className="mt-0.5 text-destructive" name="error" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {resultCount !== null && (
        <Alert aria-live="polite" role="status" variant={resultCount ? 'success' : 'default'}>
          <Codicon aria-hidden className="mt-0.5 text-(--ui-text-secondary)" name={resultCount ? 'check' : 'info'} />
          <AlertDescription>{resultCount ? copy.modelsReady(resultCount) : copy.noModels}</AlertDescription>
        </Alert>
      )}
      <ProviderConnectionSubmit apiKey={key} busy={busy} onConnect={() => void connect()} provider={selected} />
    </div>
  )
}

export function ThirdPartyModelConfigDialog({
  open,
  onOpenChange,
  scope,
  providerId,
  onConfigSaved
}: ProviderConnectionFormProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { locale } = useI18n()
  const copy = modelSourceCopy(locale)

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open && (
        <DialogContent className="max-w-[540px]">
          <DialogHeader>
            <DialogTitle>{copy.configureProvider}</DialogTitle>
            <DialogDescription>{copy.providerDescription}</DialogDescription>
          </DialogHeader>
          <ProviderConnectionForm onConfigSaved={onConfigSaved} providerId={providerId} scope={scope} />
        </DialogContent>
      )}
    </Dialog>
  )
}

export function ThirdPartyModelSettings({
  embedded = false,
  onConfigSaved
}: {
  embedded?: boolean
  onConfigSaved?: () => void
}) {
  const { locale } = useI18n()
  const copy = modelSourceCopy(locale)
  const requestedProfile = useStore($settingsRequestProfile)
  const ambient = useStore($apiRequestScope)

  const scope = useMemo(
    () => ({
      connectionId: ambient.connectionId,
      profile: requestedProfile ?? ambient.profile
    }),
    [ambient.connectionId, ambient.profile, requestedProfile]
  )

  const content = (
    <>
      {!embedded && (
        <>
          <SettingsProfileScope className="mb-5" />
          <SectionHeading icon={Globe} page title={copy.providerSource} />
        </>
      )}
      <p className="mb-5 text-[length:var(--aino-text-label)] text-muted-foreground">{copy.providerDescription}</p>
      <ProviderConnectionForm onConfigSaved={onConfigSaved} scope={scope} />
    </>
  )

  return embedded ? <div>{content}</div> : <SettingsContent>{content}</SettingsContent>
}
