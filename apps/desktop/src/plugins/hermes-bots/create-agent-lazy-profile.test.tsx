/**
 * New Bot creates its profile LAZILY. Two contracts hang off that:
 *
 *  - MCP OAuth / API-key credentials must be configurable DURING creation
 *    rather than forcing create-then-edit, so the setup button materializes
 *    the profile through `ensureAgentCreated()` on its first action. The
 *    creation is single-flighted and idempotent: whichever door fires first
 *    (a setup click, the Capabilities tab, or Create Bot itself) is the only
 *    `profiles.create` the dialog ever sends.
 *  - `reset()` has to restore the SAME clone source the dialog mounted with.
 *    It restored '__none__' instead: the first open cloned the main profile,
 *    every later open after a create or cancel silently started fresh.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as DataModule from './data'
import { translateBots } from './i18n-test-helper'
import type { RosterRow } from './types'

interface CapabilitiesViewProps {
  fixedConnection?: string
  fixedProfile?: string
}

const mocks = vi.hoisted(() => ({
  activeSource: { connectionId: '', profile: 'default' },
  connections: vi.fn(async () => [] as { id: string; label: string }[]),
  deleteBot: vi.fn(async () => undefined),
  dropLeftoverProfilePrefs: vi.fn(),
  /** Flipped off to model a desktop build that predates the live surface. */
  hasCapabilitiesView: { value: true },
  notify: vi.fn(),
  notifyError: vi.fn(),
  openRosterBot: vi.fn(async () => true),
  request: vi.fn(),
  requestProfile: vi.fn(async () => ({})),
  modelConfirm: vi.fn(async (_options: { requestConfirmed: () => Promise<unknown> }) => false),
  saveBotMeta: vi.fn(),
  skillsView: [] as CapabilitiesViewProps[]
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const original = await importOriginal<typeof HermesSdk>()

  const CapabilitiesViewStub = (props: CapabilitiesViewProps) => {
    mocks.skillsView.push(props)

    return null
  }

  // Builds that route `fixedConnection` get the live Capabilities tab for
  // remote targets too, pinned to the target machine's backend.
  CapabilitiesViewStub.supportsFixedConnection = true

  const mocked: Record<string, unknown> = {
    ...original,
    host: {
      ...original.host,
      agents: async () => {
        throw new Error('no union roster')
      },
      profileRoutes: async () => [],
      state: {
        ...original.host.state,
        connectionId: { ...original.host.state.connectionId, get: () => mocks.activeSource.connectionId },
        profile: { ...original.host.state.profile, get: () => mocks.activeSource.profile }
      },
      connections: mocks.connections,
      dropLeftoverProfilePrefs: mocks.dropLeftoverProfilePrefs,
      notify: mocks.notify,
      notifyError: mocks.notifyError,
      request: mocks.request,
      requestProfile: mocks.requestProfile
    },
    // The plugin bundle normally lands via `ctx.i18n.register` at load.
    usePluginI18n: () => translateBots
  }

  mocked.surfaceModelSwitchConfirm = mocks.modelConfirm

  Object.defineProperty(mocked, 'CapabilitiesView', {
    configurable: true,
    enumerable: true,
    get: () => (mocks.hasCapabilitiesView.value ? CapabilitiesViewStub : undefined)
  })

  return mocked
})

vi.mock('./roster-actions', () => ({ openRosterBot: mocks.openRosterBot }))
vi.mock('./profile-ops', () => ({ deleteBot: mocks.deleteBot, mergeServerMeta: vi.fn() }))
vi.mock('./data', async importOriginal => {
  const original = await importOriginal<typeof DataModule>()

  return { ...original, saveBotMeta: mocks.saveBotMeta }
})

// Each build re-imports the dialog's whole module graph.
vi.setConfig({ testTimeout: 30_000 })

const roster: RosterRow[] = [{ connectionId: 'local', name: 'default' }]

/** A catalog entry that needs an API key — the only row that renders setup. */
const catalog = { auth: null, installed: false, name: 'linear', requires: ['LINEAR_API_KEY'] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })

  return { promise, resolve, reject }
}

