import { useEffect, useRef, useState } from 'react'

import type { ProfileScope } from '@/api/client'
import {
  activateCustomEndpoint,
  deleteCustomEndpoint,
  getCustomEndpoints,
  saveCustomEndpoint,
  validateCustomEndpoint
} from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { confirm } from '@/store/confirm'
import { notify, notifyError } from '@/store/notifications'
import type {
  CustomEndpoint,
  CustomEndpointApiMode,
  CustomEndpointModelDetail,
  CustomEndpointUpdate
} from '@/types/hermes'

export interface EndpointForm {
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

export const CUSTOM_ENDPOINT_API_MODES: readonly { id: CustomEndpointApiMode; label: string }[] = [
  { id: '', label: 'Auto-detect' },
  { id: 'chat_completions', label: 'Chat Completions' },
  { id: 'codex_responses', label: 'Responses API' },
  { id: 'anthropic_messages', label: 'Anthropic Messages' }
]

function emptyForm(makeDefault: boolean): EndpointForm {
  return {
    apiKey: '',
    apiMode: '',
    baseUrl: '',
    contextLength: '',
    discoverModels: true,
    id: '',
    makeDefault,
    model: '',
    name: ''
  }
}

function formFromEndpoint(endpoint: CustomEndpoint, makeDefault: boolean): EndpointForm {
  return {
    apiKey: '',
    apiMode: endpoint.api_mode ?? '',
    baseUrl: endpoint.base_url,
    contextLength: endpoint.context_length ? String(endpoint.context_length) : '',
    discoverModels: endpoint.discover_models,
    id: endpoint.id,
    makeDefault: makeDefault && Boolean(endpoint.is_current),
    model: endpoint.model,
    name: endpoint.name
  }
}

function toPayload(form: EndpointForm, models?: string[], details?: CustomEndpointModelDetail[]): CustomEndpointUpdate {
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
    model_details: details?.length ? details : undefined
  }
}

interface EditorOptions {
  autoSelect?: boolean
  makeDefault?: boolean
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
  scope?: ProfileScope
}

interface ValidationNotice {
  kind: 'success' | 'warning' | 'error'
  message: string
}

