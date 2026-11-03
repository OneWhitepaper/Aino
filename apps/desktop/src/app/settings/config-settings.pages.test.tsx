import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { createRef, type ReactNode, useState } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigApi from '@/api/config'
import { I18nProvider } from '@/i18n'
import { $activeConnectionId } from '@/store/connections'
import { $settingsRequestProfile } from '@/store/settings-scope'
import { stubMenuDomApis } from '@/test/jsdom'

import type { ConfigSettings as ConfigSettingsType } from './config-settings'
import { SECTIONS } from './constants'
import { SETTING_IDS, settingElementId } from './settings-manifest'
import { settingsSearchTargetQuery } from './settings-search'

const api = vi.hoisted(() => ({ read: vi.fn(), schema: vi.fn(), save: vi.fn() }))
const scope = $settingsRequestProfile as unknown as { set: (value: string) => void }
const connection = $activeConnectionId as unknown as { set: (value: string | null) => void }

vi.mock('@/hermes', async () => ({
  ...(await vi.importActual<typeof ConfigApi>('@/api/config')),
  profileScopeKey: (value?: unknown) => (typeof value === 'string' && value.trim()) || 'default',
  getHermesConfigRecord: (...args: unknown[]) => api.read(...args),
  getHermesConfigSchema: (...args: unknown[]) => api.schema(...args),
  saveHermesConfig: (...args: unknown[]) => api.save(...args),
  getElevenLabsVoices: async () => ({ available: false }),
  getProfiles: async () => ({ profiles: [] }),
  getMemoryStatus: async () => ({ active: 'builtin', providers: [] }),
  setApiRequestProfile: () => {}
}))
vi.mock('../hooks/use-on-profile-switch', () => ({ useOnProfileSwitch: () => {} }))
vi.mock('@/store/connections', () => ({ $activeConnectionId: atom<string | null>('local') }))
vi.mock('@/store/settings-scope', () => ({
  $settingsRequestProfile: atom('default'),
  $settingsScopeEditsNonDefault: atom(false),
  $settingsScopeOverride: atom(null),
  $settingsScopeProfile: atom('default')
}))
vi.mock('@/store/projects', () => ({
  $worktreeRefreshToken: atom(0),
  repoDiscoveryPolicyFromConfig: () => ({}),
  repoDiscoveryPolicySignature: () => '',
  scanAndRecordRepos: vi.fn().mockResolvedValue(undefined)
}))

let ConfigSettings: typeof ConfigSettingsType
const futureKeys: [string[], string][] = []

beforeAll(async () => {
  stubMenuDomApis()
  ;({ ConfigSettings } = await import('./config-settings'))
}, 60_000)
beforeEach(() => {
  scope.set('default')
  connection.set('local')
  api.read.mockResolvedValue({})
  api.schema.mockResolvedValue({ fields: {} })
  api.save.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()

  for (const [keys, field] of futureKeys.splice(0)) {
    keys.splice(keys.indexOf(field), 1)
  }

  vi.clearAllMocks()
})

function LocationProbe() {
  return <output data-testid="settings-route">{useLocation().search}</output>
}

function DraftSlot() {
  const [draft, setDraft] = useState('')

  return <input aria-label="Appended settings draft" onChange={event => setDraft(event.target.value)} value={draft} />
}

function SectionNavigation({ importInputRef }: { importInputRef: ReturnType<typeof createRef<HTMLInputElement>> }) {
  const location = useLocation()
  const navigate = useNavigate()
  const section = new URLSearchParams(location.search).get('tab')?.replace('config:', '') ?? 'safety'

  return (
    <>
      <button onClick={() => navigate('/settings?tab=config:browser')} type="button">
        Open browser settings
      </button>
      <ConfigSettings activeSectionId={section} importInputRef={importInputRef} />
    </>
  )
}

function mount(section: string, options: { route?: string; subpage?: string; afterContent?: ReactNode } = {}) {
  const importInputRef = createRef<HTMLInputElement>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const result = render(
    <MemoryRouter initialEntries={[options.route ?? `/settings?tab=config:${section}&profile=research&owner=local`]}>
      <QueryClientProvider client={client}>
        <I18nProvider configClient={null} initialLocale="en">
          <LocationProbe />
          <ConfigSettings
            activeSectionId={section}
            afterContent={options.afterContent}
            importInputRef={importInputRef}
            subpage={options.subpage}
          />
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )

  return { ...result, importInputRef }
}

