import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $approvalModes, approvalModeForProfile, reconcileApprovalModeForProfile } from '@/store/approval-mode'
import * as gateway from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'

import { applyRuntimeInfo } from './runtime-info'

describe('applyRuntimeInfo approval mode owner scoping', () => {
  beforeEach(() => {
    $approvalModes.set({})
    $activeGatewayProfile.set('work')
  })

  afterEach(() => vi.restoreAllMocks())

  it('uses a captured runtime owner and backend target profile after the active connection changes', () => {
    const connection = vi.spyOn(gateway, 'activeGatewayConnectionId').mockReturnValue('local')
    reconcileApprovalModeForProfile('work', 'manual', 'local')
    reconcileApprovalModeForProfile('switched', 'manual', 'studio')

    applyRuntimeInfo(
      { approval_mode: 'off' },
      { foreground: false, owner: { connectionId: 'studio', profile: 'desktop-alias', targetProfile: 'work' } }
    )
    expect(approvalModeForProfile('work', 'studio')).toBe('off')
    expect(approvalModeForProfile('work', 'local')).toBe('manual')

    connection.mockReturnValue('studio')
    $activeGatewayProfile.set('switched')
    applyRuntimeInfo(
      { approval_mode: 'smart' },
      { foreground: false, owner: { connectionId: 'local', profile: 'work' } }
    )

    expect(approvalModeForProfile('work', 'local')).toBe('smart')
    expect(approvalModeForProfile('work', 'studio')).toBe('off')
    expect(approvalModeForProfile('switched', 'studio')).toBe('manual')
  })

  it('never lets another backend runtime set the active profile approval chip', () => {
    applyRuntimeInfo({ approval_mode: 'manual' })

    // A bot tile, a branch of a bot chat, an All-profiles resume, and a
    // same-named profile on another connection all report THEIR config.
    applyRuntimeInfo({ approval_mode: 'off' }, { foreground: false, owner: { connectionId: 'local', profile: 'bot' } })
    applyRuntimeInfo({ approval_mode: 'off' }, { owner: 'bot' })
    applyRuntimeInfo({ approval_mode: 'off' }, { owner: { connectionId: 'ssh-box', profile: 'work' } })

    expect(approvalModeForProfile('work')).toBe('manual')

    applyRuntimeInfo({ approval_mode: 'off' }, { owner: { connectionId: 'local', profile: 'work' } })

    expect(approvalModeForProfile('work', 'local')).toBe('off')
    expect(approvalModeForProfile('work')).toBe('manual')

    // The active socket is (ssh-box, work); a bare 'work' owner dialled the profile-only door.
    const connection = vi.spyOn(gateway, 'activeGatewayConnectionId').mockReturnValue('ssh-box')
    applyRuntimeInfo({ approval_mode: 'manual' })

    try {
      applyRuntimeInfo({ approval_mode: 'off' }, { owner: 'work' })
      expect(approvalModeForProfile('work', 'ssh-box')).toBe('manual')

      applyRuntimeInfo({ approval_mode: 'off' }, { owner: { connectionId: 'ssh-box', profile: 'work' } })
      expect(approvalModeForProfile('work', 'ssh-box')).toBe('off')
    } finally {
      connection.mockRestore()
    }
  })
})
