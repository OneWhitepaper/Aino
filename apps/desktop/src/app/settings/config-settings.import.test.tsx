import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { createRef, StrictMode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigApi from '@/api/config'
import { I18nProvider } from '@/i18n'
import { $activeConnectionId } from '@/store/connections'
import { notify, notifyError } from '@/store/notifications'
import { $settingsRequestProfile } from '@/store/settings-scope'
import { stubMenuDomApis } from '@/test/jsdom'

import type { ConfigSettings as ConfigSettingsType } from './config-settings'

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
vi.mock('@/store/notifications', async () => ({
  ...(await vi.importActual('@/store/notifications')),
  notify: vi.fn(),
  notifyError: vi.fn()
}))

let ConfigSettings: typeof ConfigSettingsType

beforeAll(async () => {
  stubMenuDomApis()
  ;({ ConfigSettings } = await import('./config-settings'))
}, 60_000)
beforeEach(() => {
  scope.set('default')
  connection.set('local')
  api.read.mockResolvedValue({ approvals: { timeout: 30 } })
  api.schema.mockResolvedValue({ fields: { 'approvals.timeout': { type: 'number' } } })
  api.save.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function mount(importFile?: File, onImportConsumed = vi.fn()) {
  const importInputRef = createRef<HTMLInputElement>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const renderPage = (file?: File) => (
    <StrictMode>
      <MemoryRouter initialEntries={['/settings?tab=config:safety&page=approvals']}>
        <QueryClientProvider client={client}>
          <I18nProvider configClient={null} initialLocale="en">
            <ConfigSettings
              activeSectionId="safety"
              importFile={file}
              importInputRef={importInputRef}
              onImportConsumed={onImportConsumed}
            />
          </I18nProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </StrictMode>
  )

  const result = render(renderPage(importFile))

  return {
    ...result,
    importInputRef,
    onImportConsumed,
    rerenderFile: (file?: File) => result.rerender(renderPage(file))
  }
}

function configFile(contents = '{"approvals":{"timeout":55}}') {
  return new File([contents], 'settings.json', { type: 'application/json' })
}

describe('ConfigSettings file import handoff', () => {
  it('waits for configuration and schema, then imports the handed-off file exactly once', async () => {
    let finishSchema!: (value: { fields: { 'approvals.timeout': { type: string } } }) => void
    api.schema.mockReturnValue(new Promise(resolve => (finishSchema = resolve)))
    const file = configFile()
    const view = mount(file)

    await waitFor(() => expect(api.read).toHaveBeenCalled())
    expect(view.onImportConsumed).not.toHaveBeenCalled()
    expect(api.save).not.toHaveBeenCalled()

    await act(async () => finishSchema({ fields: { 'approvals.timeout': { type: 'number' } } }))
    await screen.findByDisplayValue('55')
    await waitFor(() => expect(api.save).toHaveBeenCalledExactlyOnceWith({ approvals: { timeout: 55 } }, 'default'))
    expect(view.onImportConsumed).toHaveBeenCalledExactlyOnceWith(file)

    view.rerenderFile(file)
    expect(view.onImportConsumed).toHaveBeenCalledTimes(1)
  })

  it('reports invalid JSON and consumes it without autosaving', async () => {
    const file = configFile('{invalid')
    const view = mount(file)

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(expect.any(SyntaxError), 'Invalid config JSON'))
    expect(view.onImportConsumed).toHaveBeenCalledExactlyOnceWith(file)
    expect(api.save).not.toHaveBeenCalled()
    expect(await screen.findByDisplayValue('30')).toBeTruthy()
  })

  it('reports an unreadable file and consumes it without autosaving', async () => {
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'error', { value: new DOMException('File unavailable', 'NotReadableError') })
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
    })
    const file = configFile()
    const view = mount(file)

    await waitFor(() => expect(view.onImportConsumed).toHaveBeenCalledExactlyOnceWith(file))
    expect(notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'NotReadableError' }),
      'Invalid config JSON'
    )
    expect(api.save).not.toHaveBeenCalled()
  })

  it('keeps the existing mounted file input on the same import and autosave path', async () => {
    const view = mount()
    await screen.findByDisplayValue('30')
    fireEvent.change(view.importInputRef.current!, { target: { files: [configFile()] } })

    await screen.findByDisplayValue('55')
    await waitFor(() => expect(api.save).toHaveBeenCalledExactlyOnceWith({ approvals: { timeout: 55 } }, 'default'))
    expect(view.onImportConsumed).not.toHaveBeenCalled()
  })

  it.each(['profile', 'connection', 'unmount'] as const)(
    'ignores a file read completing after %s changes',
    async owner => {
      let reader!: FileReader
      vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
        reader = this
      })
      const file = configFile()
      const view = mount(file)
      await waitFor(() => expect(reader).toBeDefined())
      const complete = reader.onload!
      Object.defineProperty(reader, 'result', { value: '{"approvals":{"timeout":55}}' })

      if (owner === 'unmount') {
        view.unmount()
      } else {
        await act(async () => {
          if (owner === 'profile') {
            scope.set('other')
          } else {
            connection.set('remote')
          }
        })
        view.rerenderFile()
        await screen.findByDisplayValue('30')
      }

      await act(async () => complete.call(reader, new ProgressEvent('load') as ProgressEvent<FileReader>))
      expect(api.save).not.toHaveBeenCalled()
      expect(view.onImportConsumed).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()
    }
  )
})
