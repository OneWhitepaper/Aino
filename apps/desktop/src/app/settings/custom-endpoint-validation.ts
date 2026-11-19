import type { Translations } from '@/i18n/types'
import type {
  CustomEndpointApiMode,
  CustomEndpointModelDetail,
  CustomEndpointUpdate,
  CustomEndpointValidationResponse
} from '@/types/hermes'

import type { customModelConfigCopy } from './custom-model-config-copy'
import type { EndpointForm } from './use-custom-endpoint-editor'

export interface ValidationNotice {
  kind: 'success' | 'warning' | 'error'
  message: string
}

export function resolveEndpointValidation(
  draft: EndpointForm,
  response: CustomEndpointValidationResponse,
  copy: Translations['settings']['customEndpoints'],
  validationCopy: ReturnType<typeof customModelConfigCopy>,
  modes: readonly { id: CustomEndpointApiMode; label: string }[]
) {
  // Catalogs and legacy route probes do not prove that a model request succeeded.
  const detected =
    response.ok && draft.model.trim() && modes.find(mode => mode.id !== '' && mode.id === response.detected_api_mode)

  const next = response.ok
    ? {
        ...draft,
        baseUrl: response.resolved_base_url?.trim() || draft.baseUrl,
        model: draft.model || response.models[0] || ''
      }
    : draft

  const apiMode = detected ? detected.id : null
  const transport = detected ? detected.label : undefined
  let notice: ValidationNotice

  if (!response.ok) {
    notice = {
      kind: response.reachable ? 'warning' : 'error',
      message: response.message || copy.endpointValidationFailed
    }
  } else if (!draft.apiMode && draft.model.trim() && !detected) {
    notice = { kind: 'warning', message: validationCopy.autoDetectionRequired }
  } else {
    notice = {
      kind: 'success',
      message: transport
        ? copy.endpointReachableTransport(transport, response.models.length)
        : response.models.length
          ? copy.endpointReachableModels(response.models.length)
          : copy.endpointReachable
    }
  }

  if (detected && ['chat_completions', 'anthropic_messages'].includes(detected.id)) {
    notice.message += ` ${validationCopy.automaticAdapter}`
  }

  return { form: next, apiMode, notice, models: response.models, details: response.model_details ?? [] }
}

export interface VerifiedEndpointValidation {
  draft: EndpointForm
  generation: number
  payload: CustomEndpointUpdate
}

export function toEndpointPayload(
  form: EndpointForm,
  models?: string[],
  details?: CustomEndpointModelDetail[]
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
    model_details: details?.length ? details : undefined
  }
}

export async function prepareEndpointSave(
  draft: EndpointForm,
  generation: number,
  cached: VerifiedEndpointValidation | null,
  validate: () => Promise<VerifiedEndpointValidation | null>,
  models: string[],
  details: CustomEndpointModelDetail[]
): Promise<CustomEndpointUpdate | null> {
  if (draft.apiMode) {
    return toEndpointPayload(draft, models, details)
  }

  const verified = cached?.draft === draft && cached.generation === generation ? cached : await validate()

  return verified?.payload ?? null
}
