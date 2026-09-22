import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  activateCustomEndpoint,
  deleteCustomEndpoint,
  getCustomEndpoints,
  saveCustomEndpoint,
  validateCustomEndpoint
} from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Check, Globe, Loader2, Plus, Save, Trash2, Zap } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { confirm } from '@/store/confirm'
import { notify, notifyError } from '@/store/notifications'
import { $settingsRequestProfile } from '@/store/settings-scope'
import type {
  CustomEndpoint,
  CustomEndpointApiMode,
  CustomEndpointModelDetail,
  CustomEndpointUpdate
} from '@/types/hermes'

import { EmptyState, Pill, SectionHeading, SettingsContent, SettingsSkeleton } from './primitives'
import { SettingsProfileScope } from './profile-scope'

interface CustomEndpointsSettingsProps {
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
}

interface EndpointForm {
  apiKey: string
  apiMode: CustomEndpointApiMode
  baseUrl: string
  contextLength: string
  discoverModels: boolean
  id: string
  makeDefault: boolean
  model: string
  name: string
}

// Same choices as `hermes model`'s custom-provider setup; '' = runtime auto-detect.
// This panel is not internationalized — keep the literals it has.
const API_MODE_OPTIONS: readonly { id: CustomEndpointApiMode; label: string }[] = [
  { id: '', label: 'Auto-detect' },
  { id: 'chat_completions', label: 'Chat Completions' },
  { id: 'codex_responses', label: 'Responses API' },
  { id: 'anthropic_messages', label: 'Anthropic Messages' }
]

const EMPTY_FORM: EndpointForm = {
  apiKey: '',
  apiMode: '',
  baseUrl: '',
  contextLength: '',
  discoverModels: true,
  id: '',
  makeDefault: true,
  model: '',
  name: ''
}

function formFromEndpoint(endpoint: CustomEndpoint): EndpointForm {
  return {
    apiKey: '',
    apiMode: endpoint.api_mode ?? '',
    baseUrl: endpoint.base_url,
    contextLength: endpoint.context_length ? String(endpoint.context_length) : '',
    discoverModels: endpoint.discover_models,
    id: endpoint.id,
    makeDefault: Boolean(endpoint.is_current),
    model: endpoint.model,
    name: endpoint.name
  }
}

function toPayload(
  form: EndpointForm,
  models?: string[],
  modelDetails?: CustomEndpointModelDetail[]
): CustomEndpointUpdate {
  const contextLength = Number.parseInt(form.contextLength, 10)

  return {
    id: form.id.trim() || undefined,
    name: form.name.trim(),
    base_url: form.baseUrl.trim(),
    model: form.model.trim(),
    api_key: form.apiKey.trim() || undefined,
    api_mode: form.apiMode,
    context_length: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : undefined,
    discover_models: form.discoverModels,
    make_default: form.makeDefault,
    models: models?.length ? models : undefined,
    model_details: modelDetails?.length ? modelDetails : undefined
  }
}

