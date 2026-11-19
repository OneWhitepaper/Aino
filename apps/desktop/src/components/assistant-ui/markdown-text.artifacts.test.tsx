import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArtifactPreview } from '@/app/chat/right-rail/preview-artifact'
import { DEFAULT_LOCALE, I18nProvider, setRuntimeI18nLocale } from '@/i18n'
import { artifactsForSession, clearArtifactRegistry } from '@/store/artifacts'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $previewTabs } from '@/store/preview'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'

import { MarkdownTextContent } from './markdown-text'

const HTML_DOC = `<!doctype html>
<html>
<head><title>Pomodoro Timer</title></head>
<body>
<h1>Pomodoro</h1>
<p>A tiny focus timer that counts down twenty-five minutes.</p>
<script>let seconds = 25 * 60; setInterval(() => { seconds -= 1 }, 1000)</script>
</body>
</html>`

const SMALL_SNIPPET = 'const x = 1'

function fenced(language: string, body: string): string {
  return `Here you go:\n\n\`\`\`${language}\n${body}\n\`\`\`\n`
}

// End-to-end for the artifact path: a substantial ```html fence in assistant
// markdown must come out of preprocessMarkdown -> Streamdown -> SyntaxHighlighter
// as an artifact card (registered in the store), while small fences keep the
// plain code-card path.
describe('MarkdownTextContent artifacts', () => {
  beforeEach(() => {
    $activeSessionId.set('session-artifacts')
    $selectedStoredSessionId.set(null)
    window.localStorage.clear()
    clearArtifactRegistry()
  })

  afterEach(() => {
    cleanup()
    clearNotifications()
    setRuntimeI18nLocale(DEFAULT_LOCALE)
    vi.unstubAllGlobals()
    $activeSessionId.set(null)
    $selectedStoredSessionId.set(null)
    clearArtifactRegistry()
    window.localStorage.clear()
  })

  it('renders a substantial html fence as an artifact card and registers it', async () => {
    render(<MarkdownTextContent isRunning={false} text={fenced('html', HTML_DOC)} />)

    const card = await screen.findByText('Pomodoro Timer')

    expect(card.closest('[data-slot="aui_artifact-card"]')).not.toBeNull()
    expect(artifactsForSession('session-artifacts')).toHaveLength(1)
    expect(artifactsForSession('session-artifacts')[0]?.kind).toBe('html')
    // Registration alone must not open the rail (offer, don't hijack).
    expect($previewTabs.get()).toHaveLength(0)
  })

  it('opens the older card’s page from its menu without revealing the rail on menu open', async () => {
    render(
      <>
        <MarkdownTextContent isRunning={false} text={fenced('html', HTML_DOC)} />
        <MarkdownTextContent isRunning={false} text={fenced('html', HTML_DOC.replace('twenty-five', 'fifteen'))} />
      </>
    )

    const [menuTrigger] = await screen.findAllByRole('button', { name: 'Open with' })
    fireEvent.keyDown(menuTrigger!, { key: 'Enter' })

    const item = await screen.findByRole('menuitem', { name: 'Aino' })
    expect($previewTabs.get()).toHaveLength(0)

    fireEvent.click(item)

    const target = $previewTabs.get().at(-1)?.target
    expect(target?.kind).toBe('artifact')
    const preview = render(<ArtifactPreview target={target!} />)
    expect(within(preview.container).getByTitle('Pomodoro Timer').getAttribute('srcdoc')).toBe(HTML_DOC)
  })

  it('lists installed browsers on demand and opens the exact version in the selected app', async () => {
    const list = vi.fn().mockResolvedValue([
      { id: 'edge', name: 'Microsoft Edge' },
      { id: 'chrome', name: 'Google Chrome' }
    ])

    const open = vi.fn().mockResolvedValue(undefined)
    const saveImageBuffer = vi.fn()

    vi.stubGlobal('hermesDesktop', { previewBrowserApps: { list, open }, saveImageBuffer })
    render(
      <>
        <MarkdownTextContent isRunning={false} text={fenced('html', HTML_DOC)} />
        <MarkdownTextContent isRunning={false} text={fenced('html', HTML_DOC.replace('twenty-five', 'fifteen'))} />
      </>
    )

    const [olderCard] = await screen.findAllByRole('button', { name: 'Open with' })
    expect(list).not.toHaveBeenCalled()
    fireEvent.keyDown(olderCard!, { key: 'Enter' })

    const chrome = await screen.findByRole('menuitem', { name: 'Google Chrome' })

    expect(screen.getByRole('menuitem', { name: 'Microsoft Edge' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Safari' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Open externally' })).toBeNull()
    expect($previewTabs.get()).toHaveLength(0)
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(chrome)

    expect(open).toHaveBeenCalledExactlyOnceWith('chrome', new TextEncoder().encode(HTML_DOC))
    expect(saveImageBuffer).not.toHaveBeenCalled()
    expect($previewTabs.get()).toHaveLength(0)
  })

  it('localizes selected browser failures while retaining the diagnosis and never opening elsewhere', async () => {
    const diagnostic = 'The selected browser is no longer available.'
    const error = new Error(`Error invoking remote method 'hermes:preview-browser-apps:open': Error: ${diagnostic}`)
    const list = vi.fn().mockResolvedValue([{ id: 'chrome', name: 'Google Chrome' }])
    const open = vi.fn().mockRejectedValue(error)
    const saveImageBuffer = vi.fn()
    const openPreviewInBrowser = vi.fn()
    const logLine = vi.fn()
    vi.stubGlobal('hermesDesktop', {
      logLine,
      openPreviewInBrowser,
      previewBrowserApps: { list, open },
      saveImageBuffer
    })
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <MarkdownTextContent isRunning={false} text={HTML_DOC} />
      </I18nProvider>
    )

    fireEvent.keyDown(await screen.findByRole('button', { name: '打开方式' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Google Chrome' }))

    await vi.waitFor(() => {
      expect($notifications.get()[0]).toMatchObject({
        kind: 'error',
        title: '无法在外部打开',
        message: '预览不可用',
        detail: diagnostic
      })
    })
    expect(logLine).toHaveBeenCalledWith(expect.stringContaining(error.message))
    expect(open).toHaveBeenCalledExactlyOnceWith('chrome', new TextEncoder().encode(HTML_DOC))
    expect(saveImageBuffer).not.toHaveBeenCalled()
    expect(openPreviewInBrowser).not.toHaveBeenCalled()
    expect($previewTabs.get()).toHaveLength(0)
  })

  it.each(['missing', 'empty', 'failed'] as const)(
    'keeps the existing external opener when browser discovery is %s',
    async discovery => {
      const target = 'blob:http://localhost/artifact'
      const saveImageBuffer = vi.fn().mockResolvedValue(target)
      const openPreviewInBrowser = vi.fn().mockResolvedValue(undefined)
      const list = vi.fn().mockResolvedValue([])

      if (discovery === 'failed') {
        list.mockRejectedValue(new Error('Browser lookup failed'))
      }

      vi.stubGlobal('hermesDesktop', {
        openPreviewInBrowser,
        previewBrowserApps: discovery === 'missing' ? undefined : { list, open: vi.fn() },
        saveImageBuffer
      })
      render(<MarkdownTextContent isRunning={false} text={HTML_DOC} />)

      fireEvent.keyDown(await screen.findByRole('button', { name: 'Open with' }), { key: 'Enter' })
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Open externally' }))

      expect(saveImageBuffer).toHaveBeenCalledExactlyOnceWith(new TextEncoder().encode(HTML_DOC), '.html')
      await vi.waitFor(() => expect(openPreviewInBrowser).toHaveBeenCalledExactlyOnceWith(target))
    }
  )

  it.each(['document', 'without doctype', 'unlabeled fence'])(
    'previews an HTML %s without rewriting its source',
    async format => {
      const source = HTML_DOC.replace(
        '<h1>Pomodoro</h1>',
        '<h1>Pomodoro</h1>\n<script>const raw = "<thinking>keep</thinking> $5 MEDIA: /tmp/example.png ```";</script>'
      )

      const document =
        format === 'unlabeled fence'
          ? HTML_DOC
          : format === 'without doctype'
            ? source.replace('<!doctype html>\n', '')
            : source

      const text = format === 'unlabeled fence' ? fenced('', document) : document
      const { container } = render(<MarkdownTextContent isRunning={false} text={text} />)

      const card = await screen.findByRole('button', { name: /Pomodoro Timer/ })
      expect(card.closest('[data-slot="aui_artifact-card"]')).not.toBeNull()
      expect(container.querySelector('iframe, script')).toBeNull()
      expect(container.textContent).not.toContain('<html>')
      expect(artifactsForSession('session-artifacts')[0]?.versions[0]?.content).toBe(document)
      expect($previewTabs.get()).toHaveLength(0)

      fireEvent.click(card)
      const target = $previewTabs.get().at(-1)?.target
      expect(target?.kind).toBe('artifact')
      const preview = render(<ArtifactPreview target={target!} />)
      const frame = within(preview.container).getByTitle('Pomodoro Timer')
      expect(frame.getAttribute('srcdoc')).toBe(document)
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    }
  )

  it('keeps a bare document in one disabled card until streaming finishes', async () => {
    const { rerender } = render(<MarkdownTextContent isRunning text={HTML_DOC.slice(0, -20)} />)

    const card = await screen.findByRole('button', { name: /Pomodoro Timer/ })
    expect((card as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Open with' }) as HTMLButtonElement).disabled).toBe(true)
    expect(artifactsForSession('session-artifacts')).toHaveLength(0)
    expect($previewTabs.get()).toHaveLength(0)

    rerender(<MarkdownTextContent isRunning={false} text={HTML_DOC} />)

    expect(screen.getByRole('button', { name: /Pomodoro Timer/ })).toBe(card)
    expect((card as HTMLButtonElement).disabled).toBe(false)
    expect(artifactsForSession('session-artifacts')[0]?.versions[0]?.content).toBe(HTML_DOC)
  })

  it.each(['disableArtifacts', 'scratchpad', 'previewOnly'] as const)('keeps %s documents inert', async guard => {
    const { container } = render(<MarkdownTextContent {...{ [guard]: true }} isRunning={false} text={HTML_DOC} />)

    expect(container.querySelector('[data-slot="aui_artifact-card"], iframe, script')).toBeNull()
    expect(artifactsForSession('session-artifacts')).toHaveLength(0)
    expect($previewTabs.get()).toHaveLength(0)
  })

  it('keeps a small fence as a plain code block', async () => {
    const { container } = render(<MarkdownTextContent isRunning={false} text={fenced('js', SMALL_SNIPPET)} />)

    // The code card mounts synchronously; Shiki may split tokens into spans,
    // so assert on the card slots rather than text content.
    expect(container.querySelector('[data-slot="code-card"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="aui_artifact-card"]')).toBeNull()
    expect(artifactsForSession('session-artifacts')).toHaveLength(0)
  })

  it('does not register while the message is still streaming', async () => {
    render(<MarkdownTextContent isRunning text={fenced('html', HTML_DOC)} />)

    await screen.findByText('Pomodoro Timer')

    expect(artifactsForSession('session-artifacts')).toHaveLength(0)
  })
})
