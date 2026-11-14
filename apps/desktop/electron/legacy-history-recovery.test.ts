import { describe, expect, it, vi } from 'vitest'

import { createLegacyHistoryRecovery } from './legacy-history-recovery'

function harness() {
  let revision = 1
  const owner = { userId: '10', mode: 'production' as const, revision: 1 }

  const run = vi.fn(async (input: Record<string, unknown>): Promise<any> => {
    if (input.action === 'prepare') {
      return { planId: 'plan', conflicts: 0, groups: [{ name: 'default', batches: [[{ id: 'old', messages: [] }]] }] }
    }

    if (input.action === 'backup') {
      return { backupPath: '/backups/history' }
    }

    if (input.action === 'remind') {
      return { ok: true, reminderKey: 'batch', showReminder: false, snoozedUntil: null }
    }

    return { planId: 'plan', owned: 1, unowned: 0, foreign: 1, conflicts: 0, profiles: 1, pending: 0 }
  })

  const request = vi.fn(async (_profile: string, _path: string, _body?: unknown): Promise<any> => ({
    ok: true,
    imported: 1,
    skipped: 0,
    imported_ids: ['old'],
    errors: []
  }))

  const capture = (expected: typeof owner) => {
    if (expected.revision !== revision) {
      throw new Error('platform_account_changed')
    }

    return {
      sourceHome: '/legacy',
      targetHome: '/account/10',
      userData: '/app',
      origin: 'https://api.example',
      owner: { ...expected },
      isCurrent: () => revision === expected.revision
    }
  }

  return {
    owner,
    run,
    request,
    changeAccount: () => revision++,
    controller: createLegacyHistoryRecovery({ capture, run, request })
  }
}

describe('legacy chat recovery', () => {
  it('persists a reminder choice for the captured account without importing any records', async () => {
    const h = harness()
    h.run.mockResolvedValueOnce({ ok: true, reminderKey: 'batch', showReminder: false, snoozedUntil: null })
    await expect(h.controller.remind({ expectedOwner: h.owner, planId: 'plan', choice: 'ignore' })).resolves.toMatchObject({
      reminderKey: 'batch', showReminder: false
    })
    expect(h.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'remind', plan_id: 'plan', choice: 'ignore',
      owner: { platform_origin: 'https://api.example', user_id: '10' }
    }), expect.anything())
    expect(h.request).not.toHaveBeenCalled()
  })

  it('rejects invalid reminder choices and stale account results', async () => {
    const h = harness()
    await expect(h.controller.remind({ expectedOwner: h.owner, planId: 'plan', choice: 'delete' as any }))
      .rejects.toThrow('invalid_platform_input')
    expect(h.run).not.toHaveBeenCalled()
    h.run.mockImplementationOnce(async () => {
      h.changeAccount()
      return { ok: true, showReminder: false }
    })
    await expect(h.controller.remind({ expectedOwner: h.owner, planId: 'plan', choice: 'later' }))
      .rejects.toThrow('platform_account_changed')
    expect(h.request).not.toHaveBeenCalled()
  })

  it('serializes reminder writes behind inspection and excludes concurrent imports', async () => {
    const h = harness()
    let release!: (value: unknown) => void
    h.run.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const inspection = h.controller.inspect(h.owner)
    const reminder = h.controller.remind({ expectedOwner: h.owner, planId: 'plan', choice: 'later' })
    await expect(h.controller.restore({ expectedOwner: h.owner, planId: 'plan', includeUnowned: false }))
      .rejects.toThrow('history_recovery_busy')
    expect(h.run).toHaveBeenCalledTimes(1)
    release({ planId: 'plan' })
    await inspection
    await reminder
    expect(h.run.mock.calls.map(([input]) => input.action)).toEqual(['inspect', 'remind'])
    expect(h.request).not.toHaveBeenCalled()
  })

  it('backs up before using the existing import API, with a stable retry identity', async () => {
    const h = harness()
    const input = { expectedOwner: h.owner, planId: 'plan', includeUnowned: false }
    const result = await h.controller.restore(input)
    expect(result.imported).toBe(1)
    expect(h.run.mock.calls.map(([input]) => input.action)).toEqual(['prepare', 'backup'])
    expect(h.run.mock.invocationCallOrder[1]).toBeLessThan(h.request.mock.invocationCallOrder[0])
    const first = h.request.mock.calls[0][2] as any
    expect(first.sessions[0].id).toBe('old')
    expect(first.expected_revision).toBe(0)
    await h.controller.restore(input)
    expect((h.request.mock.calls[1][2] as any).request_id).toBe(first.request_id)
    expect(h.run.mock.calls[0][0]).toMatchObject({
      source_home: '/legacy',
      target_home: '/account/10',
      confirm_unowned: false
    })
  })

  it('refuses an import after the account changes during snapshot preparation', async () => {
    const h = harness()
    h.run.mockImplementationOnce(async () => {
      h.changeAccount()

      return { groups: [{ name: 'default', batches: [[{ id: 'old', messages: [] }]] }] }
    })
    await expect(
      h.controller.restore({ expectedOwner: h.owner, planId: 'plan', includeUnowned: true })
    ).rejects.toThrow('platform_account_changed')
    expect(h.request).not.toHaveBeenCalled()
    expect(h.run).toHaveBeenCalledTimes(1)
  })

  it('does not report success if the existing importer rejects a batch', async () => {
    const h = harness()
    h.request.mockResolvedValueOnce({ ok: false, errors: ['rejected'] })
    await expect(
      h.controller.restore({ expectedOwner: h.owner, planId: 'plan', includeUnowned: false })
    ).rejects.toThrow('history_import_failed')
  })

  it('continues bounded preparation pages while keeping one original backup per profile', async () => {
    const h = harness()
    let page = 0
    h.run.mockImplementation(async input => {
      if (input.action === 'backup') {
        return { backupPath: '/backups/history' }
      }

      page++

      return { more: page === 1, groups: [{ name: 'default', batches: [[{ id: `old-${page}`, messages: [] }]] }] }
    })
    const result = await h.controller.restore({ expectedOwner: h.owner, planId: 'plan', includeUnowned: false })
    expect(result.imported).toBe(2)
    expect(h.run.mock.calls.map(([input]) => input.action)).toEqual(['prepare', 'backup', 'prepare'])
    expect(h.request).toHaveBeenCalledTimes(2)
  })

  it('coalesces native inspections across windows instead of duplicating full database snapshots', async () => {
    const h = harness()
    let release!: (value: unknown) => void
    h.run.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve
        })
    )
    const first = h.controller.inspect(h.owner)
    const second = h.controller.inspect(h.owner)
    expect(first).toBe(second)
    expect(h.run).toHaveBeenCalledOnce()
    release({ planId: 'plan', owned: 1, unowned: 0, foreign: 0, conflicts: 0, profiles: 1, pending: 0 })
    await first
  })

  it('starts a fresh inspection after credential readiness advances the account revision', async () => {
    const h = harness()
    let release!: (value: unknown) => void
    h.run.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const oldScan = h.controller.inspect(h.owner)
    h.changeAccount()
    const fresh = h.controller.inspect({ ...h.owner, revision: 2 })
    expect(h.run).toHaveBeenCalledTimes(1)
    release({ planId: 'stale', owned: 9 })
    await expect(oldScan).rejects.toThrow('platform_account_changed')
    await expect(fresh).resolves.toMatchObject({ planId: 'plan', owned: 1 })
    expect(h.run).toHaveBeenCalledTimes(2)
  })
})