function withQueryClient(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

async function renderDialog(hasCapabilitiesView: boolean, onConfigureModel?: (bot: RosterRow) => void) {
  mocks.hasCapabilitiesView.value = hasCapabilitiesView
  vi.resetModules()

  const { CreateAgentDialog } = await import('./create-dialog')

  const view = render(
    withQueryClient(
      <CreateAgentDialog onClose={() => undefined} onConfigureModel={onConfigureModel} open roster={roster} />
    )
  )

  fireEvent.change(screen.getByPlaceholderText('inbox-triage'), { target: { value: 'inbox-triage' } })
  fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

  return view
}

function createCalls() {
  return mocks.request.mock.calls.filter(([method]) => method === 'profiles.create')
}

/** The control under a `labeled(...)` caption — the label is presentational,
 *  so it carries no `for`/`id` pair to query by. */
function controlUnder(caption: string) {
  return screen.getByText(caption).parentElement!.querySelector('[role="combobox"]') as HTMLElement
}

beforeAll(async () => {
  // Radix Select/Dialog reach for APIs jsdom does not implement.
  Element.prototype.scrollIntoView = () => undefined
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.setPointerCapture = () => undefined
  // Warm the transform cache so the first test isn't charged for it.
  await import('./create-dialog')
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.activeSource.connectionId = ''
  mocks.activeSource.profile = 'default'
  mocks.skillsView.length = 0
  mocks.connections.mockResolvedValue([])
  mocks.requestProfile.mockResolvedValue({})
  mocks.deleteBot.mockResolvedValue(undefined)
  mocks.modelConfirm.mockResolvedValue(false)
  mocks.request.mockImplementation(async (method: string) => {
    switch (method) {
      case 'mcp.catalog':
        return { servers: [catalog] }

      case 'mcp.servers.test':
        return { ok: true }

      case 'profiles.describe':
        return { mcp_servers: [], skills: [], toolsets: [] }

      default:
        return {}
    }
  })
})

describe('final model choice after configuring a draft', () => {
  const pickModel = (provider = 'custom:relay', model = 'final-model') => {
    fireEvent.change(screen.getByPlaceholderText('omnirouter / 9router / nous …'), { target: { value: provider } })
    fireEvent.change(screen.getByPlaceholderText('antigravity/gemini-3.6-flash-high'), { target: { value: model } })
  }

  async function materialize() {
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() => expect(createCalls()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'General' }))
    await screen.findByPlaceholderText('omnirouter / 9router / nous …')
  }

  it('saves a model picked after MCP/capability setup before checking readiness or starting the intro', async () => {
    await renderDialog(true)
    await materialize()
    pickModel()
    mocks.request.mockImplementation(async (method: string) =>
      method === 'profiles.configure' ? { applied: { model: true } } : { ok: true }
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() => expect(mocks.openRosterBot).toHaveBeenCalledOnce())
    const methods = mocks.request.mock.calls.map(([method]) => method)
    expect(mocks.request).toHaveBeenCalledWith('profiles.configure', {
      name: 'inbox-triage',
      model: 'final-model',
      provider: 'custom:relay'
    })
    expect(methods.indexOf('profiles.configure')).toBeLessThan(methods.indexOf('setup.runtime_check'))
    expect(createCalls()).toHaveLength(1)
    expect(createCalls()[0][1]).not.toHaveProperty('model')
    expect(mocks.deleteBot).not.toHaveBeenCalled()
  })

  it('keeps the inherited configuration when an early explicit pick is cleared before final creation', async () => {
    await renderDialog(true)
    await screen.findByPlaceholderText('omnirouter / 9router / nous …')
    pickModel()
    await materialize()
    pickModel('', '')
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() => expect(mocks.openRosterBot).toHaveBeenCalledOnce())
    expect(createCalls()[0][1]).not.toHaveProperty('model')
    expect(createCalls()[0][1]).not.toHaveProperty('provider')
    expect(mocks.request.mock.calls.some(([method, params]) => method === 'profiles.configure' && params.model)).toBe(
      false
    )
  })

  it('awaits model confirmation, keeps the draft on decline, and retries without creating a duplicate', async () => {
    await renderDialog(true)
    await materialize()
    pickModel()
    mocks.request.mockImplementation(async (method: string, params) =>
      method === 'profiles.configure'
        ? params.confirm_expensive_model
          ? { applied: { model: true } }
          : { confirm_required: true, confirm_message: 'Confirm model cost' }
        : { ok: true }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() => expect(mocks.modelConfirm).toHaveBeenCalledOnce())
    expect(mocks.openRosterBot).not.toHaveBeenCalled()
    expect(mocks.request.mock.calls.some(([method]) => method === 'setup.runtime_check')).toBe(false)
    mocks.modelConfirm.mockImplementationOnce(async options => {
      await options.requestConfirmed()

      return true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    await waitFor(() => expect(mocks.openRosterBot).toHaveBeenCalledOnce())
    expect(createCalls()).toHaveLength(1)
  })

  it('retains the draft and does not start inference when the final model write fails', async () => {
    await renderDialog(true)
    await materialize()
    pickModel()
    mocks.request.mockResolvedValue({ applied: { model: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await screen.findByText('Model switch failed')
    expect(mocks.openRosterBot).not.toHaveBeenCalled()
    expect(mocks.request.mock.calls.some(([method]) => method === 'setup.runtime_check')).toBe(false)
    expect(createCalls()).toHaveLength(1)
  })

  it.each([
    ['custom:relay', ''],
    ['', 'final-model']
  ])('rejects a partial choice (%s, %s) instead of silently using inheritance', async (provider, model) => {
    await renderDialog(true)
    await materialize()
    pickModel(provider, model)
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    await screen.findByText('Model switch failed')
    expect(mocks.openRosterBot).not.toHaveBeenCalled()
    expect(mocks.request.mock.calls.some(([method]) => method === 'profiles.configure')).toBe(false)
  })

  it('locks staged fields while saving and retires a successful creation after the source changes', async () => {
    await renderDialog(true)
    await materialize()
    pickModel()
    const saved = deferred<{ applied: { model: boolean } }>()
    mocks.request.mockImplementation(async (method: string) => (method === 'profiles.configure' ? saved.promise : {}))
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('profiles.configure', expect.anything()))
    expect(
      (screen.getByPlaceholderText('omnirouter / 9router / nous …').closest('fieldset') as HTMLFieldSetElement).disabled
    ).toBe(true)
    mocks.activeSource.connectionId = 'another-source'
    saved.resolve({ applied: { model: true } })
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })))
    expect(mocks.openRosterBot).not.toHaveBeenCalled()
    expect(mocks.request.mock.calls.some(([method]) => method === 'setup.runtime_check')).toBe(false)
    expect((screen.getByPlaceholderText('inbox-triage') as HTMLInputElement).value).toBe('')
  })

  it('applies the final model after renaming a materialized draft without treating its own reset as stale', async () => {
    await renderDialog(true)
    await materialize()
    pickModel()
    fireEvent.change(screen.getByPlaceholderText('inbox-triage'), { target: { value: 'renamed-bot' } })
    mocks.request.mockImplementation(async (method: string) =>
      method === 'profiles.configure' ? { applied: { model: true } } : { ok: true }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    await waitFor(() =>
      expect(mocks.openRosterBot).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'renamed-bot' }),
        expect.anything()
      )
    )
    expect(mocks.deleteBot).toHaveBeenCalledWith({ name: 'inbox-triage' })
    expect(createCalls().map(([, params]) => params.name)).toEqual(['inbox-triage', 'renamed-bot'])
    expect(mocks.request).toHaveBeenCalledWith('profiles.configure', {
      name: 'renamed-bot',
      model: 'final-model',
      provider: 'custom:relay'
    })
  })

  it.each(['success', 'failure'])(
    'does not let an old %s completion close or unlock a newly opened creation',
    async outcome => {
      const oldView = await renderDialog(true)
      await materialize()
      pickModel()
      const oldSave = deferred<{ applied: { model: boolean } }>()
      mocks.request.mockImplementation(async (method: string) =>
        method === 'profiles.configure' ? oldSave.promise : {}
      )
      fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
      await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('profiles.configure', expect.anything()))
      oldView.unmount()

      await renderDialog(true)
      await screen.findByPlaceholderText('omnirouter / 9router / nous …')
      pickModel('custom:new-relay', 'new-model')
      const newSave = deferred<{ applied: { model: boolean } }>()
      mocks.request.mockImplementation(async (method: string) =>
        method === 'profiles.configure' ? newSave.promise : {}
      )
      fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
      await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
          'profiles.configure',
          expect.objectContaining({ model: 'new-model' })
        )
      )
      await act(async () => {
        if (outcome === 'success') {
          oldSave.resolve({ applied: { model: true } })
        } else {
          oldSave.reject(new Error('Old model failed'))
        }
      })

      expect(
        (screen.getByPlaceholderText('omnirouter / 9router / nous …').closest('fieldset') as HTMLFieldSetElement)
          .disabled
      ).toBe(true)
      expect((screen.getByPlaceholderText('inbox-triage') as HTMLInputElement).value).toBe('inbox-triage')
      expect(mocks.openRosterBot).not.toHaveBeenCalled()
      expect(mocks.notify).not.toHaveBeenCalled()
      expect(screen.queryByText('Old model failed')).toBeNull()
      newSave.resolve({ applied: { model: true } })
      await waitFor(() => expect(mocks.openRosterBot).toHaveBeenCalledOnce())
    }
  )

  it('does not let an old readiness response finish a newer creation dialog', async () => {
    const oldView = await renderDialog(true)
    const oldReadiness = deferred<{ ok: boolean }>()
    mocks.request.mockImplementation(async (method: string) =>
      method === 'setup.runtime_check' ? oldReadiness.promise : {}
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('setup.runtime_check', expect.anything()))
    oldView.unmount()

    await renderDialog(true)
    await screen.findByPlaceholderText('omnirouter / 9router / nous …')
    pickModel()
    const newSave = deferred<{ applied: { model: boolean } }>()
    mocks.request.mockImplementation(async (method: string) => (method === 'profiles.configure' ? newSave.promise : {}))
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('profiles.configure', expect.anything()))
    await act(async () => oldReadiness.resolve({ ok: true }))

    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.openRosterBot).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText('inbox-triage') as HTMLInputElement).value).toBe('inbox-triage')
    expect(
      (screen.getByPlaceholderText('omnirouter / 9router / nous …').closest('fieldset') as HTMLFieldSetElement).disabled
    ).toBe(true)
    newSave.resolve({ applied: { model: true } })
    await waitFor(() => expect(mocks.openRosterBot).toHaveBeenCalledOnce())
  })
})

