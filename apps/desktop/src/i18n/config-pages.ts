import { fieldCopyForSchemaKey } from '@/app/settings/field-copy'

import { pageCopy } from './config-pages-copy'
import { fieldDescriptions } from './config-pages-descriptions'
import { fieldOverrides } from './config-pages-fields'
import { fieldTemplates } from './config-pages-templates'
import type { BundledLocale } from './types'
import type { ConfigPageFieldCopy, ConfigPagesCopy, ConfigPageUnit } from './types_config_pages'

const fieldKeys = [
  'display.personality',
  'timezone',
  'display.show_reasoning',
  'agent.image_input_mode',
  'approvals.mode',
  'approvals.timeout',
  'approvals.mcp_reload_confirm',
  'command_allowlist',
  'security.redact_secrets',
  'security.allow_private_urls',
  'checkpoints.enabled',
  'browser.use_real_profile',
  'browser.allow_private_urls',
  'browser.auto_local_for_private_urls',
  'memory.memory_enabled',
  'memory.user_profile_enabled',
  'memory.memory_char_limit',
  'memory.user_char_limit',
  'memory.provider',
  'context.engine',
  'compression.enabled',
  'compression.threshold',
  'compression.target_ratio',
  'compression.protect_last_n',
  'compression.codex_gpt55_autoraise',
  'auxiliary.compression.timeout',
  'voice.voice_chat_mode',
  'voice.gpt_live.voice',
  'voice.gpt_live.instructions',
  'voice.max_recording_seconds',
  'voice.client_direct',
  'stt.enabled',
  'stt.echo_transcripts',
  'stt.provider',
  'stt.streaming',
  'voice.auto_tts',
  'tts.provider',
  'agent.max_turns',
  'agent.api_max_retries',
  'agent.service_tier',
  'toolsets',
  'agent.tool_use_enforcement',
  'terminal.backend',
  'terminal.timeout',
  'terminal.docker_image',
  'terminal.singularity_image',
  'terminal.modal_image',
  'terminal.daytona_image',
  'tool_output.max_bytes',
  'tool_output.max_lines',
  'tool_output.max_line_length',
  'checkpoints.max_snapshots',
  'updates.non_interactive_local_changes',
  'local.attachmentSize',
  'local.maxBackends',
  'local.idleMs',
  'tts.edge.voice',
  'tts.openai.model',
  'tts.openai.voice',
  'tts.elevenlabs.voice_id',
  'tts.elevenlabs.model_id',
  'tts.xai.voice_id',
  'tts.xai.language',
  'tts.xai.speed',
  'tts.xai.auto_speech_tags',
  'tts.xai.optimize_streaming_latency',
  'tts.xai.sample_rate',
  'tts.xai.bit_rate',
  'tts.minimax.model',
  'tts.minimax.voice_id',
  'tts.mistral.model',
  'tts.mistral.voice_id',
  'tts.gemini.model',
  'tts.gemini.voice',
  'tts.neutts.model',
  'tts.neutts.device',
  'tts.kittentts.model',
  'tts.kittentts.voice',
  'tts.piper.voice',
  'tts.deepinfra.model',
  'tts.deepinfra.voice',
  'stt.local.model',
  'stt.local.language',
  'stt.openai.model',
  'stt.openai.streaming_model',
  'stt.groq.model',
  'stt.mistral.model',
  'stt.xai.model',
  'stt.deepinfra.model',
  'stt.elevenlabs.model_id',
  'stt.elevenlabs.language_code',
  'stt.elevenlabs.tag_audio_events',
  'stt.elevenlabs.diarize'
]

const fieldUnits: Partial<Record<string, ConfigPageUnit>> = {
  'approvals.timeout': 'seconds',
  'memory.memory_char_limit': 'characters',
  'memory.user_char_limit': 'characters',
  'compression.threshold': 'percent',
  'compression.target_ratio': 'percent',
  'compression.protect_last_n': 'messages',
  'auxiliary.compression.timeout': 'seconds',
  'voice.max_recording_seconds': 'seconds',
  'agent.max_turns': 'turns',
  'agent.api_max_retries': 'retries',
  'terminal.timeout': 'seconds',
  'tool_output.max_bytes': 'bytes',
  'tool_output.max_lines': 'lines',
  'tool_output.max_line_length': 'characters',
  'checkpoints.max_snapshots': 'snapshots',
  'local.attachmentSize': 'megabytes',
  'local.maxBackends': 'connections',
  'local.idleMs': 'minutes',
  'tts.xai.speed': 'multiplier',
  'tts.xai.sample_rate': 'hertz',
  'tts.xai.bit_rate': 'bitsPerSecond'
}