function route() {
  return new URLSearchParams(screen.getByTestId('settings-route').textContent ?? '')
}

async function openPage(id: string) {
  for (const tab of screen.getAllByRole('tab')) {
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })

    if (route().get('page') === id) {
      await waitFor(() => expect(tab.getAttribute('aria-selected')).toBe('true'))

      return tab
    }
  }

  throw new Error(`Settings page ${id} is not reachable`)
}

function fieldRow(field: string) {
  return window.document.getElementById(`setting-field-${field}`)!
}

const pageCases = [
  {
    section: 'chat',
    pages: ['behavior', 'attachments'],
    fields: ['display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode']
  },
  {
    section: 'safety',
    pages: ['approvals', 'privacy', 'checkpoints', 'vault'],
    fields: [
      'approvals.mode',
      'approvals.timeout',
      'approvals.mcp_reload_confirm',
      'command_allowlist',
      'security.redact_secrets',
      'security.allow_private_urls',
      'checkpoints.enabled'
    ]
  },
  {
    section: 'browser',
    pages: ['profile', 'network'],
    fields: ['browser.use_real_profile', 'browser.allow_private_urls', 'browser.auto_local_for_private_urls']
  },
  {
    section: 'memory',
    pages: ['persistent', 'context'],
    fields: [
      'memory.memory_enabled',
      'memory.user_profile_enabled',
      'memory.memory_char_limit',
      'memory.user_char_limit',
      'memory.provider',
      'context.engine',
      'compression.enabled',
      'compression.threshold',
      'compression.codex_gpt55_autoraise',
      'compression.target_ratio',
      'compression.protect_last_n',
      'auxiliary.compression.timeout'
    ]
  },
  {
    section: 'voice',
    pages: ['conversation', 'transcription', 'speech'],
    fields: [
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
      'tts.edge.voice',
      'stt.local.model',
      'stt.local.language'
    ]
  },
  {
    section: 'advanced',
    pages: ['desktop', 'runtime', 'output', 'keys'],
    fields: [
      'toolsets',
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
      'agent.max_turns',
      'agent.api_max_retries',
      'agent.service_tier',
      'agent.tool_use_enforcement',
      'updates.non_interactive_local_changes'
    ]
  }
]