describe('changing a materialized draft base', () => {
  async function openDraft() {
    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() => expect(createCalls()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'General' }))
  }

  async function chooseFresh() {
    fireEvent.click(controlUnder('Clone from profile'))
    fireEvent.click(await screen.findByRole('option', { name: /Fresh profile/ }))

    return screen.findByRole('dialog', { name: 'Reset draft configuration?' })
  }

  it('leaves the inherited source and configured draft untouched when reset is cancelled', async () => {
    await openDraft()
    const confirmation = await chooseFresh()
    expect(controlUnder('Clone from profile').textContent).toBe('default')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(mocks.deleteBot).not.toHaveBeenCalled()
    expect(controlUnder('Clone from profile').textContent).toBe('default')
  })

  it('awaits draft deletion before applying a new source; a failed deletion retains the original draft', async () => {
    await openDraft()
    const deletion = deferred<undefined>()
    mocks.deleteBot.mockReturnValueOnce(deletion.promise)
    const confirmation = await chooseFresh()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Reset draft' }))
    await waitFor(() => expect(mocks.deleteBot).toHaveBeenCalledOnce())
    expect(controlUnder('Clone from profile').textContent).toBe('default')
    deletion.reject(new Error('Draft is still in use'))
    await within(confirmation).findByText('Draft is still in use')
    expect(controlUnder('Clone from profile').textContent).toBe('default')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Reset draft' }))
    await waitFor(() => expect(controlUnder('Clone from profile').textContent).toMatch(/Fresh profile/))
    expect(mocks.deleteBot).toHaveBeenCalledTimes(2)
  })

  it('waits for an in-flight draft to materialize before deleting it and applying a changed template', async () => {
    await renderDialog(true)
    const creating = deferred<unknown>()
    mocks.request.mockImplementation(async (method: string) => (method === 'profiles.create' ? creating.promise : {}))
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() => expect(createCalls()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'General' }))
    const confirmation = await chooseFresh()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Reset draft' }))
    expect(mocks.deleteBot).not.toHaveBeenCalled()
    creating.resolve({ ok: true, name: 'inbox-triage' })
    await waitFor(() => expect(controlUnder('Clone from profile').textContent).toMatch(/Fresh profile/))
    expect(mocks.deleteBot).toHaveBeenCalledOnce()
    expect(createCalls()).toHaveLength(1)
  })

  it('does not delete or change a captured draft after its source is replaced', async () => {
    await openDraft()
    const confirmation = await chooseFresh()
    mocks.activeSource.connectionId = 'another-source'
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Reset draft' }))
    await within(confirmation).findByText(
      'The creation workspace changed. Reopen the dialog before resetting this draft.'
    )
    expect(mocks.deleteBot).not.toHaveBeenCalled()
    expect(controlUnder('Clone from profile').textContent).toBe('default')
  })

  it('never reassigns an existing local draft to a source selected before requesting reset', async () => {
    await openDraft()
    const botRows = new Set(['::inbox-triage', 'another-source::inbox-triage'])
    mocks.deleteBot.mockImplementation(async () => {
      botRows.delete(`${mocks.activeSource.connectionId}::inbox-triage`)
    })
    mocks.activeSource.connectionId = 'another-source'
    const confirmation = await chooseFresh()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Reset draft' }))

    await within(confirmation).findByText(
      'The creation workspace changed. Reopen the dialog before resetting this draft.'
    )
    expect(mocks.deleteBot).not.toHaveBeenCalled()
    expect(botRows).toEqual(new Set(['::inbox-triage', 'another-source::inbox-triage']))
    expect(controlUnder('Clone from profile').textContent).toBe('default')
  })

  it('keeps a remote draft when its deletion command resolves with a failed receipt', async () => {
    mocks.connections.mockResolvedValue([
      { id: 'local', label: 'This Mac' },
      { id: 'studio', label: 'Studio' }
    ])
    await renderDialog(true)
    await screen.findByText('Create on')
    fireEvent.click(controlUnder('Create on'))
    fireEvent.click(await screen.findByRole('option', { name: 'Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() => expect(mocks.skillsView.at(-1)).toMatchObject({ fixedProfile: 'inbox-triage' }))
    fireEvent.click(screen.getByRole('button', { name: 'General' }))
    const share = screen.getByRole('checkbox', { name: 'Share keys & accounts with the default profile on Studio' })
    fireEvent.click(share)
    const confirmation = await screen.findByRole('dialog', { name: 'Reset draft configuration?' })
    mocks.requestProfile.mockResolvedValueOnce({ code: 1, output: 'Remote draft was not deleted' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Reset draft' }))
    await within(confirmation).findByText('Remote draft was not deleted')
    expect(share.getAttribute('aria-checked')).toBe('true')
    expect(mocks.deleteBot).not.toHaveBeenCalled()
  })

  it.each([
    ['Share keys & accounts with the main profile', true],
    ['Create empty (skip bundled skills)', false]
  ] as const)('requires confirmation for %s after materialization', async (label, checked) => {
    await openDraft()
    const checkbox = screen.getByRole('checkbox', { name: label })
    fireEvent.click(checkbox)
    const confirmation = await screen.findByRole('dialog', { name: 'Reset draft configuration?' })
    expect(checkbox.getAttribute('aria-checked')).toBe(String(checked))
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(mocks.deleteBot).not.toHaveBeenCalled()
    expect(checkbox.getAttribute('aria-checked')).toBe(String(checked))
  })
})

afterEach(async () => {
  cleanup()
  // Radix's focus scope dispatches its unmount event from a 0 ms timer; let it fire
  // here, or it lands in the next test file's jsdom window and throws there.
  await new Promise(resolve => setTimeout(resolve, 0))
})

describe('materializing the draft profile', () => {
  it.each([
    ['小助手', 'u5c0f-u52a9-u624b'],
    ['test机器人', 'test-u673a-u5668-u4eba']
  ])('creates %s with an ASCII profile id and retains the display name', async (enteredName, profileName) => {
    await renderDialog(true)

    fireEvent.change(screen.getByPlaceholderText('inbox-triage'), {
      target: { value: enteredName }
    })

    const create = screen.getByRole('button', { name: 'Create Bot' })

    expect((create as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(create)

    await waitFor(() => expect(createCalls()).toHaveLength(1))
    expect(createCalls()[0][1]).toMatchObject({
      description: enteredName,
      name: profileName
    })
    expect(mocks.saveBotMeta).toHaveBeenCalledWith(
      expect.objectContaining({ name: profileName }),
      expect.objectContaining({ title: enteredName })
    )
    await waitFor(() =>
      expect(mocks.openRosterBot).toHaveBeenCalledWith(expect.objectContaining({ name: profileName }), {
        kickoff: true,
        openingStillCurrent: expect.any(Function)
      })
    )
  })

  it('creates it once when the Capabilities tab opens, pinned to the new slug', async () => {
    await renderDialog(true)

    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))

    await waitFor(() => expect(createCalls()).toHaveLength(1))
    expect(createCalls()[0][1]).toMatchObject({ clone_from: 'default', name: 'inbox-triage' })
    // The live surface needs a REAL backend row to write to.
    await waitFor(() => expect(mocks.skillsView.at(-1)).toMatchObject({ fixedProfile: 'inbox-triage' }))

    // Create Bot goes through the same helper — no duplicate profiles.create.
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() =>
      expect(mocks.openRosterBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'inbox-triage' }), {
        kickoff: true,
        openingStillCurrent: expect.any(Function)
      })
    )
    expect(createCalls()).toHaveLength(1)
  })

  it('creates it once a name is typed AFTER the Capabilities tab was opened nameless', async () => {
    await renderDialog(true)
    fireEvent.change(screen.getByPlaceholderText('inbox-triage'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await screen.findByText(/Name the bot first/)

    // Mid-word keystrokes must not each mint (and orphan) a draft.
    fireEvent.change(screen.getByPlaceholderText('inbox-triage'), { target: { value: 'late' } })
    fireEvent.change(screen.getByPlaceholderText('inbox-triage'), { target: { value: 'late-name' } })
    // Edited during the debounce: the draft must carry it, not the value from the last name change.
    fireEvent.change(screen.getByPlaceholderText('Inbox Triage'), { target: { value: 'Late Title' } })

    await waitFor(() => expect(mocks.skillsView.at(-1)).toMatchObject({ fixedProfile: 'late-name' }), { timeout: 3000 })
    expect(createCalls().map(([, params]) => params.name)).toEqual(['late-name'])
    expect(createCalls()[0][1].description).toBe('Late Title')
  })

  it('pins a remote-target draft to the TARGET machine, not the active gateway', async () => {
    mocks.connections.mockResolvedValue([
      { id: 'local', label: 'This Mac' },
      { id: 'studio', label: 'Studio' }
    ])

    await renderDialog(true)

    // "Create on" only exists on a multi-connection desktop.
    await screen.findByText('Create on')
    fireEvent.click(controlUnder('Create on'))
    fireEvent.click(await screen.findByRole('option', { name: 'Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))

    // The create lands on THAT machine's backend — no gateway switch, and the
    // clone source is the remote's own default (a local profile name the
    // remote box does not have would fail there).
    await waitFor(() =>
      expect(mocks.requestProfile).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'studio' }),
        'profiles.create',
        expect.objectContaining({ clone_from: 'default', name: 'inbox-triage' })
      )
    )
    expect(createCalls()).toHaveLength(0)
    await waitFor(() =>
      expect(mocks.skillsView.at(-1)).toMatchObject({ fixedConnection: 'studio', fixedProfile: 'inbox-triage' })
    )
  })

  it('lets a remote-target Bot start fresh instead of forcing a clone of the target default', async () => {
    mocks.connections.mockResolvedValue([
      { id: 'local', label: 'This Mac' },
      { id: 'studio', label: 'Studio' }
    ])

    await renderDialog(true)

    await screen.findByText('Create on')
    fireEvent.click(controlUnder('Create on'))
    fireEvent.click(await screen.findByRole('option', { name: 'Studio' }))

    // The picker stays live for a remote target and offers only what exists
    // on THAT machine: fresh, or its own default — never a local roster name.
    const cloneFrom = controlUnder('Clone from profile (on Studio)')

    expect(cloneFrom.getAttribute('data-disabled')).toBeNull()
    fireEvent.click(cloneFrom)
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Fresh profile (bundled skills)',
      'default'
    ])
    fireEvent.click(screen.getByRole('option', { name: /Fresh profile/ }))
    // Shared keys live on the TARGET machine, and the label says which.
    screen.getByText('Share keys & accounts with the default profile on Studio')

    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() =>
      expect(mocks.requestProfile).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'studio' }),
        'profiles.create',
        expect.objectContaining({ clone_from: null, name: 'inbox-triage' })
      )
    )
  })

  it('creates it on the first MCP setup click, then adds the server to it', async () => {
    // Older builds keep the staged MCP tab, which is where the setup button
    // lives. There is no "save the agent first" gate: the button is live.
    await renderDialog(false)

    fireEvent.click(screen.getByRole('button', { name: 'MCP' }))
    fireEvent.click(await screen.findByRole('button', { name: /Set up/ }))

    await waitFor(() => expect(createCalls()).toHaveLength(1))
    expect(createCalls()[0][1]).toMatchObject({ name: 'inbox-triage' })
    // The add lands on the profile the click just minted, not on `null`.
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('mcp.servers.add', {
        name: 'linear',
        preset: 'linear',
        profile: 'inbox-triage'
      })
    )
  })
})