const fieldHelpKeys = [
  'display.personality',
  'timezone',
  'display.show_reasoning',
  'approvals.mcp_reload_confirm',
  'command_allowlist',
  'security.redact_secrets',
  'security.allow_private_urls',
  'checkpoints.enabled',
  'browser.use_real_profile',
  'browser.allow_private_urls',
  'browser.auto_local_for_private_urls',
  'memory.provider',
  'voice.voice_chat_mode',
  'voice.gpt_live.instructions',
  'voice.client_direct',
  'stt.echo_transcripts',
  'voice.auto_tts',
  'tts.provider',
  'agent.service_tier',
  'toolsets',
  'agent.tool_use_enforcement',
  'tool_output.max_lines',
  'checkpoints.max_snapshots',
  'updates.non_interactive_local_changes'
]

const voiceFieldKeys = [
  'tts.edge.voice',
  'tts.openai.model',
  'tts.openai.voice',
  'tts.elevenlabs.voice_id',
  'tts.elevenlabs.model_id',
  'tts.xai.voice_id',
  'tts.xai.language',
  'tts.xai.speed',
  'tts.xai.auto_speech_tags',
  'tts.xai.optimize_streaming_latency',
  'tts.xai.sample_rate',
  'tts.xai.bit_rate',
  'tts.minimax.model',
  'tts.minimax.voice_id',
  'tts.mistral.model',
  'tts.mistral.voice_id',
  'tts.gemini.model',
  'tts.gemini.voice',
  'tts.neutts.model',
  'tts.neutts.device',
  'tts.kittentts.model',
  'tts.kittentts.voice',
  'tts.piper.voice',
  'tts.deepinfra.model',
  'tts.deepinfra.voice',
  'stt.local.model',
  'stt.local.language',
  'stt.openai.model',
  'stt.openai.streaming_model',
  'stt.groq.model',
  'stt.mistral.model',
  'stt.xai.model',
  'stt.deepinfra.model',
  'stt.elevenlabs.model_id',
  'stt.elevenlabs.language_code',
  'stt.elevenlabs.tag_audio_events',
  'stt.elevenlabs.diarize'
]

const voiceFieldCopyKey = {
  model: 'model',
  model_id: 'model',
  voice: 'voice',
  voice_id: 'voice',
  language: 'language',
  language_code: 'language',
  device: 'device',
  streaming_model: 'streamingModel',
  tag_audio_events: 'audioEvents',
  diarize: 'speakers',
  speed: 'speed',
  auto_speech_tags: 'speechTags',
  optimize_streaming_latency: 'latency',
  sample_rate: 'sampleRate',
  bit_rate: 'bitRate'
}

const providerNames: Record<string, string> = {
  edge: 'Microsoft Edge',
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  xai: 'xAI',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  gemini: 'Gemini',
  neutts: 'NeuTTS',
  kittentts: 'KittenTTS',
  piper: 'Piper',
  deepinfra: 'DeepInfra',
  groq: 'Groq',
  local: 'Local'
}

/** Reuses the existing translated field catalog; only presentation copy is composed here. */
export function configPagesFor(
  locale: BundledLocale,
  labels: Record<string, string>,
  descriptions: Record<string, string>
): ConfigPagesCopy {
  const template = fieldTemplates[locale]
  const fields: Partial<Record<string, ConfigPageFieldCopy>> = {}

  for (const key of fieldKeys) {
    const override = fieldOverrides[locale][key]
    const voiceField = voiceFieldKeys.includes(key)
    const [, provider, name] = key.split('.')
    const voiceCopyKey = voiceFieldCopyKey[name as keyof typeof voiceFieldCopyKey]
    const voiceLabel = voiceField && voiceCopyKey ? template[voiceCopyKey as keyof typeof template] : undefined
    const providerName = providerNames[provider] ?? provider

    const description =
      override?.description ??
      fieldDescriptions[locale]?.[key] ??
      (voiceField
        ? template.providerHelp.replace('{provider}', providerName)
        : (fieldCopyForSchemaKey(descriptions, key) ?? template.missing))

    fields[key] = {
      label:
        override?.label ?? fieldCopyForSchemaKey(labels, key) ?? (voiceLabel ? providerName + ' · ' + voiceLabel : key),
      description,
      ...(fieldHelpKeys.includes(key) ? { help: override?.help ?? description } : {}),
      ...(fieldUnits[key] ? { unit: fieldUnits[key] } : {})
    }
  }

  return { ...pageCopy[locale], fields }
}
