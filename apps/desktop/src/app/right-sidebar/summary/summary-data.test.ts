import { describe, expect, it } from 'vitest'

import type { LocalHardware } from '@/types/hermes'

import { hardwareMeters, summaryContextUsage, summaryEnvironmentState } from './summary-data'

describe('summary data helpers', () => {
  it('does not expose a previous workspace while ownership is changing', () => {
    expect(
      summaryEnvironmentState({ cwd: '/old', cwdOwner: 'old', projectName: 'Old', selectedSession: 'new' })
    ).toEqual({ kind: 'empty' })
  })

  it('does not promote an incidental cwd into a project', () => {
    expect(
      summaryEnvironmentState({ cwd: '/desktop', cwdOwner: 'session', projectName: null, selectedSession: 'session' })
    ).toEqual({ kind: 'empty' })
  })

  it('keeps unavailable hardware distinct from zero usage', () => {
    expect(hardwareMeters(null)).toEqual({ kind: 'unavailable' })

    const emptyHardware: LocalHardware = {
      gpu_name: null,
      gpu_util_percent: null,
      ram_available_bytes: 0,
      ram_total_bytes: 0,
      uma: false,
      vram_label: '',
      vram_total_bytes: 0,
      vram_usable_bytes: 0,
      vram_used_bytes: null
    }

    expect(hardwareMeters(emptyHardware)).toEqual({ kind: 'ready', ramPercent: null, vramPercent: null })
  })

  it('fills missing occupancy and applies the latest capacity without replacing measured tokens', () => {
    const breakdown = {
      categories: [],
      context_estimated: true,
      context_max: 200_000,
      context_percent: 25,
      context_used: 50_000,
      estimated_total: 50_000
    }

    expect(summaryContextUsage({ calls: 0, input: 0, output: 0, total: 0 }, breakdown)).toMatchObject({
      context_estimated: true,
      context_max: 200_000,
      context_percent: 25,
      context_used: 50_000
    })
    expect(
      summaryContextUsage(
        { calls: 1, context_max: 100_000, context_percent: 80, context_used: 80_000, input: 0, output: 0, total: 0 },
        breakdown
      )
    ).toMatchObject({ context_max: 200_000, context_percent: 40, context_used: 80_000 })
  })
})