// A create never lands on a live name, so a folder or startup profile stored
// under the new bot's name was left by a deleted profile. Bot Mode creates
// through its own RPC, so it has to drop them the way the profile dialog does.
describe('leftover prefs under the new bot name', () => {
  it('drops them once the create succeeded', async () => {
    let created = false
    const base = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'profiles.create') {
        created = true
      }

      return base(method, params)
    })
    mocks.dropLeftoverProfilePrefs.mockImplementationOnce(() => expect(created).toBe(true))

    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() =>
      expect(mocks.openRosterBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'inbox-triage' }), {
        kickoff: true,
        openingStillCurrent: expect.any(Function)
      })
    )
    expect(mocks.dropLeftoverProfilePrefs.mock.calls).toEqual([['inbox-triage', null]])
  })

  it('names the machine a remote bot was created on', async () => {
    mocks.connections.mockResolvedValue([
      { id: 'local', label: 'This Mac' },
      { id: 'studio', label: 'Studio' }
    ])

    await renderDialog(true)
    await screen.findByText('Create on')
    fireEvent.click(controlUnder('Create on'))
    fireEvent.click(await screen.findByRole('option', { name: 'Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() => expect(mocks.dropLeftoverProfilePrefs).toHaveBeenCalled())
    expect(mocks.dropLeftoverProfilePrefs.mock.calls).toEqual([['inbox-triage', 'studio']])
  })

  it('keeps them when the create fails', async () => {
    const base = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'profiles.create') {
        throw new Error('disk full')
      }

      return base(method, params)
    })

    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() => expect(createCalls()).toHaveLength(1))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mocks.dropLeftoverProfilePrefs).not.toHaveBeenCalled()
  })
})

