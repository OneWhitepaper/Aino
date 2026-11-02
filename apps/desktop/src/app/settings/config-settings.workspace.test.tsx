import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { createRef } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigApi from '@/api/config'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile } from '@/store/profile'
import { $settingsRequestProfile } from '@/store/settings-scope'

import type { ConfigSettings as ConfigSettingsType } from './config-settings'

const getHermesConfigRecord = vi.fn()
const getHermesConfigSchema = vi.fn()
const saveHermesConfig = vi.fn()
const scanAndRecordRepos = vi.fn()
const scope = $settingsRequestProfile as unknown as { set: (value: string | undefined) => void }
const connection = $activeConnectionId as unknown as { set: (value: string | null) => void }

vi.mock('@/store/connections', () => ({ $activeConnectionId: atom<string | null>('local') }))

vi.mock('@/hermes', async () => ({
  ...(await vi.importActual<typeof ConfigApi>('@/api/config')),
  profileScopeKey: (value?: unknown) => (typeof value === 'string' && value.trim()) || 'default',
  getHermesConfigRecord: (profile?: string) => getHermesConfigRecord(profile),
  getHermesConfigSchema: () => getHermesConfigSchema(),
  saveHermesConfig: (config: unknown, profile?: string) => saveHermesConfig(config, profile),
  getElevenLabsVoices: () => Promise.resolve({ available: false }),
  getProfiles: () => Promise.resolve({ profiles: [] }),
  setApiRequestProfile: () => {}
}))

vi.mock('../hooks/use-on-profile-switch', () => ({ useOnProfileSwitch: () => {} }))

vi.mock('@/store/settings-scope', () => ({
  $settingsRequestProfile: atom<string | undefined>('default'),
  $settingsScopeEditsNonDefault: atom(false),
  $settingsScopeOverride: atom<null | string>(null),
  $settingsScopeProfile: atom('default')
}))

vi.mock('@/store/projects', () => ({
  $worktreeRefreshToken: atom(0),
  repoDiscoveryPolicyFromConfig: (config: { desktop?: unknown }) => config.desktop,
  repoDiscoveryPolicySignature: (policy: unknown) => JSON.stringify(policy),
  scanAndRecordRepos: (...args: unknown[]) => scanAndRecordRepos(...args)
}))

let ConfigSettings: typeof ConfigSettingsType

beforeAll(async () => {
  ;({ ConfigSettings } = await import('./config-settings'))
}, 60_000)

beforeEach(() => {
  $activeGatewayProfile.set('default')
  connection.set('local')
  scope.set('default')
  getHermesConfigRecord.mockResolvedValue({
    terminal: { cwd: '.' },
    desktop: { repo_scan_enabled: true, repo_scan_roots: [], repo_scan_exclude_paths: [] }
  })
  getHermesConfigSchema.mockResolvedValue({
    fields: {
      'terminal.cwd': { type: 'string' },
      'desktop.repo_scan_enabled': { type: 'boolean' },
      'desktop.repo_scan_roots': { type: 'list' },
      'desktop.repo_scan_exclude_paths': { type: 'list' }
    }
  })
  saveHermesConfig.mockResolvedValue({ ok: true })
  scanAndRecordRepos.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  $activeGatewayProfile.set('default')
})

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const importInputRef = createRef<HTMLInputElement>()

  const result = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ConfigSettings
          activeSectionId="workspace"
          afterContent={<button type="button">Additional workspace settings</button>}
          importInputRef={importInputRef}
        />
      </QueryClientProvider>
    </MemoryRouter>
  )

  return { importInputRef, ...result }
}

