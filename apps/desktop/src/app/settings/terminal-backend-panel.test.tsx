import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { deferred } from '@/test/deferred'
import type { TerminalBackendsResponse } from '@/types/hermes'

const getTerminalBackends = vi.fn()
const selectTerminalBackend = vi.fn()
const confirmMock = vi.fn()

vi.mock('@/hermes', () => ({
  getTerminalBackends: () => getTerminalBackends(),
  selectTerminalBackend: (backend: string) => selectTerminalBackend(backend)
}))

vi.mock('@/store/confirm', () => ({
  confirm: (...args: Parameters<typeof confirmMock>) => confirmMock(...args)
}))

vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

function backends(overrides: Partial<TerminalBackendsResponse> = {}): TerminalBackendsResponse {
  return {
    active: 'local',
    backends: [
      {
        name: 'local',
        label: 'Local',
        description: 'Run commands directly on this machine. No isolation.',
        active: true,
        status: 'ready',
        detail: ''
      },
      {
        name: 'docker',
        label: 'Docker',
        description: 'Run commands in an isolated Docker container.',
        active: false,
        status: 'needs_setup',
        detail: 'Docker daemon not reachable — start Docker and retry.'
      },
      {
        name: 'ssh',
        label: 'SSH',
        description: 'Run commands on a remote host over SSH.',
        active: false,
        status: 'ready',
        detail: 'hermes@devbox'
      }
    ],
    ...overrides
  }
}

beforeEach(() => {
  getTerminalBackends.mockResolvedValue(backends())
  selectTerminalBackend.mockResolvedValue({ ok: true, backend: 'ssh' })
  confirmMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TerminalBackendPanel', () => {
  it('localizes built-in backend metadata in simplified Chinese', async () => {
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <TerminalBackendPanel onConfiguredChange={vi.fn()} />
      </I18nProvider>
    )

    expect(await screen.findByText('本地')).toBeTruthy()
    expect(screen.getByText('直接在此机器上运行命令，不提供隔离。')).toBeTruthy()
    expect(screen.getByText('Docker 守护进程无法连接——请启动 Docker 后重试。')).toBeTruthy()
  })

  it('preserves metadata from unknown plugin backends', async () => {
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    getTerminalBackends.mockResolvedValue(
      backends({
        backends: [
          {
            name: 'custom',
            label: 'Custom sandbox',
            description: 'Provided by a plugin.',
            active: true,
            status: 'unavailable',
            detail: 'Plugin-specific setup required.'
          }
        ],
        active: 'custom'
      })
    )

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <TerminalBackendPanel onConfiguredChange={vi.fn()} />
      </I18nProvider>
    )

    expect(await screen.findByText('Custom sandbox')).toBeTruthy()
    expect(screen.getByText('Provided by a plugin.')).toBeTruthy()
    expect(screen.getByText((content: string) => content.includes('Plugin-specific setup required.'))).toBeTruthy()
  })

  it('lists backends with status pills from the backends endpoint', async () => {
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    render(<TerminalBackendPanel onConfiguredChange={vi.fn()} />)

    expect(await screen.findByText('Local')).toBeTruthy()
    expect(screen.getByText('Docker')).toBeTruthy()
    expect(screen.getByText('SSH')).toBeTruthy()
    // Ready backends show the Ready pill; needs_setup shows the warn pill.
    expect(screen.getAllByText('Ready').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Needs setup')).toBeTruthy()
    expect(getTerminalBackends).toHaveBeenCalled()
  })

  it('shows setup guidance detail for a needs_setup backend', async () => {
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    render(<TerminalBackendPanel onConfiguredChange={vi.fn()} />)

    expect(await screen.findByText(/Docker daemon not reachable/)).toBeTruthy()
  })

  it('marks the active backend with an In use pill', async () => {
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    render(<TerminalBackendPanel onConfiguredChange={vi.fn()} />)

    const local = await screen.findByRole('button', { name: /Local/ })
    expect(local.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('In use')).toBeTruthy()
  })

  it('selects a backend when clicked and reports the change', async () => {
    const onConfiguredChange = vi.fn()
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    render(<TerminalBackendPanel onConfiguredChange={onConfiguredChange} />)

    fireEvent.click(await screen.findByRole('button', { name: /SSH/ }))

    await waitFor(() => expect(selectTerminalBackend).toHaveBeenCalledWith('ssh'))
    await waitFor(() => expect(onConfiguredChange).toHaveBeenCalled())
    // Active highlight moves without a refetch.
    const ssh = screen.getByRole('button', { name: /SSH/ })
    expect(ssh.getAttribute('aria-pressed')).toBe('true')
  })

  it('gates a needs_setup backend behind a confirm dialog before selecting it', async () => {
    const confirmGate = deferred<boolean>()
    confirmMock.mockReturnValue(confirmGate.promise)
    selectTerminalBackend.mockResolvedValue({ ok: true, backend: 'docker' })
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    render(<TerminalBackendPanel onConfiguredChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Docker/ }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Docker'),
        description: expect.stringContaining('Docker daemon not reachable')
      })
    )
    // Must not select while the confirm dialog is still pending.
    expect(selectTerminalBackend).not.toHaveBeenCalled()

    confirmGate.resolve(true)

    await waitFor(() => expect(selectTerminalBackend).toHaveBeenCalledWith('docker'))
    // The guidance detail stays visible on the now-active row.
    expect(screen.getByText(/Docker daemon not reachable/)).toBeTruthy()
  })

  it('does not select a needs_setup backend when the confirm dialog is declined', async () => {
    const confirmGate = deferred<boolean>()
    confirmMock.mockReturnValue(confirmGate.promise)
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    render(<TerminalBackendPanel onConfiguredChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Docker/ }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())

    // Resolve inside act() and await the same promise handleSelect is
    // awaiting, so its post-await early return has actually run (no
    // arbitrary-duration sleep — deterministic on the real microtask queue).
    await act(async () => {
      confirmGate.resolve(false)
      await confirmGate.promise
    })

    expect(selectTerminalBackend).not.toHaveBeenCalled()
  })

  it('does not re-select the already active backend', async () => {
    const { TerminalBackendPanel } = await import('./terminal-backend-panel')
    render(<TerminalBackendPanel onConfiguredChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Local/ }))

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(selectTerminalBackend).not.toHaveBeenCalled()
  })
})
