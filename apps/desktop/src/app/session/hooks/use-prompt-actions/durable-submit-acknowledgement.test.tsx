import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLatestSessionMessages } from '@/hermes'
import { $composerAttachments } from '@/store/composer'
import { $connection, $sessions } from '@/store/session'

import { actRender, Harness, type HarnessHandle, RUNTIME_SESSION_ID } from './index-test-utils'
import { clearStoredJournal } from './prepared-submissions-test-utils'
import { clearSingleFlightSessionResumeState } from './single-flight-resume'

// Suites in this file reuse the same stored-id constants. The module-level single-flight resume map
// (and drift-recovery cache) would otherwise leak a never-settling in-flight promise from one test into the next.
beforeEach(() => {
  clearSingleFlightSessionResumeState()
  clearStoredJournal()
  // Queue mutations build on the persisted map, not the atom — a queue an
  // earlier test left in storage would otherwise sit ahead of this test's send.
  window.localStorage.removeItem('hermes.desktop.composerQueue.v1')
  vi.mocked(getLatestSessionMessages).mockReset()
  vi.mocked(getLatestSessionMessages).mockImplementation(async () => ({ messages: [], session_id: 'session' }))
})

vi.mock('@/hermes', () => ({
  getLatestSessionMessages: vi.fn(async () => ({ messages: [], session_id: 'session' })),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  getSession: vi.fn(),
  PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000,
  setApiRequestProfile: vi.fn(),
  transcribeAudio: vi.fn()
}))

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForSessionTurn: vi.fn(async () => () => undefined)
}))

// Every typed command also fires this (fire-and-forget); these tests assert the command's own traffic.
const SLASH_METRIC = 'shared_metrics.slash_command'