// #141623: the draft profile is minted before the dialog finishes. Cancelling
// must delete the draft THIS dialog created, on the machine it created it on,
// including one whose create or configure is still in flight when the user
// backs out — it used to survive as a bot.
describe('cancelling New Bot discards its draft profile', () => {
  it('deletes the draft whose profiles.create was still in flight at cancel', async () => {
    const base = mocks.request.getMockImplementation()!
    let finishCreate!: () => void
    mocks.request.mockImplementation((method: string, params?: unknown) =>
      method === 'profiles.create'
        ? new Promise(resolve => {
            finishCreate = () => resolve({})
          })
        : base(method, params)
    )

    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() => expect(createCalls()).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    finishCreate()

    await waitFor(() => expect(mocks.deleteBot).toHaveBeenCalledWith({ name: 'inbox-triage' }))
    // The abandoned draft is not configured or adopted as a finished bot.
    expect(mocks.saveBotMeta).not.toHaveBeenCalled()
    expect(mocks.openRosterBot).not.toHaveBeenCalled()
  })

  // The draft lives where it was CREATED. Moving "Create on" afterwards must not
  // send the delete to the newly picked machine, where a real bot of the same
  // name may live, and must not leave the draft behind on its own machine.
  it('discards a local draft locally when "Create on" moves to another machine', async () => {
    mocks.connections.mockResolvedValue([
      { id: 'local', label: 'This Mac' },
      { id: 'studio', label: 'Studio' }
    ])

    await renderDialog(true)
    await screen.findByText('Create on')
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() => expect(mocks.skillsView.at(-1)).toMatchObject({ fixedProfile: 'inbox-triage' }))

    fireEvent.click(controlUnder('Create on'))
    fireEvent.click(await screen.findByRole('option', { name: 'Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(mocks.deleteBot).toHaveBeenCalledWith({ name: 'inbox-triage' }))
    expect(mocks.requestProfile).not.toHaveBeenCalledWith(expect.anything(), 'cli.exec', expect.anything())
  })

  it('discards a remote draft on its own machine when "Create on" moves back', async () => {
    mocks.connections.mockResolvedValue([
      { id: 'local', label: 'This Mac' },
      { id: 'studio', label: 'Studio' }
    ])

    await renderDialog(true)
    await screen.findByText('Create on')
    fireEvent.click(controlUnder('Create on'))
    fireEvent.click(await screen.findByRole('option', { name: 'Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
    await waitFor(() =>
      expect(mocks.skillsView.at(-1)).toMatchObject({ fixedConnection: 'studio', fixedProfile: 'inbox-triage' })
    )

    fireEvent.click(controlUnder('Create on'))
    fireEvent.click(await screen.findByRole('option', { name: /This Mac/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(mocks.requestProfile).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'studio' }),
        'cli.exec',
        {
          argv: ['profile', 'delete', 'inbox-triage', '--yes']
        }
      )
    )
    expect(mocks.deleteBot).not.toHaveBeenCalled()
  })

  // The draft exists once profiles.create returns, but the flight still awaits
  // the capability configure. A Cancel (or the dialog going away) in that window
  // deletes the draft; the flight must not then record bot meta for it.
  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['unmount', () => cleanup()]
  ])('writes no bot meta for a draft abandoned (%s) while its configure is pending', async (_label, abandon) => {
    const base = mocks.request.getMockImplementation()!
    let finishConfigure!: () => void
    mocks.request.mockImplementation((method: string, params?: unknown) =>
      method === 'profiles.describe'
        ? Promise.resolve({ mcp_servers: [], skills: [{ enabled: true, name: 'arxiv' }], toolsets: [] })
        : method === 'profiles.configure'
          ? new Promise(resolve => {
              finishConfigure = () => resolve({})
            })
          : base(method, params)
    )

    // The staged tabs are where a capability pick (and so a configure) is made
    // before the profile exists, and where MCP setup mints the draft.
    await renderDialog(false)
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'arxiv' }))
    fireEvent.click(screen.getByRole('button', { name: 'MCP' }))
    fireEvent.click(await screen.findByRole('button', { name: /Set up/ }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('profiles.configure', expect.anything()))

    abandon()
    finishConfigure()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mocks.saveBotMeta).not.toHaveBeenCalled()
  })
})

