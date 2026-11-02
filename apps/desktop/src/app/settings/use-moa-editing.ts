import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'

import { saveMoaModels } from '@/hermes'
import type { MoaConfigResponse, MoaModelSlot } from '@/hermes'

// A slot is complete when both halves are chosen. Changing a slot's provider
// intentionally clears its model (see updateMoaSlot), so every provider change
// passes through an incomplete state while the user picks the new model.
export const moaSlotComplete = (slot: MoaModelSlot): boolean => !!(slot.provider.trim() && slot.model.trim())

// True when every slot in every preset is fully specified — the only state
// that is safe to persist. The backend rejects configs with half-filled slots
// (HTTP 422) instead of silently swapping the preset for hardcoded defaults
// (#64156), so the autosave must simply wait for the edit to finish rather
// than trying to "repair" the payload.
export const moaConfigComplete = (config: MoaConfigResponse): boolean =>
  Object.values(config.presets).every(
    preset =>
      preset.reference_models.length > 0 &&
      preset.reference_models.every(moaSlotComplete) &&
      moaSlotComplete(preset.aggregator)
  )

interface MoaEditingProps {
  moa: MoaConfigResponse | null
  selectedMoaPreset: string
  scopeProfile?: string
  profileEpoch: RefObject<number>
  loadFailed: string
  setMoa: (value: MoaConfigResponse) => void
  setApplying: (value: boolean) => void
  setError: (value: string) => void
  setCaughtError: (error: unknown, fallback: string) => void
}

export function useMoaEditing({
  moa,
  selectedMoaPreset,
  scopeProfile,
  profileEpoch,
  loadFailed,
  setMoa,
  setApplying,
  setError,
  setCaughtError
}: MoaEditingProps) {
  const currentMoaPreset = useMemo(() => {
    if (!moa) {
      return null
    }

    return moa.presets[selectedMoaPreset] || moa.presets[moa.default_preset] || Object.values(moa.presets)[0] || null
  }, [moa, selectedMoaPreset])

  // Mirror of `moa` so inline edits compute the next state purely (outside the
  // setState updater) and hand it straight to the debounced autosave.
  const moaRef = useRef<MoaConfigResponse | null>(null)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    moaRef.current = moa
  }, [moa])

  const moaSaveTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (moaSaveTimer.current) {
        window.clearTimeout(moaSaveTimer.current)
      }
    },
    []
  )

  // Guard against stale save responses overwriting newer state.
  const moaSaveGeneration = useRef(0)

  // Quiet debounced persist for inline MoA edits — mirrors the config page's
  // autosave so slot/aggregator tweaks save themselves, matching the
  // preset-level ops (set default / add / delete) that already persist on
  // click. No `applying` spinner, so selecting stays responsive.
  //
  // While any slot is half-filled (provider picked, model pending) the save is
  // HELD, not sent: the previous complete config stays on disk and the next
  // edit that completes the slot flushes the whole preset. Every edit bumps
  // the generation so an in-flight response from an older save can never
  // repaint over the user's mid-edit state.
  const scheduleMoaSave = useCallback(
    (next: MoaConfigResponse) => {
      if (moaSaveTimer.current) {
        window.clearTimeout(moaSaveTimer.current)
        moaSaveTimer.current = null
      }

      const generation = moaSaveGeneration.current + 1
      moaSaveGeneration.current = generation

      if (!moaConfigComplete(next)) {
        return
      }

      moaSaveTimer.current = window.setTimeout(() => {
        void saveMoaModels(next, scopeProfile)
          .then(saved => {
            if (moaSaveGeneration.current === generation) {
              setMoa(saved)
            }
          })
          .catch(err => {
            if (moaSaveGeneration.current === generation) {
              setCaughtError(err, loadFailed)
            }
          })
      }, 600)
    },
    [loadFailed, scopeProfile, setCaughtError, setMoa]
  )

  const updateMoaPreset = useCallback(
    (updater: (preset: NonNullable<typeof currentMoaPreset>) => NonNullable<typeof currentMoaPreset>) => {
      const prev = moaRef.current

      if (!prev || !selectedMoaPreset || !prev.presets[selectedMoaPreset]) {
        return
      }

      const next: MoaConfigResponse = {
        ...prev,
        presets: {
          ...prev.presets,
          [selectedMoaPreset]: updater(prev.presets[selectedMoaPreset])
        }
      }

      moaRef.current = next
      setMoa(next)
      scheduleMoaSave(next)
    },
    [scheduleMoaSave, selectedMoaPreset, setMoa]
  )

  const updateMoaSlot = useCallback((slot: MoaModelSlot, patch: Partial<MoaModelSlot>): MoaModelSlot => {
    const next = { ...slot, ...patch }

    // Picking a new provider invalidates the model choice (models are
    // per-provider). A same-provider update must not wipe the model — Radix
    // filters same-value changes, but programmatic callers may not.
    if (patch.provider && patch.provider !== slot.provider) {
      next.model = ''
    }

    return next
  }, [])

  const saveMoa = useCallback(
    async (next: MoaConfigResponse) => {
      const epoch = profileEpoch.current

      // Explicit preset ops (set default / add / delete) supersede any pending
      // debounced slot autosave — cancel it and invalidate in-flight responses
      // so the two writers can't race each other's state.
      if (moaSaveTimer.current) {
        window.clearTimeout(moaSaveTimer.current)
        moaSaveTimer.current = null
      }

      moaSaveGeneration.current += 1
      setApplying(true)
      setError('')

      try {
        const saved = await saveMoaModels(next, scopeProfile)

        if (profileEpoch.current !== epoch) {
          return
        }

        setMoa(saved)
      } catch (err) {
        setCaughtError(err, loadFailed)
      } finally {
        setApplying(false)
      }
    },
    [loadFailed, scopeProfile, setCaughtError, profileEpoch, setApplying, setError, setMoa]
  )

  return { currentMoaPreset, updateMoaPreset, updateMoaSlot, saveMoa }
}