describe('durable submit acknowledgement', () => {
  it('retires the native private-file journal only after a matching canonical receipt', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    vi.doMock('electron', () => ({ app: {}, ipcMain: {} }))
    // Exercise the native module at runtime without importing its separate,
    // non-strict Electron project into the renderer's TypeScript project.
    const nativeJournalModule = '../../../../../electron/prepared-submissions'
    const { preparedJournal } = await import(nativeJournalModule)
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-retire-'))
    const journal = preparedJournal(home, 'http://native-fixture')
    const previous = window.hermesDesktop
    window.hermesDesktop = {
      ...previous,
      preparedSubmissions: {
        read: async () => JSON.stringify(journal.read()),
        update: async (key, entry) => {
          journal.update(key, entry === null ? null : JSON.parse(entry))
        }
      }
    }
    let accepted = false

    const requestGateway = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      expect(Object.values(journal.read())).toHaveLength(1)

      return {
        admission_id: 'server-admission',
        submission_id: accepted ? params?.submission_id : 'other-input',
        session_id: params?.session_id,
        status: 'queued'
      } as never
    })

    try {
      let handle: HarnessHandle | null = null
      await actRender(
        <Harness
          onReady={h => (handle = h)}
          rawAdmissionReceipts
          refreshSessions={async () => undefined}
          requestGateway={requestGateway}
        />
      )
      const options = { fromQueue: true, submission_id: 'private-file-input' }
      expect(await handle!.submitText('native journal receipt', options)).toBe(false)
      expect(Object.values(preparedJournal(home, 'http://native-fixture').read())).toHaveLength(1)
      accepted = true
      expect(await handle!.submitText('native journal receipt', options)).toBe(true)
      expect(preparedJournal(home, 'http://native-fixture').read()).toEqual({})
      expect(fs.readdirSync(home)).toHaveLength(1)
    } finally {
      window.hermesDesktop = previous
      fs.rmSync(home, { recursive: true, force: true })
      vi.doUnmock('electron')
    }
  })

  it('a journal retirement that fails after admission still reports the delivered prompt and never reuses its identity', async () => {
    const entries = new Map<string, string>()
    const previous = window.hermesDesktop
    // The private-file journal accepts the preparation write, then the disk fills before retirement.
    window.hermesDesktop = {
      ...previous,
      preparedSubmissions: {
        read: async () =>
          JSON.stringify(Object.fromEntries([...entries].map(([key, entry]) => [key, JSON.parse(entry)]))),
        update: async (key, entry) => {
          if (entry === null) {
            throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
          }

          entries.set(key, entry)
        }
      }
    }
    const ids: unknown[] = []

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method !== 'prompt.submit') {
        return {} as never
      }

      ids.push(params?.submission_id)

      return { admission_id: params?.submission_id, status: 'started' } as never
    })

    try {
      let handle: HarnessHandle | null = null
      await actRender(
        <Harness
          onReady={h => (handle = h)}
          rawAdmissionReceipts
          refreshSessions={async () => undefined}
          requestGateway={requestGateway}
        />
      )
      const accepted = vi.fn()
      expect(await handle!.submitText('delivered once', { onAccepted: accepted })).toBe(true)
      expect(accepted).toHaveBeenCalledTimes(1)
      expect(handle!.state().messages.some(message => message.error)).toBe(false)
      // A later identical send is a new turn, never deduplicated into the spent admission.
      handle!.handleEvent({
        type: 'message.complete',
        session_id: RUNTIME_SESSION_ID,
        payload: { text: 'done' }
      } as never)
      expect(await handle!.submitText('delivered once')).toBe(true)
      expect(ids).toHaveLength(2)
      expect(ids[1]).not.toBe(ids[0])
    } finally {
      window.hermesDesktop = previous
    }
  })

  it('retains a failed slash kickoff and forwards queued admission intent on retry', async () => {
    $sessions.set([])
    $connection.set(null)
    $composerAttachments.set([])

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'slash.exec') {
        return { type: 'skill', name: 'private-skill', message: 'expanded skill' } as never
      }

      return { admission_id: 'other-input', status: 'queued' } as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness onReady={h => (handle = h)} refreshSessions={async () => undefined} requestGateway={requestGateway} />
    )
    expect(await handle!.submitText('/private-skill', { fromQueue: true, submission_id: 'queued-skill' })).toBe(false)
    expect(requestGateway.mock.calls.find(call => call[0] === 'prompt.submit')?.[1]).toMatchObject({
      queued: true,
      submission_id: 'queued-skill'
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each([
    [{}, false],
    [{ admission_id: 'other', status: 'queued' }, false],
    [{ admission_id: 'entry-id', status: 'queued' }, true],
    [{ admission_id: 'entry-id', status: 'started' }, true],
    [{ admission_id: 'entry-id', status: 'terminal' }, true],
    [
      {
        admission_id: 'canonical-admission',
        submission_id: 'entry-id',
        session_id: RUNTIME_SESSION_ID,
        status: 'queued'
      },
      true
    ],
    [
      {
        admission_id: 'canonical-admission',
        submission_id: 'entry-id',
        session_id: 'wrong-destination',
        status: 'queued'
      },
      false
    ],
    // An exact retry of an admission the owner lost mid-turn: admitted, never replayed (Discard resolves it).
    [{ admission_id: 'entry-id', status: 'unknown' }, true]
  ])('requires the matching authoritative receipt: %j', async (receipt, accepted) => {
    const requestGateway = vi.fn(async () => receipt as never)
    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        rawAdmissionReceipts
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )
    const options = { fromQueue: true, submission_id: 'entry-id' }
    expect(await handle!.submitText('keep this input', options)).toBe(accepted)
    expect(requestGateway).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({ submission_id: 'entry-id', queued: true }),
      expect.any(Number)
    )
  })

  it('a legacy backend refusing submission_id as version skew (4000) gets one identityless retry', async () => {
    // `hermes serve` validates params against a strict contract: an unknown key is refused
    // as 4000 before any handler ran (surfaced by the remote-topology E2E as "Session unavailable").
    const submits: Array<Record<string, unknown>> = []

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method !== 'prompt.submit') {
        return {} as never
      }

      submits.push(params!)

      if ('submission_id' in params!) {
        throw Object.assign(
          new Error(
            'invalid params for prompt.submit: submission_id: Extra inputs are not permitted — the client and the Hermes backend are out of sync (different versions)'
          ),
          { code: 4000 }
        )
      }

      return { status: 'streaming' } as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        rawAdmissionReceipts
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )
    expect(await handle!.submitText('hi remote')).toBe(true)
    expect(submits).toHaveLength(2)
    expect(submits[1]).not.toHaveProperty('submission_id')
    expect(submits[1]).toMatchObject({ text: 'hi remote' })
  })
})