describe('provider readiness before the intro turn', () => {
  const notReady = { error: 'No usable credentials found for openrouter.', ok: false }

  it('keeps the bot, skips the intro, and offers model setup when its provider is not ready', async () => {
    const base = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation(async (method: string, params?: unknown) =>
      method === 'setup.runtime_check' ? notReady : base(method, params)
    )
    const onConfigureModel = vi.fn()

    await renderDialog(true, onConfigureModel)
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() =>
      expect(mocks.openRosterBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'inbox-triage' }), {
        kickoff: false,
        openingStillCurrent: expect.any(Function)
      })
    )
    expect(mocks.request).toHaveBeenCalledWith('setup.runtime_check', { profile: 'inbox-triage' })
    expect(createCalls()).toHaveLength(1)

    const toast = mocks.notify.mock.calls.at(-1)![0]

    expect(toast).toMatchObject({
      detail: notReady.error,
      kind: 'warning',
      title: 'Bot "Inbox Triage" created'
    })
    toast.action.onClick()
    expect(onConfigureModel).toHaveBeenCalledWith(expect.objectContaining({ name: 'inbox-triage' }))
  })

  it('runs the intro when the provider check passes', async () => {
    const base = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation(async (method: string, params?: unknown) =>
      method === 'setup.runtime_check' ? { ok: true } : base(method, params)
    )

    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() =>
      expect(mocks.openRosterBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'inbox-triage' }), {
        kickoff: true,
        openingStillCurrent: expect.any(Function)
      })
    )
    expect(mocks.notify).toHaveBeenLastCalledWith({ kind: 'success', message: 'Bot "Inbox Triage" created' })
  })

  it('explains an Aino connection failure without asking for a third-party API key', async () => {
    const base = mocks.request.getMockImplementation()!

    const unavailable = {
      ok: false,
      provider: 'aino',
      error_code: 'unsupported_gateway',
      error: 'This gateway cannot use Aino built-in models. Update it and try again.'
    }

    mocks.request.mockImplementation(async (method: string, params?: unknown) =>
      method === 'setup.runtime_check' ? unavailable : base(method, params)
    )

    await renderDialog(true, vi.fn())
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const toast = mocks.notify.mock.calls.at(-1)![0]

    expect(toast.message).toBe(unavailable.error)
    expect(toast.action).toBeUndefined()
    expect(toast.detail).toBeUndefined()
    expect(mocks.openRosterBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'inbox-triage' }), {
      kickoff: false,
      openingStillCurrent: expect.any(Function)
    })
  })

  it('checks a remote bot on its own machine and warns without an editor shortcut', async () => {
    mocks.connections.mockResolvedValue([
      { id: 'local', label: 'This Mac' },
      { id: 'studio', label: 'Studio' }
    ])
    mocks.requestProfile.mockImplementation(async () => notReady)

    await renderDialog(true, vi.fn())
    await screen.findByText('Create on')
    fireEvent.click(controlUnder('Create on'))
    fireEvent.click(await screen.findByRole('option', { name: 'Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() =>
      expect(mocks.notify).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'warning', title: 'Bot "Inbox Triage" created on Studio' })
      )
    )
    expect(mocks.requestProfile).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'studio' }),
      'setup.runtime_check',
      { profile: 'inbox-triage' }
    )
    expect(mocks.notify.mock.calls.at(-1)![0].action).toBeUndefined()
    expect(mocks.request).not.toHaveBeenCalledWith('setup.runtime_check', expect.anything())
  })
})

