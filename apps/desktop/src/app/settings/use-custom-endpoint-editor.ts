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
import type { CustomEndpoint, CustomEndpointApiMode, CustomEndpointModelDetail } from '@/types/hermes'

import {
  prepareEndpointSave,
  resolveEndpointValidation,
  toEndpointPayload,
  type ValidationNotice,
  type VerifiedEndpointValidation
} from './custom-endpoint-validation'
import { customModelConfigCopy } from './custom-model-config-copy'

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

interface EditorOptions {
  autoSelect?: boolean
  makeDefault?: boolean
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
  scope?: ProfileScope
}

export function useCustomEndpointEditor({
  autoSelect = true,
  makeDefault = true,
  onConfigSaved,
  onMainModelChanged,
  scope
}: EditorOptions) {
  const { locale, t } = useI18n()
  const copy = t.settings.customEndpoints
  const validationCopy = customModelConfigCopy(locale)
  const latest = useRef({ copy, validationCopy, onConfigSaved, onMainModelChanged })
  latest.current = { copy, validationCopy, onConfigSaved, onMainModelChanged }
  const generation = useRef(0)
  const revision = useRef(0)
  const validationRequest = useRef(0)
  const verified = useRef<VerifiedEndpointValidation | null>(null)
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
    verified.current = null
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
    verified.current = null
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
    const isCurrent = () => generation.current === currentGeneration && revision.current === currentRevision

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
      const payload = await prepareEndpointSave(
        draft,
        currentGeneration,
        verified.current,
        validateDraft,
        models,
        details
      )

      if (!payload || !isCurrent()) {
        return false
      }

      const response = await saveCustomEndpoint(payload, scope)

      if (!isCurrent()) {
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
      if (isCurrent()) {
        notifyError(error, latest.current.copy.saveFailed)
      }

      return false
    } finally {
      if (generation.current === currentGeneration) {
        setSaving(false)
      }
    }
  }

  async function validateDraft(publishSuccess = false): Promise<VerifiedEndpointValidation | null> {
    const currentGeneration = generation.current
    const currentRevision = revision.current
    const request = ++validationRequest.current
    const draft = formRef.current

    verified.current = null
    setValidation(null)

    const isCurrent = () =>
      generation.current === currentGeneration &&
      revision.current === currentRevision &&
      validationRequest.current === request

    try {
      const response = await validateCustomEndpoint(toEndpointPayload(draft), scope)

      if (!isCurrent()) {
        return null
      }

      const result = resolveEndpointValidation(
        draft,
        response,
        latest.current.copy,
        latest.current.validationCopy,
        CUSTOM_ENDPOINT_API_MODES
      )

      formRef.current = result.form
      setForm(result.form)
      setModels(result.models)
      setDetails(result.details)
      setValidation(result.notice)

      if (publishSuccess || result.notice.kind !== 'success') {
        notify(result.notice)
      }

      if (!draft.apiMode && result.apiMode) {
        verified.current = {
          draft: result.form,
          generation: currentGeneration,
          payload: { ...toEndpointPayload(result.form, result.models, result.details), api_mode: result.apiMode }
        }
      }

      return verified.current
    } catch (error) {
      if (isCurrent()) {
        setValidation({ kind: 'error', message: latest.current.copy.validationFailed })
        notifyError(error, latest.current.copy.validationFailed)
      }

      return null
    } finally {
      if (isCurrent()) {
        setTesting(false)
      }
    }
  }

  async function validate() {
    if (saving || deleting || activating || !formRef.current.baseUrl.trim()) {
      return
    }

    setTesting(true)
    await validateDraft(true)
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