export function useCustomEndpointEditor({
  autoSelect = true,
  makeDefault = true,
  onConfigSaved,
  onMainModelChanged,
  scope
}: EditorOptions) {
  const { t } = useI18n()
  const copy = t.settings.customEndpoints
  const latest = useRef({ copy, onConfigSaved, onMainModelChanged })
  latest.current = { copy, onConfigSaved, onMainModelChanged }
  const generation = useRef(0)
  const revision = useRef(0)
  const validationRequest = useRef(0)
  const [form, setForm] = useState(() => emptyForm(makeDefault))
  const formRef = useRef(form)
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>([])
  const [models, setModels] = useState<string[]>([])
  const [details, setDetails] = useState<CustomEndpointModelDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationNotice | null>(null)

  const scopeKey =
    scope && typeof scope === 'object'
      ? JSON.stringify([scope.connectionId ?? null, scope.profile ?? null])
      : `${typeof scope}:${scope ?? ''}`

  function replaceForm(next: EndpointForm, nextModels: string[] = []) {
    revision.current++
    validationRequest.current++
    formRef.current = next
    setForm(next)
    setModels(nextModels)
    setDetails([])
    setValidation(null)
    setTesting(false)
  }

  function updateForm(patch: Partial<EndpointForm>) {
    const current = formRef.current
    const next = { ...current, ...patch }
    revision.current++
    validationRequest.current++
    formRef.current = next
    setForm(next)
    setValidation(null)
    setTesting(false)

    // Discovery and alias metadata belong to the credential + transport that returned them.
    if (
      next.baseUrl !== current.baseUrl ||
      next.apiKey !== current.apiKey ||
      next.apiMode !== current.apiMode ||
      next.id !== current.id
    ) {
      setModels([])
      setDetails([])
    }
  }

  // eslint-disable-next-line no-restricted-syntax -- generation retires asynchronous requests on owner changes; it does not mirror reactive state
  useEffect(() => {
    const currentGeneration = ++generation.current
    setLoading(true)
    setSaving(false)
    setActivating(null)
    setDeleting(null)
    setEndpoints([])
    replaceForm(emptyForm(makeDefault))
    void getCustomEndpoints(scope)
      .then(data => {
        if (generation.current !== currentGeneration) {
          return
        }

        setEndpoints(data.endpoints)
        const selected = autoSelect && (data.endpoints.find(endpoint => endpoint.is_current) ?? data.endpoints[0])

        if (selected) {
          replaceForm(formFromEndpoint(selected, makeDefault), selected.models)
        }
      })
      .catch(error => {
        if (generation.current === currentGeneration) {
          notifyError(error, latest.current.copy.loadFailed)
        }
      })
      .finally(() => {
        if (generation.current === currentGeneration) {
          setLoading(false)
        }
      })

    return () => {
      generation.current = currentGeneration + 1
    }
    // `scopeKey` compares owner values; an equivalent inline scope object must not reset a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, autoSelect, makeDefault])

  async function save() {
    const currentGeneration = generation.current
    const currentRevision = revision.current
    const draft = formRef.current

    if (
      saving ||
      deleting ||
      activating ||
      testing ||
      !draft.name.trim() ||
      !draft.baseUrl.trim() ||
      !draft.model.trim()
    ) {
      return false
    }

    setSaving(true)

    try {
      const response = await saveCustomEndpoint(toPayload(draft, models, details), scope)

      if (generation.current !== currentGeneration || revision.current !== currentRevision) {
        return false
      }

      setEndpoints(response.endpoints)
      const saved = response.endpoints.find(endpoint => endpoint.id === response.id)

      if (saved) {
        replaceForm(formFromEndpoint(saved, makeDefault), saved.models)
      }

      if (saved?.is_current && draft.makeDefault) {
        latest.current.onMainModelChanged?.(response.current.provider, response.current.model)
      }

      triggerHaptic('success')
      latest.current.onConfigSaved?.()
      notify({ kind: 'success', message: latest.current.copy.saved })

      return true
    } catch (error) {
      if (generation.current === currentGeneration && revision.current === currentRevision) {
        notifyError(error, latest.current.copy.saveFailed)
      }

      return false
    } finally {
      if (generation.current === currentGeneration) {
        setSaving(false)
      }
    }
  }

  async function validate() {
    const currentGeneration = generation.current
    const currentRevision = revision.current
    const request = ++validationRequest.current
    const draft = formRef.current

    if (saving || deleting || activating || !draft.baseUrl.trim()) {
      return
    }

    setTesting(true)
    setValidation(null)

    const isCurrent = () =>
      generation.current === currentGeneration &&
      revision.current === currentRevision &&
      validationRequest.current === request

    try {
      const response = await validateCustomEndpoint(toPayload(draft), scope)

      if (!isCurrent()) {
        return
      }

      const c = latest.current.copy

      if (response.ok) {
        setModels(response.models)
        setDetails(response.model_details ?? [])

        const next = {
          ...draft,
          baseUrl: response.resolved_base_url?.trim() || draft.baseUrl,
          model: draft.model || response.models[0] || ''
        }

        formRef.current = next
        setForm(next)
        const transport = CUSTOM_ENDPOINT_API_MODES.find(option => option.id === response.transport_checked)?.label

        const notice: ValidationNotice = {
          kind: 'success',
          message: transport
            ? c.endpointReachableTransport(transport, response.models.length)
            : response.models.length
              ? c.endpointReachableModels(response.models.length)
              : c.endpointReachable
        }

        setValidation(notice)
        notify(notice)
      } else {
        setModels([])
        setDetails([])

        const notice: ValidationNotice = {
          kind: response.reachable ? 'warning' : 'error',
          message: response.message || c.endpointValidationFailed
        }

        setValidation(notice)
        notify(notice)
      }
    } catch (error) {
      if (isCurrent()) {
        setValidation({ kind: 'error', message: latest.current.copy.validationFailed })
        notifyError(error, latest.current.copy.validationFailed)
      }
    } finally {
      if (isCurrent()) {
        setTesting(false)
      }
    }
  }

  async function activate(endpoint: CustomEndpoint) {
    const currentGeneration = generation.current
    setActivating(endpoint.id)

    try {
      const result = await activateCustomEndpoint(endpoint.id, scope)

      if (generation.current !== currentGeneration) {
        return
      }

      const response = await getCustomEndpoints(scope)

      if (generation.current !== currentGeneration) {
        return
      }

      setEndpoints(response.endpoints)
      latest.current.onConfigSaved?.()
      latest.current.onMainModelChanged?.(result.provider, result.model)
      triggerHaptic('success')
    } catch (error) {
      if (generation.current === currentGeneration) {
        notifyError(error, latest.current.copy.activationFailed)
      }
    } finally {
      if (generation.current === currentGeneration) {
        setActivating(null)
      }
    }
  }

  async function remove(endpoint: CustomEndpoint) {
    const currentGeneration = generation.current

    if (saving || deleting || activating) {
      return
    }

    if (
      !(await confirm({ destructive: true, title: latest.current.copy.deleteConfirm(endpoint.name) })) ||
      generation.current !== currentGeneration
    ) {
      return
    }

    setDeleting(endpoint.id)
    validationRequest.current++
    setTesting(false)

    try {
      const response = await deleteCustomEndpoint(endpoint.id, scope)

      if (generation.current !== currentGeneration) {
        return
      }

      setEndpoints(response.endpoints)

      if (formRef.current.id === endpoint.id) {
        replaceForm(emptyForm(makeDefault))
      }

      latest.current.onConfigSaved?.()
      triggerHaptic('success')
    } catch (error) {
      if (generation.current === currentGeneration) {
        notifyError(error, latest.current.copy.deleteFailed)
      }
    } finally {
      if (generation.current === currentGeneration) {
        setDeleting(null)
      }
    }
  }

  return {
    activate,
    activating,
    deleting,
    endpoints,
    form,
    loading,
    remove,
    save,
    saving,
    testing,
    updateForm,
    validate,
    validation,
    canSave: Boolean(form.name.trim() && form.baseUrl.trim() && form.model.trim()),
    modelOptions: Array.from(new Set([...models, form.model].filter(Boolean))),
    reset: () => replaceForm(emptyForm(makeDefault)),
    select: (endpoint: CustomEndpoint) => replaceForm(formFromEndpoint(endpoint, makeDefault), endpoint.models)
  }
}

export type CustomEndpointEditor = ReturnType<typeof useCustomEndpointEditor>