describe('creation navigation ownership', () => {
  it.each(['ready', 'wrong source', 'failed'])(
    'waits for the live roster query before selecting the created row: %s',
    async outcome => {
      const base = mocks.request.getMockImplementation()!
      let profileCreated = false
      let rosterFailed = false
      let finishRoster = () => undefined as void
      mocks.request.mockImplementation((method: string, params?: unknown) => {
        if (method === 'profiles.create') {
          profileCreated = true
        }

        if (method === 'profiles.list') {
          if (rosterFailed) {
            return Promise.reject(new Error('roster offline'))
          }

          return profileCreated
            ? new Promise((resolve, reject) => {
                finishRoster = () =>
                  outcome === 'failed'
                    ? ((rosterFailed = true), reject(new Error('roster offline')))
                    : resolve({
                        profiles: [
                          ...roster,
                          { name: 'inbox-triage', connectionId: outcome === 'ready' ? 'local' : 'other-machine' }
                        ]
                      })
              })
            : Promise.resolve({ profiles: roster })
        }

        return base(method, params)
      })
      vi.resetModules()
      const { CreateAgentDialog } = await import('./create-dialog')
      const { useRoster } = await import('./data')

      function RosterCreation() {
        const rosterQuery = useRoster()

        return (
          <>
            <output>{rosterQuery.data?.profiles?.map(row => row.name).join(',')}</output>
            <CreateAgentDialog
              onClose={() => undefined}
              onRefreshRoster={async () => {
                return (await rosterQuery.refetch({ throwOnError: true })).data?.profiles ?? []
              }}
              open
              roster={rosterQuery.data?.profiles ?? []}
            />
          </>
        )
      }

      render(withQueryClient(<RosterCreation />))
      await waitFor(() => expect(screen.getByRole('status', { hidden: true }).textContent).toBe('default'))
      fireEvent.change(screen.getByPlaceholderText('inbox-triage'), { target: { value: 'inbox-triage' } })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
      })

      expect(mocks.openRosterBot).not.toHaveBeenCalled()
      await act(async () => {
        finishRoster()
      })

      if (outcome === 'ready') {
        await waitFor(() => expect(mocks.openRosterBot).toHaveBeenCalled())
        expect(screen.getByRole('status', { hidden: true }).textContent).toContain('inbox-triage')
      } else {
        expect(mocks.openRosterBot).not.toHaveBeenCalled()
        expect(mocks.deleteBot).not.toHaveBeenCalled()

        if (outcome === 'failed') {
          await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled())
        }
      }
    }
  )

  it.each(['Create Bot', 'Cancel'])(
    'does not adopt or delete an old-source draft through the new source on %s',
    async action => {
      await renderDialog(true)
      fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))
      await waitFor(() => expect(mocks.skillsView.at(-1)).toMatchObject({ fixedProfile: 'inbox-triage' }))

      mocks.activeSource.connectionId = 'another-machine'
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: action }))
      })

      expect(mocks.request).not.toHaveBeenCalledWith('setup.runtime_check', expect.anything())
      expect(mocks.openRosterBot).not.toHaveBeenCalled()
      expect(mocks.deleteBot).not.toHaveBeenCalled()
    }
  )

  it('does not configure or probe the new ambient source after creation finishes on the previous source', async () => {
    let finishCreate = () => undefined as void
    const base = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation((method: string, params?: unknown) =>
      method === 'profiles.create'
        ? new Promise(resolve => {
            finishCreate = () => resolve({ ok: true })
          })
        : base(method, params)
    )
    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    await waitFor(() => expect(createCalls()).toHaveLength(1))

    mocks.activeSource.connectionId = 'another-machine'
    await act(async () => {
      finishCreate()
    })
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())

    expect(mocks.saveBotMeta).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalledWith('setup.runtime_check', expect.anything())
    expect(mocks.request).not.toHaveBeenCalledWith('profiles.configure', expect.anything())
    expect(mocks.openRosterBot).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText('inbox-triage') as HTMLInputElement).value).toBe('')
  })

  it('opens the created bot through the same source-owned roster transaction as a row click', async () => {
    await renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() =>
      expect(mocks.openRosterBot).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'inbox-triage', connectionId: 'local', sourceScoped: true }),
        { kickoff: true, openingStillCurrent: expect.any(Function) }
      )
    )
  })

  it.each(['another bot', 'another page'])(
    'finishes creation without taking focus after opening %s',
    async destination => {
      let finishCreate = () => undefined as void
      const base = mocks.request.getMockImplementation()!
      mocks.request.mockImplementation((method: string, params?: unknown) =>
        method === 'profiles.create'
          ? new Promise(resolve => {
              finishCreate = () => resolve({ ok: true })
            })
          : base(method, params)
      )
      const initialHash = window.location.hash

      try {
        await renderDialog(true)
        fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
        await waitFor(() => expect(createCalls()).toHaveLength(1))

        if (destination === 'another bot') {
          const { bumpBotOpenGeneration } = await import('./shared')
          bumpBotOpenGeneration()
        } else {
          window.location.hash = '#/settings'
        }

        await act(async () => {
          finishCreate()
        })
        await waitFor(() => expect(mocks.notify).toHaveBeenCalled())

        expect(mocks.openRosterBot).not.toHaveBeenCalled()
      } finally {
        window.location.hash = initialHash
      }
    }
  )
})

describe('the clone-from default', () => {
  it('regression: reset restores the mounted default, not "fresh profile"', async () => {
    await renderDialog(true)

    // `labeled()` renders a bare <label>, so the trigger is found by position.
    const cloneFrom = () =>
      screen.getByText('Clone from profile').parentElement!.querySelector('[role="combobox"]') as HTMLElement

    expect(cloneFrom().textContent).toBe('default')

    fireEvent.click(cloneFrom())
    fireEvent.click(await screen.findByRole('option', { name: /Fresh profile/ }))
    expect(cloneFrom().textContent).toMatch(/Fresh profile/)

    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
    await waitFor(() => expect(mocks.openRosterBot).toHaveBeenCalled())

    // Second open: the picker must read `default` again, or every agent after
    // the first silently starts from a bare profile.
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    expect(cloneFrom().textContent).toBe('default')
  })
})