async function editRoots(value = '/work') {
  await screen.findByDisplayValue('.')
  const target = window.document.getElementById('setting-field-desktop.repo_scan_roots')!
  const input = within(target).getByRole('textbox')
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

describe('workspace discovery settings', () => {
  it('keeps existing config import and appended controls available in the redesigned page', async () => {
    const { importInputRef } = renderWorkspace()
    await screen.findByDisplayValue('.')
    expect(screen.getByRole('button', { name: 'Additional workspace settings' })).toBeTruthy()
    expect(importInputRef.current?.type).toBe('file')

    const imported = {
      terminal: { cwd: '/imported' },
      desktop: { repo_scan_enabled: true, repo_scan_roots: [], repo_scan_exclude_paths: [] }
    }

    fireEvent.change(importInputRef.current!, {
      target: { files: [new File([JSON.stringify(imported)], 'workspace.json', { type: 'application/json' })] }
    })

    await screen.findByDisplayValue('/imported')

    await waitFor(() => expect(saveHermesConfig).toHaveBeenCalledWith({ terminal: { cwd: '/imported' } }, 'default'))
    expect(scanAndRecordRepos).not.toHaveBeenCalled()
  })

  it.each(['default', 'coder'])('rescans after changing discovery roots on the active %s profile', async profile => {
    $activeGatewayProfile.set(profile)
    scope.set(profile)
    renderWorkspace()
    await editRoots()

    await waitFor(() =>
      expect(saveHermesConfig).toHaveBeenCalledWith({ desktop: { repo_scan_roots: ['/work'] } }, profile)
    )
    await waitFor(() => expect(scanAndRecordRepos).toHaveBeenCalledWith(true))
  })

  it('saves another profile without rescanning the active workspace', async () => {
    scope.set('other')
    renderWorkspace()
    await editRoots()

    await waitFor(() =>
      expect(saveHermesConfig).toHaveBeenCalledWith({ desktop: { repo_scan_roots: ['/work'] } }, 'other')
    )
    expect(scanAndRecordRepos).not.toHaveBeenCalled()
  })

  it('rescans after disabling automatic discovery', async () => {
    renderWorkspace()
    await screen.findByDisplayValue('.')
    const target = window.document.getElementById('setting-field-desktop.repo_scan_enabled')!
    fireEvent.click(within(target).getByRole('switch'))

    await waitFor(() =>
      expect(saveHermesConfig).toHaveBeenCalledWith({ desktop: { repo_scan_enabled: false } }, 'default')
    )
    await waitFor(() => expect(scanAndRecordRepos).toHaveBeenCalledWith(true))
  })

  it('rescans after saving exclusions and again when restoring the original roots', async () => {
    renderWorkspace()
    await editRoots()
    await waitFor(() => expect(scanAndRecordRepos).toHaveBeenCalledTimes(1))

    await editRoots('')
    await waitFor(() => expect(scanAndRecordRepos).toHaveBeenCalledTimes(2))
    expect(saveHermesConfig).toHaveBeenLastCalledWith({ desktop: { repo_scan_roots: [] } }, 'default')

    const target = window.document.getElementById('setting-field-desktop.repo_scan_exclude_paths')!
    const input = within(target).getByRole('textbox')
    fireEvent.change(input, { target: { value: '/work/vendor, /work/archive' } })
    fireEvent.blur(input)
    await waitFor(() => expect(scanAndRecordRepos).toHaveBeenCalledTimes(3))
    expect(saveHermesConfig).toHaveBeenLastCalledWith(
      { desktop: { repo_scan_exclude_paths: ['/work/vendor', '/work/archive'] } },
      'default'
    )
  })

  it('does not rescan for a working-directory-only edit', async () => {
    renderWorkspace()
    await screen.findByDisplayValue('.')
    const target = window.document.getElementById('setting-field-terminal.cwd')!
    fireEvent.change(within(target).getByRole('textbox'), { target: { value: '/work' } })

    await waitFor(() => expect(saveHermesConfig).toHaveBeenCalledWith({ terminal: { cwd: '/work' } }, 'default'))
    expect(scanAndRecordRepos).not.toHaveBeenCalled()
  })

  it('does not rescan a newly focused profile when the old save finishes', async () => {
    let finishSave!: (value: { ok: boolean }) => void
    saveHermesConfig.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSave = resolve
        })
    )
    renderWorkspace()
    await editRoots()
    await waitFor(() => expect(saveHermesConfig).toHaveBeenCalledTimes(1))

    await act(async () => {
      $activeGatewayProfile.set('other')
      finishSave({ ok: true })
    })

    expect(scanAndRecordRepos).not.toHaveBeenCalled()
  })

  it('does not rescan another connection when the old save finishes', async () => {
    let finishSave!: (value: { ok: boolean }) => void
    saveHermesConfig.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSave = resolve
        })
    )
    renderWorkspace()
    await editRoots()
    await waitFor(() => expect(saveHermesConfig).toHaveBeenCalledTimes(1))

    await act(async () => {
      connection.set('remote')
      finishSave({ ok: true })
    })

    expect(scanAndRecordRepos).not.toHaveBeenCalled()
  })
})
