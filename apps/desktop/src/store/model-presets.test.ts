import { beforeEach, describe, expect, it } from 'vitest'

import {
  $modelPresets,
  applyModelPreset,
  getModelPreset,
  migrateModelPresetScope,
  setModelPreset
} from './model-presets'
import {
  $currentFastMode,
  $currentReasoningEffort,
  $currentServiceTier,
  setCurrentFastMode,
  setCurrentReasoningEffort,
  setCurrentServiceTier
} from './session'

describe('model presets', () => {
  beforeEach(() => {
    $modelPresets.set({})
    setCurrentFastMode(false)
    setCurrentReasoningEffort('')
    setCurrentServiceTier('')
  })

  it('round-trips a preset and merges patches without dropping prior fields', () => {
    setModelPreset('anthropic', 'claude-opus-4-8', { effort: 'high' })
    setModelPreset('anthropic', 'claude-opus-4-8', { fast: true })

    expect(getModelPreset('anthropic', 'claude-opus-4-8')).toEqual({
      effort: 'high',
      fast: true,
      serviceTier: 'priority'
    })
  })

  it('returns an empty preset for unknown models', () => {
    expect(getModelPreset('x', 'y')).toEqual({})
  })

  it('isolates conversation presets from global presets and excludes them from persisted preferences', () => {
    setModelPreset('provider', 'model', { effort: 'medium' })
    setModelPreset('provider', 'model', { effort: 'high' }, 'owner-a/chat-a')
    setModelPreset('provider', 'model', { fast: true }, 'owner-a/chat-a')
    expect(getModelPreset('provider', 'model', 'owner-a/chat-a')).toEqual({
      effort: 'high',
      fast: true,
      serviceTier: 'priority'
    })
    expect(getModelPreset('provider', 'model', 'owner-a/chat-b')).toEqual({})
    expect(getModelPreset('provider', 'model', 'owner-b/chat-a')).toEqual({})
    expect(getModelPreset('provider', 'model')).toEqual({ effort: 'medium' })
    setModelPreset('provider', 'other', { effort: 'low' })
    expect(JSON.parse(localStorage.getItem('hermes.desktop.model-presets') || '{}')).toEqual({
      'provider::model': { effort: 'medium' },
      'provider::other': { effort: 'low' }
    })
  })

  it('moves the created draft presets into its assigned conversation without changing global defaults', () => {
    setModelPreset('provider', 'model', { effort: 'high' }, 'owner/draft')
    setModelPreset('provider', 'inactive-model', { effort: 'low' }, 'owner/draft')
    setModelPreset('provider', 'model', { effort: 'medium' })
    migrateModelPresetScope('owner/draft', 'owner/stored')
    expect(getModelPreset('provider', 'model', 'owner/stored')).toEqual({ effort: 'high' })
    expect(getModelPreset('provider', 'inactive-model', 'owner/stored')).toEqual({ effort: 'low' })
    expect(getModelPreset('provider', 'model', 'owner/draft')).toEqual({})
    expect(getModelPreset('provider', 'model')).toEqual({ effort: 'medium' })
  })

  it('keeps Ultrafast distinct and a later legacy Fast edit selects priority', async () => {
    const calls: unknown[] = []

    const request = async <T>(method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })

      return {} as T
    }

    setModelPreset('openai-codex', 'gpt-6-astra', { serviceTier: 'ultrafast', effort: 'ultra' })
    await applyModelPreset(getModelPreset('openai-codex', 'gpt-6-astra'), {
      failMessage: 'failed',
      request,
      sessionId: 'session-a'
    })
    expect($currentServiceTier.get()).toBe('ultrafast')
    expect(calls).toContainEqual({
      method: 'config.set',
      params: { key: 'fast', session_id: 'session-a', value: 'ultrafast' }
    })
    setModelPreset('openai-codex', 'gpt-6-astra', { fast: true })
    expect(getModelPreset('openai-codex', 'gpt-6-astra')).toEqual({
      effort: 'ultra',
      fast: true,
      serviceTier: 'priority'
    })
    await applyModelPreset({ serviceTier: 'normal' }, { failMessage: 'failed', request, sessionId: null })
    expect($currentServiceTier.get()).toBe('normal')
    expect($currentFastMode.get()).toBe(false)
  })

  it('pushes only the provided dimensions to the gateway', async () => {
    const calls: { method: string; params?: Record<string, unknown> }[] = []

    const request = async <T>(method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })

      return {} as T
    }

    await applyModelPreset({ effort: 'high' }, { failMessage: 'x', request, sessionId: 's1' })
    await applyModelPreset({}, { failMessage: 'x', request, sessionId: 's1' })

    expect(calls).toEqual([{ method: 'config.set', params: { key: 'reasoning', session_id: 's1', value: 'high' } }])
  })

  it('applies a fresh-draft preset locally without mutating gateway config', async () => {
    const calls: { method: string; params?: Record<string, unknown> }[] = []

    const request = async <T>(method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })

      return {} as T
    }

    await applyModelPreset({ effort: 'high', fast: true }, { failMessage: 'x', request, sessionId: null })

    expect($currentReasoningEffort.get()).toBe('high')
    expect($currentFastMode.get()).toBe(true)
    expect(calls).toEqual([])
  })
})
