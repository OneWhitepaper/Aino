import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/context'
import { setRuntimeI18nLocale } from '@/i18n/runtime'
import { $notifications } from '@/store/notifications'
import { $previewTabs, closeRightRail } from '@/store/preview'
import { $connection } from '@/store/session'

import { PreviewStatusRow } from './preview-row'

describe('PreviewStatusRow', () => {
  beforeEach(() => {
    setRuntimeI18nLocale('en')
    $notifications.set([])
    $connection.set(null)
    closeRightRail()
  })

  afterEach(() => {
    cleanup()
    $notifications.set([])
    $connection.set(null)
    closeRightRail()
    setRuntimeI18nLocale('en')
    Reflect.deleteProperty(window, 'hermesDesktop')
    vi.restoreAllMocks()
  })

  it('keeps the full path and hint in one portaled bubble beside the label', async () => {
    const view = render(
      <PreviewStatusRow
        item={{ cwd: 'C:\\repo', id: 'preview.html', label: 'preview.html', target: 'preview.html' }}
        onDismiss={() => undefined}
      />
    )

    fireEvent.pointerMove(screen.getByText('preview.html'), { pointerType: 'mouse' })
    await screen.findByRole('tooltip')

    const content = view.baseElement.querySelector<HTMLElement>('[data-slot="tooltip-content"]')
    const label = content?.querySelector('[data-slot="tooltip-label"]')

    expect(content).not.toBeNull()
    expect(view.container.contains(content)).toBe(false)
    expect(content?.classList.contains('tooltip-bubble')).toBe(true)
    expect(content?.getAttribute('data-side')).toBe('right')
    expect(label?.textContent).toContain('preview.html')
    expect(label?.querySelector('br')).not.toBeNull()
    expect(content?.querySelector('[data-slot="tooltip-arrow"]')).not.toBeNull()
  })

  it('opens remote non-HTML file artifacts in the in-app preview instead of the local browser bridge', async () => {
    const remotePath = '/home/agent/report.pdf'
    const openPreviewInBrowser = vi.fn(async () => undefined)

    $connection.set({ mode: 'remote' } as never)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        api: vi.fn(async () => ({ binary: true, byteSize: 42, mimeType: 'application/pdf' })),
        normalizePreviewTarget: vi.fn(async () => ({
          kind: 'file',
          label: 'report.pdf',
          path: remotePath,
          previewKind: 'binary',
          source: remotePath,
          url: 'file:///home/agent/report.pdf'
        })),
        openPreviewInBrowser
      }
    })

    render(
      <PreviewStatusRow
        item={{ cwd: '/home/agent', id: remotePath, label: 'report.pdf', target: remotePath }}
        onDismiss={() => undefined}
      />
    )

    fireEvent.click(screen.getByText('report.pdf'))

    await waitFor(() => {
      expect($previewTabs.get()).toEqual([
        expect.objectContaining({ target: expect.objectContaining({ kind: 'file', path: remotePath }) })
      ])
    })
    expect(openPreviewInBrowser).not.toHaveBeenCalled()
  })

  it('keeps local file artifacts on the browser bridge', async () => {
    const localPath = '/Users/alice/report.pdf'
    const openPreviewInBrowser = vi.fn(async () => undefined)

    $connection.set({ mode: 'local' } as never)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        normalizePreviewTarget: vi.fn(async () => ({
          kind: 'file',
          label: 'report.pdf',
          path: localPath,
          previewKind: 'binary',
          source: localPath,
          url: 'file:///Users/alice/report.pdf'
        })),
        openPreviewInBrowser
      }
    })

    render(
      <PreviewStatusRow
        item={{ cwd: '/Users/alice', id: localPath, label: 'report.pdf', target: localPath }}
        onDismiss={() => undefined}
      />
    )

    fireEvent.click(screen.getByText('report.pdf'))

    await waitFor(() => {
      expect(openPreviewInBrowser).toHaveBeenCalledWith('file:///Users/alice/report.pdf')
    })
    expect($previewTabs.get()).toEqual([])
  })

  it('keeps remote HTML on the staged browser-open path, not the in-app pane', async () => {
    const remotePath = '/home/agent/index.html'
    const html = '<!doctype html><html><body>hi</body></html>'
    const dataUrl = `data:text/html;base64,${btoa(html)}`
    const openPreviewInBrowser = vi.fn(async () => undefined)
    const saveImageBuffer = vi.fn(async () => '/tmp/staged.html')

    $connection.set({ mode: 'remote' } as never)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        api: vi.fn(async () => dataUrl),
        normalizePreviewTarget: vi.fn(async () => ({
          kind: 'file',
          label: 'index.html',
          path: remotePath,
          previewKind: 'html',
          source: remotePath,
          url: 'file:///home/agent/index.html'
        })),
        openPreviewInBrowser,
        saveImageBuffer
      }
    })

    render(
      <PreviewStatusRow
        item={{ cwd: '/home/agent', id: remotePath, label: 'index.html', target: remotePath }}
        onDismiss={() => undefined}
      />
    )

    fireEvent.click(screen.getByText('index.html'))

    await waitFor(() => {
      expect(saveImageBuffer).toHaveBeenCalled()
      expect(openPreviewInBrowser).toHaveBeenCalledWith('file:///tmp/staged.html')
    })
    expect($previewTabs.get()).toEqual([])
  })

  it('localizes fixed browser bridge errors in Simplified Chinese', async () => {
    setRuntimeI18nLocale('zh')
    $connection.set({ mode: 'local' } as never)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        normalizePreviewTarget: vi.fn(async () => ({
          kind: 'file',
          label: 'report.pdf',
          path: '/Users/alice/report.pdf',
          previewKind: 'binary',
          source: '/Users/alice/report.pdf',
          url: 'file:///Users/alice/report.pdf'
        }))
      }
    })

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <PreviewStatusRow
          item={{ cwd: '/Users/alice', id: 'report.pdf', label: 'report.pdf', target: '/Users/alice/report.pdf' }}
          onDismiss={() => undefined}
        />
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('report.pdf'))

    await waitFor(() => expect($notifications.get()[0]?.message).toBe('桌面桥接不可用'))
  })
})