describe('unified configuration pages', () => {
  it('preserves a same-owner pending autosave when section navigation removes the page parameter', async () => {
    api.schema.mockResolvedValue({ fields: { 'approvals.timeout': { type: 'number' } } })
    api.read.mockResolvedValue({ approvals: { timeout: 30 } })
    const importInputRef = createRef<HTMLInputElement>()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter initialEntries={['/settings?tab=config:safety&page=approvals']}>
        <QueryClientProvider client={client}>
          <I18nProvider configClient={null} initialLocale="en">
            <LocationProbe />
            <SectionNavigation importInputRef={importInputRef} />
          </I18nProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const input = await screen.findByRole('spinbutton')
    fireEvent.change(input, { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open browser settings' }))

    await waitFor(() => expect(route().get('tab')).toBe('config:browser'))
    await waitFor(() => expect(api.save).toHaveBeenCalledExactlyOnceWith({ approvals: { timeout: 55 } }, 'default'))
  })

  it('retains an appended editor instance and draft when its first config load completes', async () => {
    let finishSchema!: (value: { fields: Record<string, never> }) => void
    api.schema.mockReturnValue(
      new Promise<{ fields: Record<string, never> }>(resolve => {
        finishSchema = resolve
      })
    )
    mount('advanced', { route: '/settings?tab=config:advanced&page=keys', afterContent: <DraftSlot /> })
    const input = await screen.findByRole('textbox', { name: 'Appended settings draft' })
    fireEvent.change(input, { target: { value: 'keep this unsaved credential draft' } })

    await act(async () => finishSchema({ fields: {} }))
    await screen.findAllByRole('tab')

    expect(screen.getByRole('textbox', { name: 'Appended settings draft' })).toBe(input)
    expect((input as HTMLInputElement).value).toBe('keep this unsaved credential draft')
    expect(api.save).not.toHaveBeenCalled()
  })

  it('keeps configuration import unavailable until the existing configuration and schema are ready', async () => {
    let finishSchema!: (value: { fields: Record<string, never> }) => void
    api.schema.mockReturnValue(
      new Promise<{ fields: Record<string, never> }>(resolve => {
        finishSchema = resolve
      })
    )
    const { importInputRef } = mount('advanced')
    const input = importInputRef.current
    expect(input?.disabled).toBe(true)

    await act(async () => finishSchema({ fields: {} }))
    await waitFor(() => expect(importInputRef.current?.disabled).toBe(false))
    expect(importInputRef.current).toBe(input)
    expect(api.save).not.toHaveBeenCalled()
  })

  it.each(pageCases)('keeps all existing $section controls reachable through its tabs', async entry => {
    api.schema.mockResolvedValue({ fields: Object.fromEntries(entry.fields.map(field => [field, { type: 'string' }])) })
    api.read.mockResolvedValue({ stt: { enabled: true, provider: 'local' }, tts: { provider: 'edge' } })

    const { importInputRef } = mount(entry.section, {
      afterContent: <button type="button">Existing appended control</button>
    })

    await screen.findAllByRole('tab')
    expect(screen.getAllByRole('tab')).toHaveLength(entry.pages.length)

    for (const page of entry.pages) {
      await openPage(page)
    }

    for (const field of entry.fields) {
      expect(fieldRow(field), `Missing existing field ${field}`).not.toBeNull()
      expect(window.document.querySelectorAll(`[id="setting-field-${field}"]`)).toHaveLength(1)
    }

    expect(screen.getByRole('button', { name: 'Existing appended control', hidden: true })).toBeTruthy()
    expect(importInputRef.current?.type).toBe('file')
    expect(route().get('profile')).toBe('research')
    expect(route().get('owner')).toBe('local')
    expect(api.save).not.toHaveBeenCalled()
  })

  it.each([
    ['advanced', 'tools', 'runtime', 'agent.tool_use_enforcement'],
    ['advanced', 'terminal', 'runtime', 'terminal.timeout'],
    ['memory', 'context', 'context', 'compression.enabled'],
    ['voice', 'transcription', 'transcription', 'stt.echo_transcripts']
  ])('lands legacy %s/%s field links on the canonical page', async (section, oldPage, canonical, field) => {
    api.schema.mockResolvedValue({ fields: { [field]: { type: 'boolean' } } })

    const { container } = mount(section, {
      route: `/settings?tab=config:${section}&page=${oldPage}&field=${field}&profile=research`
    })

    await screen.findAllByRole('tab')
    await waitFor(() => {
      expect(route().get('page')).toBe(canonical)
      expect(route().has('field')).toBe(false)
      expect(window.document.activeElement).toBe(fieldRow(field))
    })
    expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.contains(fieldRow(field))).toBe(true)
    expect(route().get('profile')).toBe('research')
  })

  it('retains every provider-specific voice field when its provider is selected', async () => {
    const voiceFields = SECTIONS.find(section => section.id === 'voice')!.keys
    const providerFields = voiceFields.filter(field => /^(tts|stt)\.[^.]+\./.test(field))
    api.schema.mockResolvedValue({ fields: Object.fromEntries(voiceFields.map(field => [field, { type: 'string' }])) })
    const providers = [...new Set(providerFields.map(field => field.split('.').slice(0, 2).join('.')))]

    for (const provider of providers) {
      const [kind, name] = provider.split('.')
      api.read.mockResolvedValue({
        stt: { enabled: true, provider: kind === 'stt' ? name : 'local' },
        tts: { provider: kind === 'tts' ? name : 'edge' }
      })

      const page = mount('voice', {
        route: `/settings?tab=config:voice&page=${kind === 'tts' ? 'speech' : 'transcription'}`
      })

      await screen.findAllByRole('tab')
      await waitFor(() => {
        for (const field of providerFields.filter(field => field.startsWith(`${provider}.`))) {
          expect(fieldRow(field), `Missing selected provider field ${field}`).not.toBeNull()
        }
      })
      page.unmount()
    }

    expect(api.save).not.toHaveBeenCalled()
  })

  it('follows an attachment search link to its tab without losing the target', async () => {
    mount('chat', {
      route: `/settings?${settingsSearchTargetQuery({ view: 'config:chat', setting: 'chat.attachment-size' })}`
    })
    const input = await screen.findByRole('spinbutton', { name: 'Max preview / image load size in megabytes' })
    await waitFor(() => {
      expect(route().get('page')).toBe('attachments')
      expect(route().has('setting')).toBe(false)
    })
    expect(input.closest('[role="tabpanel"]')?.getAttribute('data-state')).toBe('active')
  })

  it('keeps a legacy field target while loading and focuses it after the canonical page is ready', async () => {
    let finishSchema!: (value: { fields: Record<string, { type: string }> }) => void
    api.schema.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSchema = resolve
        })
    )
    api.read.mockResolvedValue({ terminal: { timeout: 90 } })
    mount('advanced', { route: '/settings?tab=config:advanced&page=terminal&field=terminal.timeout&profile=research' })
    await screen.findAllByRole('tab')
    await waitFor(() => expect(route().get('page')).toBe('runtime'))
    expect(route().get('field')).toBe('terminal.timeout')
    expect(fieldRow('terminal.timeout')).toBeNull()
    await act(async () => finishSchema({ fields: { 'terminal.timeout': { type: 'number' } } }))
    const input = await screen.findByDisplayValue('90')
    await waitFor(() => {
      expect(window.document.activeElement).toBe(fieldRow('terminal.timeout'))
      expect(route().has('field')).toBe(false)
    })
    expect(route().get('page')).toBe('runtime')
    expect(route().get('profile')).toBe('research')
    expect(input.closest('[role="tabpanel"]')?.getAttribute('data-state')).toBe('active')
  })

  it.each(['tools', 'terminal'])('keeps a saved advanced %s page link usable without a field target', async page => {
    api.schema.mockResolvedValue({ fields: { 'terminal.timeout': { type: 'number' } } })
    api.read.mockResolvedValue({ terminal: { timeout: 90 } })
    mount('advanced', { route: `/settings?tab=config:advanced&page=${page}&profile=research` })
    await screen.findAllByRole('tab')
    await waitFor(() => expect(route().get('page')).toBe('runtime'))
    const input = await screen.findByDisplayValue('90')
    expect(within(fieldRow('terminal.timeout')).getByRole('spinbutton')).toBe(input)
    expect(route().get('profile')).toBe('research')
  })

  it('opens old environment-key search links on the keys tab', async () => {
    const search = new URLSearchParams('tab=config:advanced&key=BRAVE_API_KEY&kview=tools')
    mount('advanced', { route: `/settings?${search}`, afterContent: <DraftSlot /> })
    await screen.findAllByRole('tab')
    await waitFor(() => expect(route().get('page')).toBe('keys'))
    expect(screen.getByRole('textbox', { name: 'Appended settings draft' })).toBeTruthy()
    expect(route().get('key')).toBe('BRAVE_API_KEY')
  })

  it.each([SETTING_IDS.advanced.warmBotBackends, SETTING_IDS.advanced.backendIdleTimeout])(
    'moves the old desktop link for %s to the runtime control',
    async setting => {
      mount('advanced', { route: `/settings?tab=config:advanced&page=desktop&setting=${setting}` })
      await screen.findAllByRole('tab')
      await waitFor(() => {
        const target = window.document.getElementById(settingElementId(setting))
        expect(target).not.toBeNull()
        expect(route().get('page')).toBe('runtime')
        expect(route().has('setting')).toBe(false)
        expect(window.document.activeElement).toBe(target)
      })
    }
  )

  it('preserves an uncommitted list draft while its tab is hidden', async () => {
    api.read.mockResolvedValue({ command_allowlist: ['git status'] })
    api.schema.mockResolvedValue({ fields: { command_allowlist: { type: 'list' } } })
    mount('safety')
    await screen.findAllByRole('tab')
    await openPage('approvals')
    const input = within(fieldRow('command_allowlist')).getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'git status, git diff --stat' } })
    await openPage('privacy')
    await openPage('approvals')
    expect(within(fieldRow('command_allowlist')).getByRole('textbox')).toBe(input)
    expect((input as HTMLInputElement).value).toBe('git status, git diff --stat')
    expect(api.save).not.toHaveBeenCalled()
    fireEvent.blur(input)
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({ command_allowlist: ['git status', 'git diff --stat'] }, 'default')
    )
  })

  it.each([
    ['safety', 'vault', 'approvals'],
    ['advanced', 'keys', 'runtime']
  ])('retains appended %s drafts across tab changes', async (section, appendedPage, otherPage) => {
    mount(section, { afterContent: <DraftSlot /> })
    await screen.findAllByRole('tab')
    await openPage(appendedPage)
    const input = screen.getByRole('textbox', { name: 'Appended settings draft' })
    fireEvent.change(input, { target: { value: 'unsaved credential label' } })
    await openPage(otherPage)
    expect(screen.queryByRole('textbox', { name: 'Appended settings draft' })).toBeNull()
    await openPage(appendedPage)
    expect(screen.getByRole('textbox', { name: 'Appended settings draft' })).toBe(input)
    expect((input as HTMLInputElement).value).toBe('unsaved credential label')
  })

  it('keeps embedded subpages narrow without adding full-page navigation', async () => {
    api.read.mockResolvedValue({ memory: { memory_enabled: true }, compression: { enabled: true } })
    api.schema.mockResolvedValue({
      fields: { 'memory.memory_enabled': { type: 'boolean' }, 'compression.enabled': { type: 'boolean' } }
    })
    mount('memory', { subpage: 'context', afterContent: <button type="button">Embedded caller control</button> })
    await screen.findByRole('switch')
    expect(fieldRow('compression.enabled')).not.toBeNull()
    expect(fieldRow('memory.memory_enabled')).toBeNull()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Embedded caller control' })).toBeTruthy()
  })

  it.each(['tools', 'terminal'])('retains embedded advanced %s consumers after merging runtime tabs', async subpage => {
    api.read.mockResolvedValue({
      terminal: { timeout: 42 },
      agent: { tool_use_enforcement: 'warn' },
      tool_output: { max_lines: 60 }
    })
    api.schema.mockResolvedValue({
      fields: {
        'terminal.timeout': { type: 'number' },
        'agent.tool_use_enforcement': { type: 'string' },
        'tool_output.max_lines': { type: 'number' }
      }
    })
    mount('advanced', { subpage })
    expect(await screen.findByDisplayValue('42')).toBeTruthy()
    expect(fieldRow('agent.tool_use_enforcement')).not.toBeNull()
    expect(fieldRow('tool_output.max_lines')).toBeNull()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(api.save).not.toHaveBeenCalled()
  })

  it('renders config-present legacy fields when an older backend omits their schema', async () => {
    api.read.mockResolvedValue({ browser: { allow_private_urls: true } })
    api.schema.mockResolvedValue({ fields: {} })
    mount('browser', { route: '/settings?tab=config:browser&page=network' })
    const toggle = await screen.findByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ browser: { allow_private_urls: false } }, 'default'))
  })

  it('keeps curated fields without page metadata editable in a fallback group', async () => {
    const keys = SECTIONS.find(section => section.id === 'browser')!.keys
    const field = 'browser.future_experiment'
    keys.push(field)
    futureKeys.push([keys, field])
    api.schema.mockResolvedValue({ fields: { [field]: { type: 'string' } } })
    api.read.mockResolvedValue({ browser: { future_experiment: 'preserve me' } })
    mount('browser')
    await screen.findAllByRole('tab')
    const input = await screen.findByDisplayValue('preserve me')
    fireEvent.change(input, { target: { value: 'still editable' } })
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({ browser: { future_experiment: 'still editable' } }, 'default')
    )
  })

  it('cancels an old profile pending autosave on target profile change', async () => {
    api.schema.mockResolvedValue({ fields: { 'approvals.timeout': { type: 'number' } } })
    api.read.mockImplementation(async (profile: string) => ({ approvals: { timeout: profile === 'other' ? 80 : 30 } }))
    mount('safety')
    await screen.findAllByRole('tab')
    await openPage('approvals')
    const initial = await screen.findByDisplayValue('30')
    fireEvent.change(initial, { target: { value: '55' } })
    await act(async () => scope.set('other'))
    const next = await screen.findByDisplayValue('80')
    fireEvent.change(next, { target: { value: '90' } })
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ approvals: { timeout: 90 } }, 'other'))
    expect(api.save).toHaveBeenCalledTimes(1)
  })

  it.each(['chat', 'advanced'])(
    'preserves %s device controls and appended content when remote config fails',
    async section => {
      api.read.mockRejectedValue(new Error('gateway unavailable'))
      mount(section, {
        route: `/settings?tab=config:${section}&page=${section === 'chat' ? 'attachments' : 'desktop'}`,
        afterContent: <button type="button">Available local fallback</button>
      })
      await screen.findAllByRole('tab')
      expect(screen.getByRole('button', { name: 'Available local fallback', hidden: true })).toBeTruthy()

      if (section === 'chat') {
        expect(
          await screen.findByRole('spinbutton', { name: 'Max preview / image load size in megabytes' })
        ).toBeTruthy()
      } else {
        expect(await screen.findByText('Keep computer awake')).toBeTruthy()
        await openPage('keys')
        expect(screen.getByRole('button', { name: 'Available local fallback' })).toBeTruthy()
      }
    }
  )
})