export function CustomEndpointsSettings({ onConfigSaved, onMainModelChanged }: CustomEndpointsSettingsProps) {
  const { t } = useI18n()
  const c = t.settings.customEndpoints
  // Shared settings "Applies to" scope: read/write this profile's endpoints,
  // not whichever Bot is active in the left rail. Undefined follows the
  // active profile (request-shaped — never pass null, which retargets primary).
  const scopeProfile = useStore($settingsRequestProfile)
  const mounted = useRef(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>([])
  const [form, setForm] = useState<EndpointForm>(EMPTY_FORM)
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  // Alias metadata from the last Test; the backend resolves a picked alias to its
  // canonical model + reasoning effort on Save (#93622).
  const [discoveredDetails, setDiscoveredDetails] = useState<CustomEndpointModelDetail[]>([])

  async function refresh() {
    const data = await getCustomEndpoints(scopeProfile)

    if (mounted.current) {
      setEndpoints(data.endpoints)
    }
  }

  // eslint-disable-next-line no-restricted-syntax -- lifecycle guard drops stale async completions; it does not mirror an atom
  useEffect(() => {
    let cancelled = false
    mounted.current = true
    setLoading(true)
    setForm(EMPTY_FORM)
    setDiscoveredModels([])
    setDiscoveredDetails([])
    setEndpoints([])

    async function load() {
      try {
        const data = await getCustomEndpoints(scopeProfile)

        if (cancelled) {
          return
        }

        setEndpoints(data.endpoints)
        const current = data.endpoints.find(endpoint => endpoint.is_current) ?? data.endpoints[0]

        if (current) {
          setForm(formFromEndpoint(current))
          setDiscoveredModels(current.models)
        }
      } catch (err) {
        notifyError(err, c.loadFailed)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [c.loadFailed, scopeProfile])

  async function handleSave() {
    try {
      setSaving(true)
      const response = await saveCustomEndpoint(toPayload(form, discoveredModels, discoveredDetails), scopeProfile)

      if (!mounted.current) {
        return
      }

      setEndpoints(response.endpoints)
      const saved = response.endpoints.find(endpoint => endpoint.id === response.id)

      if (saved) {
        setForm(formFromEndpoint(saved))
        setDiscoveredModels(saved.models)
      }

      if (saved && saved.is_current) {
        onMainModelChanged?.(saved.id, saved.model)
      }

      triggerHaptic('success')
      onConfigSaved?.()
      notify({ kind: 'success', message: c.saved })
    } catch (err) {
      if (mounted.current) {
        notifyError(err, c.saveFailed)
      }
    } finally {
      if (mounted.current) {
        setSaving(false)
      }
    }
  }

  async function handleValidate() {
    try {
      setTesting(true)
      const response = await validateCustomEndpoint(toPayload(form), scopeProfile)

      if (!mounted.current) {
        return
      }

      setDiscoveredModels(response.models)
      setDiscoveredDetails(response.model_details ?? [])

      if (response.ok) {
        // Persist the URL that actually served /models (e.g. "<root>/v1" when the user typed the
        // bare root): chat POSTs {base_url}/chat/completions verbatim, so saving the typed root
        // would 404 every request even though the test looked green (#65488).
        const resolvedBaseUrl = response.resolved_base_url?.trim()

        if (!form.model && response.models[0]) {
          setForm(current => ({ ...current, model: response.models[0] }))
        }

        if (resolvedBaseUrl && resolvedBaseUrl !== form.baseUrl.trim().replace(/\/+$/, '')) {
          setForm(current => ({ ...current, baseUrl: resolvedBaseUrl }))
        }

        // The backend also POSTed the transport the runtime will use; name it so an
        // auto-detected mode is visible before Save (#93622).
        const transport = API_MODE_OPTIONS.find(option => option.id === response.transport_checked)?.label
        notify({
          kind: 'success',
          message: transport
            ? c.endpointReachableTransport(transport, response.models.length)
            : response.models.length
              ? c.endpointReachableModels(response.models.length)
              : c.endpointReachable
        })
      } else {
        notify({
          kind: response.reachable ? 'warning' : 'error',
          message: response.message || c.endpointValidationFailed
        })
      }
    } catch (err) {
      if (mounted.current) {
        notifyError(err, c.validationFailed)
      }
    } finally {
      if (mounted.current) {
        setTesting(false)
      }
    }
  }

  async function handleActivate(endpoint: CustomEndpoint) {
    try {
      setActivating(endpoint.id)
      const response = await activateCustomEndpoint(endpoint.id, scopeProfile)

      if (!mounted.current) {
        return
      }

      await refresh()

      if (!mounted.current) {
        return
      }

      onConfigSaved?.()
      onMainModelChanged?.(response.provider, response.model)
      triggerHaptic('success')
    } catch (err) {
      if (mounted.current) {
        notifyError(err, c.activationFailed)
      }
    } finally {
      if (mounted.current) {
        setActivating(null)
      }
    }
  }

  async function handleDelete(endpoint: CustomEndpoint) {
    if (!(await confirm({ destructive: true, title: c.deleteConfirm(endpoint.name) }))) {
      return
    }

    try {
      setDeleting(endpoint.id)
      const response = await deleteCustomEndpoint(endpoint.id, scopeProfile)

      if (!mounted.current) {
        return
      }

      setEndpoints(response.endpoints)

      if (form.id === endpoint.id) {
        setForm(EMPTY_FORM)
        setDiscoveredModels([])
        setDiscoveredDetails([])
      }

      onConfigSaved?.()
      triggerHaptic('success')
    } catch (err) {
      if (mounted.current) {
        notifyError(err, c.deleteFailed)
      }
    } finally {
      if (mounted.current) {
        setDeleting(null)
      }
    }
  }

  if (loading) {
    return (
      <SettingsContent>
        <SettingsProfileScope className="mb-5" />
        <SettingsSkeleton sections={[{ heading: true, rows: 3 }]} />
      </SettingsContent>
    )
  }

  const allModelOptions = Array.from(new Set([...discoveredModels, form.model].filter(Boolean)))
  const canSave = form.name.trim() && form.baseUrl.trim() && form.model.trim()

  return (
    <SettingsContent>
      <SettingsProfileScope className="mb-5" />
      <div className="space-y-6">
        <section>
          <SectionHeading icon={Globe} meta={`${endpoints.length}`} page title={c.title} />
          <div className="divide-y divide-border/40 rounded-md border border-border/50">
            {endpoints.length ? (
              endpoints.map(endpoint => (
                <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={endpoint.id}>
                  <button
                    className="min-w-0 text-left"
                    onClick={() => {
                      setForm(formFromEndpoint(endpoint))
                      setDiscoveredModels(endpoint.models)
                      setDiscoveredDetails([])
                    }}
                    type="button"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{endpoint.name}</span>
                      {endpoint.is_current && (
                        <Pill tone="primary">
                          <Check className="size-3" />
                          {c.active}
                        </Pill>
                      )}
                      {endpoint.source === 'direct-config' && <Pill>config.yaml</Pill>}
                    </div>
                    <div className="mt-1 truncate font-mono text-[0.7rem] text-muted-foreground">
                      {endpoint.base_url}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{endpoint.model}</span>
                      {endpoint.has_api_key && <span>{endpoint.api_key_preview ?? c.apiKeySet}</span>}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Button
                      disabled={endpoint.is_current || activating === endpoint.id}
                      onClick={() => void handleActivate(endpoint)}
                      size="sm"
                      variant="outline"
                    >
                      {activating === endpoint.id ? <Loader2 className="animate-spin" /> : <Zap />}
                      {c.use}
                    </Button>
                    {endpoint.source !== 'direct-config' && (
                      <Button
                        aria-label={t.settings.customEndpoints.deleteEndpoint}
                        className="hover:text-destructive"
                        disabled={deleting === endpoint.id}
                        onClick={() => void handleDelete(endpoint)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        {deleting === endpoint.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState description={c.emptyDescription} title={c.emptyTitle} />
            )}
          </div>
        </section>

        <section>
          <SectionHeading icon={Plus} title={form.id ? c.editTitle : c.addTitle} />
          <div className="grid gap-3 rounded-md border border-border/50 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                {c.name}
                <Input
                  onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                  placeholder={c.namePlaceholder}
                  value={form.name}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                {c.providerId}
                <Input
                  onChange={event => setForm(current => ({ ...current, id: event.target.value }))}
                  placeholder={c.providerIdPlaceholder}
                  value={form.id}
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              {c.endpointUrl}
              <Input
                onChange={event => setForm(current => ({ ...current, baseUrl: event.target.value }))}
                placeholder={c.endpointUrlPlaceholder}
                value={form.baseUrl}
              />
            </label>
            <fieldset className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
              <legend className="mb-1.5">API Mode</legend>
              <SegmentedControl
                className="w-full max-w-full"
                onChange={apiMode => setForm(current => ({ ...current, apiMode }))}
                options={API_MODE_OPTIONS}
                value={form.apiMode}
              />
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                {c.defaultModel}
                <Input
                  list="custom-endpoint-models"
                  onChange={event => setForm(current => ({ ...current, model: event.target.value }))}
                  placeholder={c.defaultModelPlaceholder}
                  value={form.model}
                />
                <datalist id="custom-endpoint-models">
                  {allModelOptions.map(model => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                {c.context}
                <Input
                  inputMode="numeric"
                  onChange={event => setForm(current => ({ ...current, contextLength: event.target.value }))}
                  placeholder={c.contextPlaceholder}
                  value={form.contextLength}
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              {c.apiKey}
              <Input
                onChange={event => setForm(current => ({ ...current, apiKey: event.target.value }))}
                placeholder={form.id ? c.apiKeyKeepPlaceholder : c.apiKeyOptionalPlaceholder}
                type="password"
                value={form.apiKey}
              />
            </label>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.makeDefault}
                  onCheckedChange={checked => setForm(current => ({ ...current, makeDefault: checked === true }))}
                />
                {c.useForNewChats}
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.discoverModels}
                  onCheckedChange={checked => setForm(current => ({ ...current, discoverModels: checked === true }))}
                />
                {c.discoverModels}
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={testing || !form.baseUrl.trim()}
                onClick={() => void handleValidate()}
                variant="outline"
              >
                {testing ? <Loader2 className="animate-spin" /> : <Zap />}
                {testing ? c.testing : c.test}
              </Button>
              <Button disabled={saving || !canSave} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {saving ? c.saving : c.save}
              </Button>
              <Button
                className={cn(!form.id && 'hidden')}
                onClick={() => {
                  setForm(EMPTY_FORM)
                  setDiscoveredModels([])
                  setDiscoveredDetails([])
                }}
                type="button"
                variant="ghost"
              >
                {c.newEndpoint}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </SettingsContent>
  )
}
