import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as path from 'node:path'

import type { Locator } from '@playwright/test'

import { receivedUserTexts } from '../../../tests-js/scripts/mock-server'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { verifyLegacyReviewGeometry } from './legacy-review-geometry-proof'
import { prepareLegacyReviewProject, verifyLegacyReviewProject } from './legacy-tool-panel-project'
import { verifyLegacyPanelResponsive } from './legacy-tool-panel-responsive-proof'
import { stopFixtureGateway } from './platform-workspace-proof'
import { expect as baseExpect, test } from './test'

const expect = baseExpect.configure({ timeout: 30_000 })
const DRAFT = 'Keep this unfinished panel acceptance draft.'
const ORIGINAL = '# Panel project\n\nCommitted baseline.\n'
const DIRTY = '# Panel project\n\nLocal working tree change.\n'
const SAVED = '# Panel project\n\nSaved through the real file editor.\n'
const rendererErrors: string[] = []
let fixture: MockBackendFixture
let project: string
let server: Server
let origin: string
let browserGuestId: number
let browserPaneId: string
let terminalId: string
let terminalPid: string

interface SavedTerminal {
  id: string
  cwd: string
  reviveBuffer?: string
}

interface SavedTerminalState {
  activeTerminalId: string
  terminals: SavedTerminal[]
}

interface SavedPreview {
  id: string
  pinned?: boolean
  temporary?: boolean
  target: { path?: string; label?: string; url?: string }
}

interface GuestState {
  id: number
  url: string
  body: string
  marker: string
}

async function selectInitialLegacyFiles(panel: Locator) {
  const chooser = panel.locator('[data-tool-chooser]')

  await expect(chooser).toBeVisible()
  await chooser.getByRole('button', { name: 'Files', exact: true }).click()
  await expect(panel.locator('[data-tree-tab="files"]')).toHaveAttribute('aria-selected', 'true')
}

test.describe('project tool panel', () => {
  test.beforeAll(async () => {
    fixture = await setupMockBackend({
      extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
      extraDisplayConfig: '  language: en'
    })
    const { app, page, sandbox } = fixture
    page.on('pageerror', error => rendererErrors.push(error.message))
    page.on('console', message => {
      const content = message.text()

      if (!['error', 'warning'].includes(message.type())) {
        return
      }

      if (content.includes('Electron Security Warning (Insecure Content-Security-Policy)')) {
        return
      }

      // Native test launches disable the GPU; xterm explicitly continues with its DOM fallback.
      if (
        content.startsWith('[hermes-terminal] WebGL unavailable; falling back to DOM') &&
        content.includes('WebGL2 not supported')
      ) {
        return
      }

      rendererErrors.push(content)
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(
      await page.evaluate(
        () => (window as Window & { hermesDesktop?: { accountAdapter?: string } }).hermesDesktop?.accountAdapter
      )
    ).toBe('legacy-development')

    const agreement = page.getByRole('checkbox', {
      name: /^(同意用户协议和隐私政策|Agree to the user agreement and privacy policy)$/
    })

    await expect(agreement).toBeVisible({ timeout: 60_000 })
    await page.getByRole('textbox', { name: /^(手机号|Phone number)$/ }).fill('13800000108')
    await agreement.check()
    await page.getByRole('button', { name: /^(发送验证码|Send code)$/ }).click()
    await page.getByRole('textbox', { name: /^(验证码|Verification code)$/ }).fill('1234')
    await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
    await waitForAppReady(fixture, 120_000)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))

    project = path.join(realpathSync(sandbox.root), 'TabbedPanelProject')
    mkdirSync(project)
    mkdirSync(path.join(project, 'notes'))
    writeFileSync(path.join(project, 'README.md'), ORIGINAL)
    writeFileSync(path.join(project, 'other.md'), '# Another panel file\n')
    writeFileSync(path.join(project, 'notes', 'deep.txt'), 'Nested panel search result.\n')
    execFileSync('git', ['init', '--quiet', project])
    execFileSync('git', ['-C', project, 'add', '.'])
    execFileSync('git', [
      '-C',
      project,
      '-c',
      'user.name=Aino Test',
      '-c',
      'user.email=aino-test@example.com',
      'commit',
      '--quiet',
      '-m',
      'Panel test baseline'
    ])
    writeFileSync(path.join(project, 'README.md'), DIRTY)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, project)
    await page.getByRole('button', { name: 'Open folder as project…', exact: true }).click()
    await expect(
      page.locator('[data-chat-surface]:visible').getByRole('button', { name: path.basename(project), exact: true })
    ).toBeVisible()
    const input = page.locator('[data-slot="composer-rich-input"]:visible')
    await input.fill('Prepare the tabbed panel acceptance project.')
    await input.press('Enter')

    try {
      await expect(page.getByText(/Hello from the mock inference server/)).toBeVisible({ timeout: 60_000 })
    } catch (error) {
      const geometry = await page.evaluate(() => {
        const selectors = [
          '[data-chat-surface]',
          '[data-chat-thread-viewport]',
          '[data-slot="summary-workspace"]',
          '[data-slot="summary-workspace-main"]',
          '[data-tree-group]',
          '[data-pane-host]',
          '[data-slot="thread-root"]',
          '[data-message-id]',
          '[data-message-index]'
        ]

        const elements = Object.fromEntries(
          selectors.map(selector => [
            selector,
            [...document.querySelectorAll<HTMLElement>(selector)].map(element => {
              const bounds = element.getBoundingClientRect()
              const style = getComputedStyle(element)

              return {
                tag: element.tagName,
                className: element.className,
                attributes: Object.fromEntries(
                  [...element.attributes]
                    .filter(attribute => attribute.name.startsWith('data-'))
                    .map(attribute => [attribute.name, attribute.value])
                ),
                bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
                display: style.display,
                visibility: style.visibility,
                position: style.position,
                overflow: style.overflow,
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight,
                text: element.innerText.slice(0, 3000),
                html: element.outerHTML.slice(0, 24000)
              }
            })
          ])
        )

        return {
          url: location.href,
          title: document.title,
          elements,
          layout: localStorage.getItem('hermes.desktop.layoutTree.v2'),
          storage: Object.fromEntries(
            Object.entries(localStorage).filter(([key]) => /layout|session|tile|workspace|mode/i.test(key))
          ),
          bodyText: document.body.innerText.slice(-10000)
        }
      })

      writeFileSync(
        test.info().outputPath('fixture-renderer-diagnostics.json'),
        JSON.stringify({ geometry, rendererErrors }, null, 2)
      )
      throw error
    }

    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await input.fill(DRAFT)

    server = createServer((request, response) => {
      const second = request.url?.startsWith('/two')
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(
        '<!doctype html><html><head><title>Panel ' +
          (second ? 'two' : 'one') +
          '</title></head><body>' +
          '<h1>Panel browser ' +
          (second ? 'two' : 'one') +
          '</h1>' +
          '<a href="' +
          (second ? '/one' : '/two') +
          '">Next local page</a>' +
          '<script>window.__ainoPanelProbe = crypto.randomUUID()</script></body></html>'
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  })

  test.afterAll(async ({ browserName: _browserName }, testInfo) => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }

    if (fixture) {
      const logs = path.join(fixture.sandbox.hermesHome, 'logs')

      if (existsSync(logs)) {
        cpSync(logs, testInfo.outputPath('backend-logs'), { recursive: true })
      }

      try {
        stopFixtureGateway(fixture.sandbox)
      } finally {
        await fixture.cleanup()
      }
    }
  })

  test.afterEach(async ({ browserName: _browserName }, testInfo) => {
    if (!fixture || testInfo.status === testInfo.expectedStatus) {
      return
    }

    const diagnostics = await fixture.page
      .evaluate(() => {
        const selectors = ['[data-tool-panel]', '[data-tree-group]', '[data-tree-tab]', '[data-pane-host]']

        return {
          url: location.href,
          storage: Object.fromEntries(
            Object.entries(localStorage).filter(([key]) =>
              /layout|collapse|dismiss|hidden|preview|rightRail|pane/i.test(key)
            )
          ),
          elements: Object.fromEntries(
            selectors.map(selector => [
              selector,
              [...document.querySelectorAll<HTMLElement>(selector)].map(element => {
                const box = element.getBoundingClientRect()
                const style = getComputedStyle(element)

                return {
                  data: { ...element.dataset },
                  className: element.className,
                  bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
                  display: style.display,
                  visibility: style.visibility,
                  position: style.position,
                  text: element.innerText.slice(0, 1000),
                  html: element.outerHTML.slice(0, 10000)
                }
              })
            ])
          )
        }
      })
      .catch(error => ({ error: String(error) }))

    writeFileSync(testInfo.outputPath('panel-state-diagnostics.json'), JSON.stringify(diagnostics, null, 2))
  })

  const panel = () => fixture.page.locator('[data-tool-panel]:visible')
  const chooser = () => fixture.page.locator('[data-tool-chooser]:visible')
  const composer = () => fixture.page.locator('[data-slot="composer-rich-input"]:visible')
  const previewTab = (name: string) => panel().locator('[data-tree-tab]').filter({ hasText: name })

  async function fileHost(name: string): Promise<Locator> {
    const paneId = await previewTab(name).getAttribute('data-tree-tab')
    const host = fixture.page.locator('[data-pane-host="' + paneId + '"]:visible')
    await expect(host).toBeVisible()

    return host
  }

  async function savedTerminals(): Promise<SavedTerminalState> {
    return fixture.page.evaluate(() => JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') || '{}'))
  }

  async function savedPreviews(): Promise<SavedPreview[]> {
    return fixture.page.evaluate(() => {
      const buckets = JSON.parse(localStorage.getItem('hermes.desktop.previewTabs.v2') || '{}') as Record<
        string,
        SavedPreview[]
      >

      return Object.values(buckets).flat()
    })
  }

  async function guestState(id: number): Promise<GuestState | null> {
    return fixture.app.evaluate(async ({ webContents }, id) => {
      const guest = webContents.fromId(id)

      if (!guest) {
        return null
      }

      const content = (await guest.executeJavaScript(
        '({ body: document.body.innerText, marker: window.__ainoPanelProbe })'
      )) as { body: string; marker: string }

      return { id: guest.id, url: guest.getURL(), ...content }
    }, id)
  }

  async function shell(command: string): Promise<void> {
    const input = fixture.page.locator('[data-terminal]:visible .xterm-helper-textarea')
    await expect(input).toBeAttached()
    await input.fill('')
    await input.press('Control+u')
    await input.pressSequentially(command)
    await input.press('Enter')
  }

  async function panelTabGroup(tab: Locator): Promise<string | null> {
    return tab.evaluate(element => element.closest('[data-tree-group]')?.getAttribute('data-tree-group') ?? null)
  }

  async function showPanel(): Promise<void> {
    if (!(await panel().isVisible())) {
      await fixture.page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
    }

    await expect(panel()).toBeVisible()
  }

  async function chooseTool(name: 'Files' | 'Browser' | 'Terminal' | 'Review'): Promise<void> {
    await showPanel()

    if (!(await chooser().isVisible())) {
      await panel().getByRole('button', { name: 'New tab', exact: true }).click()
    }

    await expect(chooser()).toBeVisible()
    await chooser().getByRole('button', { name, exact: true }).click()
  }

  async function selectFiles(): Promise<Locator> {
    await panel().locator('[data-tree-tab="files"]').click()
    const tree = fixture.page.locator('[data-project-tree]:visible')
    await expect(tree).toBeVisible()

    return tree
  }

  async function tabMenu(tab: Locator, action: string): Promise<void> {
    await tab.click({ button: 'right' })
    await fixture.page.getByRole('menuitem', { name: action, exact: true }).click()
  }

  async function expectDraft(): Promise<void> {
    await expect(composer()).toHaveText(DRAFT)
    await expect(fixture.page.locator('vite-error-overlay')).toHaveCount(0)
    expect(rendererErrors).toEqual([])
  }

  async function editorText(editor: Locator): Promise<string> {
    return editor.locator('.cm-line').evaluateAll(lines =>
      lines
        .map(line => line.textContent ?? '')
        .join('\n')
        .trimEnd()
    )
  }

  async function expectChatOwnedSummary(): Promise<void> {
    const summary = fixture.page.locator('[data-slot="summary-pane"]:visible')
    await expect(summary).toBeVisible()
    expect(
      await summary.evaluate(element => {
        const group = element.closest('[data-tree-group]')

        return Boolean(group?.querySelector('[data-chat-surface]')) && !group?.hasAttribute('data-tool-panel')
      })
    ).toBe(true)
  }

  test.describe.configure({ mode: 'serial' })

  test('shares one tool group, deduplicates files and distinguishes temporary tabs from session pins', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(120_000)
    await chooseTool('Files')
    const tree = fixture.page.locator('[data-project-tree]:visible')
    const filesGroup = await panelTabGroup(panel().locator('[data-tree-tab="files"]'))
    expect(filesGroup).not.toBeNull()
    const filesWidth = (await panel().boundingBox())!.width
    await panel().getByRole('button', { name: 'Maximize panel', exact: true }).click()
    await expect.poll(async () => (await panel().boundingBox())?.width ?? 0).toBeGreaterThan(filesWidth + 50)
    await panel().getByRole('button', { name: 'Restore panel', exact: true }).click()
    await expect.poll(async () => (await panel().boundingBox())?.width ?? 0).toBeCloseTo(filesWidth, 0)
    await tree.getByText('README.md', { exact: true }).click()
    await expect(panel()).toBeVisible()
    await expect(previewTab('README.md')).toBeVisible()
    await (await fileHost('README.md')).getByRole('button', { name: 'PREVIEW', exact: true }).click()
    await expect(fixture.page.getByRole('heading', { name: 'Panel project', exact: true })).toBeVisible()
    const readme = previewTab('README.md')
    await expect(readme).toHaveCount(1)
    expect(await panelTabGroup(readme)).toBe(filesGroup)
    expect((await savedPreviews()).find(tab => tab.target.path === path.join(project, 'README.md'))?.temporary).toBe(
      true
    )
    const readmeId = await readme.getAttribute('data-tree-tab')
    await selectFiles()
    await tree.getByText('README.md', { exact: true }).click()
    await expect(readme).toHaveCount(1)
    expect(await readme.getAttribute('data-tree-tab')).toBe(readmeId)

    await selectFiles()
    await tree.getByText('other.md', { exact: true }).click()
    await expect(previewTab('other.md')).toBeVisible()
    await expect(readme).toHaveCount(0)
    await tabMenu(previewTab('other.md'), 'Keep tab')
    await expect
      .poll(
        async () => (await savedPreviews()).find(tab => tab.target.path === path.join(project, 'other.md'))?.temporary
      )
      .not.toBe(true)
    expect((await savedPreviews()).find(tab => tab.target.path === path.join(project, 'other.md'))?.pinned).toBe(false)
    await tabMenu(previewTab('other.md'), 'Pin to workspace')
    await expect
      .poll(async () => (await savedPreviews()).find(tab => tab.target.path === path.join(project, 'other.md'))?.pinned)
      .toBe(true)
    await tabMenu(previewTab('other.md'), 'Unpin from workspace')
    await expect
      .poll(async () => (await savedPreviews()).find(tab => tab.target.path === path.join(project, 'other.md'))?.pinned)
      .toBe(false)

    await selectFiles()
    await tree.getByText('README.md', { exact: true }).dblclick()
    await expect(readme).toBeVisible()
    await expect(previewTab('other.md')).toBeVisible()
    expect((await savedPreviews()).find(tab => tab.target.path === path.join(project, 'README.md'))?.pinned).toBe(false)
    await expect
      .poll(
        async () => (await savedPreviews()).find(tab => tab.target.path === path.join(project, 'README.md'))?.temporary
      )
      .not.toBe(true)
    await selectFiles()
    await tree.getByText('notes', { exact: true }).click()
    await tree.getByText('deep.txt', { exact: true }).click()
    await expect(previewTab('deep.txt')).toBeVisible()
    await expect(readme).toBeVisible()
    await expect(previewTab('other.md')).toBeVisible()
    await readme.click()
    await fixture.page.screenshot({ path: testInfo.outputPath('panel-kept-file-survives-temporary-replacement.png') })
    const keptPaneId = await readme.getAttribute('data-tree-tab')
    const keptHost = await fileHost('README.md')
    const filesTab = panel().locator('[data-tree-tab="files"]')
    await filesTab.hover()
    await filesTab.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(filesTab).toHaveCount(0)
    await expect(keptHost).toBeVisible()
    expect(await readme.getAttribute('data-tree-tab')).toBe(keptPaneId)
    await fixture.page.reload()
    await waitForAppReady(fixture, 120_000)
    await showPanel()
    await expect(previewTab('README.md')).toBeVisible()
    expect(await previewTab('README.md').getAttribute('data-tree-tab')).toBe(keptPaneId)
    await expect(panel().locator('[data-tree-tab="files"]')).toHaveCount(0)
    await expectDraft()
    await chooseTool('Files')
    expect(await panelTabGroup(panel().locator('[data-tree-tab="files"]'))).toBe(await panelTabGroup(readme))
    await readme.click()
    await expectDraft()
    await fixture.page.screenshot({ path: testInfo.outputPath('panel-files-group-and-kept-tab.png') })
  })

  test('preserves a dirty editor on cancellation and saves through both editor and close dialog', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(120_000)
    const { page } = fixture
    await previewTab('README.md').click()
    const host = await fileHost('README.md')
    await host.getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = host.locator('.cm-content[contenteditable="true"]')
    await editor.fill(SAVED)
    const editorHandle = await editor.elementHandle()
    await previewTab('README.md').hover()
    await previewTab('README.md').getByRole('button', { name: 'Close', exact: true }).click()
    const guard = page.getByRole('dialog', { name: 'Unsaved changes', exact: true })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => editorText(editor)).toBe(SAVED.trimEnd())
    expect(await editor.evaluate((element, original) => element === original, editorHandle)).toBe(true)
    expect(readFileSync(path.join(project, 'README.md'), 'utf8')).toBe(DIRTY)
    await host.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => readFileSync(path.join(project, 'README.md'), 'utf8')).toBe(SAVED)
    const editorSaved = readFileSync(path.join(project, 'README.md'), 'utf8')
    await (await fileHost('README.md')).getByRole('button', { name: 'PREVIEW', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Panel project', exact: true })).toBeVisible()
    await expect(host.getByText('Saved through the real file editor.', { exact: true })).toBeVisible()
    await host.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect.poll(() => editorText(editor)).toBe(SAVED.trimEnd())
    const secondBaseline = await editorText(editor)
    await editor.fill(DIRTY)
    await expect.poll(() => editorText(editor)).toBe(DIRTY.trimEnd())
    await expect(previewTab('README.md').locator('[aria-label="Unsaved changes"]')).toHaveCount(1)
    await previewTab('README.md').hover()
    writeFileSync(
      testInfo.outputPath('second-editor-preclose-evidence.json'),
      JSON.stringify(
        {
          secondBaseline,
          currentEditor: await editorText(editor),
          tabHtml: await previewTab('README.md').evaluate(element => element.outerHTML),
          editorHtml: await editor.evaluate(element => element.outerHTML),
          disk: readFileSync(path.join(project, 'README.md'), 'utf8'),
          previews: await savedPreviews()
        },
        null,
        2
      )
    )
    await expect(previewTab('README.md').locator('[aria-label="Unsaved changes"]')).toHaveCount(1)
    await previewTab('README.md').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Save and close', exact: true }).click()
    await expect.poll(() => readFileSync(path.join(project, 'README.md'), 'utf8')).toBe(DIRTY)
    await expect(guard).toBeHidden()
    await expect(previewTab('README.md')).toHaveCount(0)
    writeFileSync(
      testInfo.outputPath('file-save-evidence.json'),
      JSON.stringify(
        {
          path: path.join(project, 'README.md'),
          editorSaved,
          saveAndClose: readFileSync(path.join(project, 'README.md'), 'utf8')
        },
        null,
        2
      )
    )
    await expectDraft()
    await page.screenshot({ path: testInfo.outputPath('panel-file-save-on-disk.png') })
  })

  test('keeps a dirty temporary file when another file opens and detects an external disk write', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(120_000)
    const { page } = fixture
    let tree = await selectFiles()
    await tree.getByText('README.md', { exact: true }).click()
    const host = await fileHost('README.md')
    await host.getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = host.locator('.cm-content[contenteditable="true"]')
    const draft = '# Panel project\n\nKeep this unsaved temporary edit.\n'
    await editor.fill(draft)
    const editorHandle = await editor.elementHandle()
    const readmePaneId = await previewTab('README.md').getAttribute('data-tree-tab')
    tree = await selectFiles()

    if (!(await tree.getByText('deep.txt', { exact: true }).isVisible())) {
      await tree.getByText('notes', { exact: true }).click()
    }

    await tree.getByText('deep.txt', { exact: true }).click()
    await expect(previewTab('README.md')).toHaveCount(1)
    await expect(previewTab('deep.txt')).toBeVisible()
    const hiddenHost = page.locator('[data-pane-host="' + readmePaneId + '"]')
    await expect(hiddenHost).toHaveAttribute('inert', '')
    await expect(hiddenHost.getByRole('textbox')).toHaveCount(0)
    expect(await editorHandle!.evaluate(element => element.isConnected)).toBe(true)
    const keyboardSink = panel().getByRole('button', { name: 'New tab', exact: true })
    await keyboardSink.focus()
    expect(
      await editorHandle!.evaluate(element => {
        element.focus()

        return document.activeElement === element
      })
    ).toBe(false)
    await expect(keyboardSink).toBeFocused()

    const hiddenPointerReachable = await editorHandle!.click({ trial: true, timeout: 1000 }).then(
      () => true,
      () => false
    )

    expect(hiddenPointerReachable).toBe(false)
    await keyboardSink.focus()
    await expect(keyboardSink).toBeFocused()

    const keyboardTargetBefore = await keyboardSink.evaluate(element => ({
      ownsFocus: document.activeElement === element,
      active: document.activeElement?.outerHTML
    }))

    expect(keyboardTargetBefore.ownsFocus).toBe(true)
    await page.keyboard.insertText('HIDDEN_EDITOR_MUST_NOT_CHANGE')
    writeFileSync(
      testInfo.outputPath('hidden-editor-keyboard-evidence.json'),
      JSON.stringify(
        {
          before: keyboardTargetBefore,
          after: await page.evaluate(() => document.activeElement?.outerHTML),
          draft: await composer().textContent()
        },
        null,
        2
      )
    )
    expect(
      await editorHandle!.evaluate(element =>
        [...element.querySelectorAll('.cm-line')]
          .map(line => line.textContent ?? '')
          .join('\n')
          .trimEnd()
      )
    ).toBe(draft.trimEnd())
    await previewTab('README.md').click()
    await expect.poll(() => editorText(editor)).toBe(draft.trimEnd())
    expect(await editor.evaluate((element, original) => element === original, editorHandle)).toBe(true)
    const external = '# Panel project\n\nExternal file edit.\n'
    writeFileSync(path.join(project, 'README.md'), external)
    await host.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(host.getByText('File changed on disk', { exact: true })).toBeVisible()
    expect(readFileSync(path.join(project, 'README.md'), 'utf8')).toBe(external)
    await host.getByRole('button', { name: 'Discard & reload', exact: true }).click()
    await host.getByRole('button', { name: 'PREVIEW', exact: true }).click()
    await expect(host.getByText('External file edit.', { exact: true })).toBeVisible()
    await host.getByRole('button', { name: 'Edit', exact: true }).click()
    await editor.fill('# Panel project\n\nDiscard this unsaved draft.\n')
    await previewTab('README.md').hover()
    await previewTab('README.md').getByRole('button', { name: 'Close', exact: true }).click()
    const guard = page.getByRole('dialog', { name: 'Unsaved changes', exact: true })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(previewTab('README.md')).toHaveCount(0)
    expect(readFileSync(path.join(project, 'README.md'), 'utf8')).toBe(external)
    writeFileSync(
      testInfo.outputPath('file-conflict-evidence.json'),
      JSON.stringify(
        {
          path: path.join(project, 'README.md'),
          external,
          afterDiscard: readFileSync(path.join(project, 'README.md'), 'utf8'),
          retainedEditorPaneId: readmePaneId
        },
        null,
        2
      )
    )
    await expectDraft()
    await page.screenshot({ path: testInfo.outputPath('panel-dirty-temporary-protection.png') })
  })

  test('navigates a real local browser page and keeps the guest alive through tool switches', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(120_000)
    const { app, page } = fixture
    await chooseTool('Browser')
    const profileConsent = page.getByRole('dialog', { name: 'Stay signed in to your sites', exact: true })
    await expect(profileConsent).toBeVisible()
    await profileConsent.getByRole('button', { name: 'Not now', exact: true }).click()
    await expect(profileConsent).toBeHidden()
    const address = page.getByRole('textbox', { name: 'Address', exact: true })
    await expect(address).toBeVisible()
    await address.fill(origin + '/one')
    await address.press('Enter')
    const guest = page.locator('webview:visible')
    await expect(guest).toBeVisible()
    browserGuestId = await guest.evaluate(element =>
      (element as HTMLElement & { getWebContentsId(): number }).getWebContentsId()
    )
    await expect.poll(async () => (await guestState(browserGuestId))?.body).toContain('Panel browser one')
    const active = panel().locator('[data-tree-tab][aria-selected="true"]')
    browserPaneId = (await active.getAttribute('data-tree-tab'))!
    expect(await panelTabGroup(active)).toBe(await panelTabGroup(panel().locator('[data-tree-tab="files"]')))
    await address.fill(origin + '/two')
    await address.press('Enter')
    await expect.poll(async () => (await guestState(browserGuestId))?.url).toBe(origin + '/two')
    await expect.poll(async () => (await guestState(browserGuestId))?.body).toContain('Panel browser two')
    const browserHost = page.locator('[data-pane-host="' + browserPaneId + '"]:visible')
    await browserHost.getByRole('button', { name: 'Back', exact: true }).click()
    await expect.poll(async () => (await guestState(browserGuestId))?.url).toBe(origin + '/one')
    await browserHost.getByRole('button', { name: 'Forward', exact: true }).click()
    await expect.poll(async () => (await guestState(browserGuestId))?.url).toBe(origin + '/two')
    const beforeReload = (await guestState(browserGuestId))!.marker
    await browserHost.getByRole('button', { name: 'Reload page', exact: true }).click()
    await expect.poll(async () => (await guestState(browserGuestId))?.marker).not.toBe(beforeReload)
    await expect.poll(async () => (await guestState(browserGuestId))?.body).toContain('Panel browser two')
    const beforeSwitch = await guestState(browserGuestId)
    await selectFiles()
    await panel().locator('[data-tree-tab]').filter({ hasText: 'other.md' }).click()
    await panel()
      .locator('[data-tree-tab="' + browserPaneId + '"]')
      .click()
    expect(await guestState(browserGuestId)).toEqual(beforeSwitch)
    expect(await app.evaluate(({ webContents }, id) => Boolean(webContents.fromId(id)), browserGuestId)).toBe(true)
    writeFileSync(
      testInfo.outputPath('browser-guest-evidence.json'),
      JSON.stringify(
        {
          guestId: browserGuestId,
          paneId: browserPaneId,
          beforeReload,
          beforeSwitch,
          afterSwitch: await guestState(browserGuestId)
        },
        null,
        2
      )
    )
    await expectDraft()
    await page.screenshot({ path: testInfo.outputPath('panel-browser-local-navigation.png') })
  })

  test('runs real shell commands and keeps the same PTY process when the entire panel is hidden', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(120_000)
    const { page } = fixture
    await chooseTool('Terminal')
    await expect(page.getByRole('tablist', { name: 'Terminals', exact: true })).toBeVisible()
    await expect.poll(async () => (await savedTerminals()).terminals?.length).toBe(1)
    const before = await savedTerminals()
    terminalId = before.activeTerminalId
    expect(before.terminals.find(terminal => terminal.id === terminalId)?.cwd).toBe(project)
    const terminal = page.locator('[data-terminal]:visible')
    const terminalHandle = await terminal.elementHandle()
    await shell('AINO_PANEL_PROBE=$$; printf "AINO_BEFORE:%s:END" "$AINO_PANEL_PROBE"')

    const buffer = async () =>
      (await savedTerminals()).terminals.find(term => term.id === terminalId)?.reviveBuffer ?? ''

    await expect.poll(buffer).toMatch(/AINO_BEFORE:[0-9]+:END/)
    terminalPid = (await buffer()).match(/AINO_BEFORE:([0-9]+):END/)![1]!
    await shell('printf "AINO_CWD:%s:END" "$PWD"')
    await expect.poll(buffer).toContain('AINO_CWD:' + project + ':END')
    await panel().getByRole('button', { name: 'Hide panel', exact: true }).click()
    await expect(panel()).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Show right sidebar', exact: true })).toBeVisible()
    expect(await terminalHandle!.evaluate(element => element.isConnected)).toBe(true)
    await showPanel()
    await expect(panel().locator('[data-tree-tab="terminal"]')).toHaveAttribute('aria-selected', 'true')
    await panel().locator('[data-tree-tab="terminal"]').click()
    await shell('printf "AINO_AFTER:%s:%s:END" "$AINO_PANEL_PROBE" "$$"')
    await expect.poll(buffer).toContain('AINO_AFTER:' + terminalPid + ':' + terminalPid + ':END')
    const restored = await savedTerminals()
    expect(restored.activeTerminalId).toBe(terminalId)
    expect(restored.terminals.find(term => term.id === terminalId)?.cwd).toBe(project)
    expect(await terminal.evaluate((element, original) => element === original, terminalHandle)).toBe(true)
    await panel().locator('[data-tree-tab="files"]').click()
    await panel().locator('[data-tree-tab="terminal"]').click()
    await shell('printf "AINO_SWITCH:%s:%s:END" "$AINO_PANEL_PROBE" "$$"')
    await expect.poll(buffer).toContain('AINO_SWITCH:' + terminalPid + ':' + terminalPid + ':END')
    writeFileSync(
      testInfo.outputPath('terminal-process-evidence.json'),
      JSON.stringify({ terminalId, shellPid: terminalPid, cwd: project, buffer: await buffer(), restored }, null, 2)
    )
    await expectDraft()
    await page.screenshot({ path: testInfo.outputPath('panel-terminal-real-shell-keepalive.png') })
  })

  test('opens real working-tree changes through Review in the same tool group', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(120_000)
    const { page } = fixture
    await chooseTool('Review')
    const review = page.getByRole('complementary', { name: 'Review', exact: true })
    await expect(review).toBeVisible()
    await review.getByText('README.md', { exact: true }).first().click()
    await expect(review.getByText('External file edit.', { exact: false })).toBeVisible()
    expect(await panelTabGroup(panel().locator('[data-tree-tab="review"]'))).toBe(
      await panelTabGroup(panel().locator('[data-tree-tab="files"]'))
    )
    expect(execFileSync('git', ['-C', project, 'diff', '--', 'README.md'], { encoding: 'utf8' })).toContain(
      '+External file edit.'
    )
    await expectDraft()
    await page.screenshot({ path: testInfo.outputPath('panel-review-real-git-diff.png') })
  })

  test('finds a nested project path through the chooser without duplicating its open tab', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(120_000)
    const { page } = fixture
    await panel().getByRole('button', { name: 'New tab', exact: true }).click()
    const search = chooser().getByRole('textbox', { name: 'Search project files', exact: true })
    await search.fill('notes/deep')
    const result = chooser().getByRole('button').filter({ hasText: 'deep.txt' })
    await expect(result).toBeVisible()
    await result.click()
    await previewTab('deep.txt').click()
    await expect(page.getByText('Nested panel search result.', { exact: true })).toBeVisible()
    await expect(previewTab('deep.txt')).toHaveCount(1)
    expect(
      (await savedPreviews()).filter(tab => tab.target.path === path.join(project, 'notes', 'deep.txt'))
    ).toHaveLength(1)
    await expectDraft()
    await page.screenshot({ path: testInfo.outputPath('panel-nested-project-search.png') })
  })

  test('selects tabs, maximizes and fully hides while retaining the chat draft and Summary', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(120_000)
    const { page, app } = fixture
    const input = composer()
    const inputHandle = await input.elementHandle()
    const submittedDrafts = receivedUserTexts().filter(text => text.includes(DRAFT)).length
    await page.getByRole('button', { name: 'Session resources', exact: true }).click()
    await expectChatOwnedSummary()
    await panel().getByRole('button', { name: 'List tabs', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Files', exact: true }).click()
    await expect(page.locator('[data-project-tree]:visible')).toBeVisible()
    await expect(panel().locator('[data-tree-tab="files"]')).toHaveAttribute('aria-selected', 'true')
    const normalWidth = (await panel().boundingBox())!.width
    await panel().getByRole('button', { name: 'Maximize panel', exact: true }).click()
    await expect(panel().getByRole('button', { name: 'Restore panel', exact: true })).toBeVisible()
    await expect.poll(async () => (await panel().boundingBox())?.width ?? 0).toBeGreaterThan(normalWidth + 50)
    await panel().getByRole('button', { name: 'Restore panel', exact: true }).click()
    await expect.poll(async () => (await panel().boundingBox())?.width ?? 0).toBeCloseTo(normalWidth, 0)

    const paneIds = await panel()
      .locator('[data-tree-tab]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-tree-tab')))

    const beforeGuest = await guestState(browserGuestId)

    const activePaneBeforeHide = await panel()
      .locator('[data-tree-tab][aria-selected="true"]')
      .getAttribute('data-tree-tab')

    const toolWidth = (await panel().boundingBox())!.width

    const chatGroupId = await input.evaluate(element =>
      element.closest('[data-tree-group]')?.getAttribute('data-tree-group')
    )

    const chatGroup = page
      .locator('[data-tree-group="' + chatGroupId + '"]')
      .filter({ has: page.locator('[data-chat-surface]') })

    const beforeChatWidth = (await chatGroup.boundingBox())!.width
    await panel().getByRole('button', { name: 'Hide panel', exact: true }).click()
    await expect(panel()).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Show right sidebar', exact: true })).toBeVisible()
    await expect
      .poll(async () => (await chatGroup.boundingBox())?.width ?? 0)
      .toBeGreaterThan(beforeChatWidth + toolWidth - 16)
    await expect(page.locator('[data-tree-group][data-tool-panel]:visible')).toHaveCount(0)
    await expectChatOwnedSummary()
    await expectDraft()
    expect(await input.evaluate((element, original) => element === original, inputHandle)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('panel-fully-hidden-no-restore-rail.png') })
    await showPanel()
    await expect(panel().locator('[data-tree-tab="' + activePaneBeforeHide + '"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(
      await panel()
        .locator('[data-tree-tab]')
        .evaluateAll(elements => elements.map(element => element.getAttribute('data-tree-tab')))
    ).toEqual(paneIds)
    expect(await guestState(browserGuestId)).toEqual(beforeGuest)
    expect((await savedTerminals()).terminals.some(terminal => terminal.id === terminalId)).toBe(true)
    await expectChatOwnedSummary()
    await expectDraft()
    expect(await input.evaluate((element, original) => element === original, inputHandle)).toBe(true)
    expect(receivedUserTexts().filter(text => text.includes(DRAFT))).toHaveLength(submittedDrafts)

    const originalMode = await page.evaluate(() => localStorage.getItem('hermes-desktop-mode-v1'))
    const geometry: unknown[] = []

    const recordGeometry = async (mode: string, viewport: string) => {
      geometry.push(
        await panel().evaluate(
          (element, state) => {
            const measure = (target: Element) => {
              const box = target.getBoundingClientRect()
              const style = getComputedStyle(target)

              return {
                bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
                height: style.height,
                fontSize: style.fontSize,
                borderRadius: style.borderRadius
              }
            }

            const strip = element.querySelector('[data-pane-variant="tool"]')!

            return {
              ...state,
              viewport: { width: innerWidth, height: innerHeight },
              strip: measure(strip),
              tabs: [...strip.querySelectorAll('[data-tree-tab]')].map(tab => ({
                id: tab.getAttribute('data-tree-tab'),
                ...measure(tab)
              }))
            }
          },
          { mode, size: viewport }
        )
      )
    }

    try {
      for (const mode of ['light', 'dark'] as const) {
        await page.evaluate(mode => {
          localStorage.setItem('hermes-desktop-mode-v1', mode)
          window.dispatchEvent(new StorageEvent('storage', { key: 'hermes-desktop-mode-v1' }))
        }, mode)
        await expect
          .poll(() => page.locator('html').evaluate(element => element.classList.contains('dark')))
          .toBe(mode === 'dark')
        await panel().getByRole('button', { name: 'New tab', exact: true }).click()
        await expect(chooser()).toBeVisible()
        await recordGeometry(mode, 'wide')
        await page.screenshot({ path: testInfo.outputPath('panel-chooser-' + mode + '-wide.png') })
        await chooser().getByRole('button', { name: 'Files', exact: true }).click()
      }

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 800, false))
      await showPanel()
      await panel().getByRole('button', { name: 'New tab', exact: true }).click()
      await expect(chooser()).toBeVisible()
      const box = (await panel().boundingBox())!
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(box.x).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
      expect(await chooser().evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await expectDraft()
      await recordGeometry('dark', 'narrow')
      writeFileSync(testInfo.outputPath('panel-launcher-geometry.json'), JSON.stringify(geometry, null, 2))
      await page.screenshot({ path: testInfo.outputPath('panel-chooser-dark-narrow.png') })
    } finally {
      await page.evaluate(mode => {
        if (mode === null) {
          localStorage.removeItem('hermes-desktop-mode-v1')
        } else {
          localStorage.setItem('hermes-desktop-mode-v1', mode)
        }

        window.dispatchEvent(new StorageEvent('storage', { key: 'hermes-desktop-mode-v1' }))
      }, originalMode)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
    }
  })
})

test('legacy custom Files panel unifies safe tools without a project and preserves its chat layout', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(180_000)

  const legacy = await setupMockBackend({
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    extraDisplayConfig: '  language: en'
  })

  const { app, page, sandbox } = legacy
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    const content = message.text()

    if (!['error', 'warning'].includes(message.type())) {
      return
    }

    if (content.includes('Electron Security Warning (Insecure Content-Security-Policy)')) {
      return
    }

    if (
      content.startsWith('[hermes-terminal] WebGL unavailable; falling back to DOM') &&
      content.includes('WebGL2 not supported')
    ) {
      return
    }

    errors.push(content)
  })

  const savedTree = {
    id: 'legacy-custom-root',
    type: 'split',
    orientation: 'row',
    weights: [0.9, 4.25, 1.35],
    children: [
      { id: 'legacy-rail', type: 'group', active: 'sessions', panes: ['sessions', 'hermes-bots:pane'] },
      {
        id: 'legacy-work-deck',
        type: 'split',
        orientation: 'column',
        weights: [4, 1],
        children: [
          { id: 'legacy-chat', type: 'group', active: 'workspace', panes: ['workspace'] },
          {
            id: 'legacy-terminal',
            type: 'group',
            active: 'terminal',
            panes: ['terminal', 'review'],
            tabStrip: 'always'
          }
        ]
      },
      { id: 'legacy-files', type: 'group', active: 'files', panes: ['files'], tabStrip: 'always' }
    ]
  }

  const savedSizes = {
    'chat-sidebar': { open: true },
    'file-browser': { open: false },
    sessions: { open: true, widthOverride: 260 },
    files: { open: true, widthOverride: 432 },
    terminal: { open: false, heightOverride: 190 }
  }

  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })

    const agreement = page.getByRole('checkbox', {
      name: /^(同意用户协议和隐私政策|Agree to the user agreement and privacy policy)$/
    })

    await expect(agreement).toBeVisible({ timeout: 60_000 })
    await page.getByRole('textbox', { name: /^(手机号|Phone number)$/ }).fill('13800000118')
    await agreement.check()
    await page.getByRole('button', { name: /^(发送验证码|Send code)$/ }).click()
    await page.getByRole('textbox', { name: /^(验证码|Verification code)$/ }).fill('1234')
    await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
    await waitForAppReady(legacy, 120_000)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
    const input = page.locator('[data-slot="composer-rich-input"]:visible')
    await input.fill('Prepare an empty legacy layout acceptance conversation.')
    await input.press('Enter')
    await expect(page.getByText(/Hello from the mock inference server/)).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await input.fill(DRAFT)
    await page.evaluate(
      ({ tree, sizes }) => {
        localStorage.setItem('hermes.desktop.layoutPreset.active', 'custom')
        localStorage.setItem('aino.desktop.toolPanel.v1.advanced', '1')
        localStorage.setItem('hermes.desktop.layoutTree.v2', JSON.stringify(tree))
        localStorage.setItem('hermes.desktop.paneStates.v1', JSON.stringify(sizes))
        localStorage.setItem('hermes.desktop.userPlacedPanes.v1', JSON.stringify(['files', 'terminal', 'review']))
        localStorage.setItem('hermes.desktop.collapsedTreeSides.v1', '[]')
        localStorage.setItem('hermes.desktop.dismissedPanes.v1', '["tool-new-tab"]')
      },
      { tree: savedTree, sizes: savedSizes }
    )
    await page.reload()
    await waitForAppReady(legacy, 120_000)

    const readLayout = () =>
      page.evaluate(() => ({
        tree: JSON.parse(localStorage.getItem('hermes.desktop.layoutTree.v2') || 'null'),
        sizes: JSON.parse(localStorage.getItem('hermes.desktop.paneStates.v1') || '{}'),
        preset: localStorage.getItem('hermes.desktop.layoutPreset.active'),
        migration: localStorage.getItem('aino.desktop.toolPanel.v1.advanced')
      }))

    const bootLayout = await readLayout()
    expect(bootLayout.tree).toMatchObject({
      id: savedTree.id,
      type: 'split',
      orientation: 'row',
      weights: savedTree.weights,
      children: [
        savedTree.children[0],
        savedTree.children[1].children![0],
        {
          id: 'legacy-files',
          type: 'group',
          active: 'files',
          toolPanel: true
        }
      ]
    })
    const migratedTools = bootLayout.tree.children.find((node: { id: string }) => node.id === 'legacy-files')
    expect(migratedTools.panes[0]).toBe('files')
    expect([...migratedTools.panes].sort()).toEqual(['files', 'review', 'terminal'])
    expect(bootLayout.sizes.files).toEqual(savedSizes.files)
    expect(bootLayout.sizes.terminal).toEqual(savedSizes.terminal)
    expect(bootLayout.preset).toBe('custom')
    expect(bootLayout.migration).toBe('1')
    await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
    const files = page.locator('[data-tree-group="legacy-files"]:visible')
    await selectInitialLegacyFiles(files)
    await files.getByRole('button', { name: 'Hide panel', exact: true }).click()
    await expect(files).toHaveCount(0)
    await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
    await expect(files).toBeVisible()
    const beforeOpen = await readLayout()
    expect(beforeOpen.tree).toEqual({
      ...bootLayout.tree,
      children: bootLayout.tree.children.map((node: { id: string }) =>
        node.id === 'legacy-files' ? { ...node, minimized: false } : node
      )
    })
    await expect(files.locator('[data-tree-tab="files"]')).toBeVisible()
    await expect(page.getByText('No open projects', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Select project', exact: true })).toBeVisible()
    const beforeControls = { layout: await readLayout(), bounds: await files.boundingBox() }
    writeFileSync(testInfo.outputPath('legacy-before-controls.json'), JSON.stringify(beforeControls, null, 2))
    await expect(files.getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
    await expect(files.getByRole('button', { name: 'List tabs', exact: true })).toBeVisible()
    await expect(files.getByRole('button', { name: 'Maximize panel', exact: true })).toBeVisible()
    await expect(files).toHaveAttribute('data-tool-panel', 'true')
    const width = (await files.boundingBox())!.width
    expect(width).toBeCloseTo(432, 0)
    await files.getByRole('button', { name: 'New tab', exact: true }).click()
    const launcher = page.locator('[data-tool-chooser]:visible')
    await expect(launcher).toBeVisible()
    await expect(launcher.getByRole('button', { name: 'Files', exact: true })).toBeVisible()
    await expect(files.locator('[data-tree-tab="tool-new-tab"]')).toHaveAttribute('aria-selected', 'true')
    const chooserBeforeReload = await readLayout()
    await page.reload()
    await waitForAppReady(legacy, 120_000)
    await expect(files).toBeVisible()
    await expect(files).toHaveAttribute('data-tool-panel', 'true')
    await expect(launcher).toBeVisible()
    await expect(files.locator('[data-tree-tab="tool-new-tab"]')).toHaveAttribute('aria-selected', 'true')
    await expect(files.getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
    await expect(files.getByRole('button', { name: 'List tabs', exact: true })).toBeVisible()
    await expect(files.getByRole('button', { name: 'Maximize panel', exact: true })).toBeVisible()
    await expect.poll(async () => (await files.boundingBox())?.width ?? 0).toBeCloseTo(width, 0)
    const chooserAfterReload = await readLayout()
    expect(chooserAfterReload.tree).toEqual(chooserBeforeReload.tree)
    expect(chooserAfterReload.sizes.files).toEqual(savedSizes.files)
    expect(chooserAfterReload.sizes.terminal).toEqual(savedSizes.terminal)
    expect(chooserAfterReload.preset).toBe('custom')
    await expect(page.locator('[data-slot="composer-rich-input"]:visible')).toHaveText(DRAFT)
    writeFileSync(
      testInfo.outputPath('legacy-chooser-reload-evidence.json'),
      JSON.stringify(
        { before: chooserBeforeReload, after: chooserAfterReload, bounds: await files.boundingBox() },
        null,
        2
      )
    )
    await page.screenshot({ path: testInfo.outputPath('legacy-custom-chooser-restored.png') })
    await launcher.getByRole('button', { name: 'Files', exact: true }).click()
    await expect(files.locator('[data-tree-tab="files"]')).toHaveAttribute('aria-selected', 'true')
    await files.getByRole('button', { name: 'List tabs', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Files', exact: true }).click()
    await files.getByRole('button', { name: 'Maximize panel', exact: true }).click()
    await expect.poll(async () => (await files.boundingBox())?.width ?? 0).toBeGreaterThan(width + 50)
    await files.getByRole('button', { name: 'Restore panel', exact: true }).click()
    await expect.poll(async () => (await files.boundingBox())?.width ?? 0).toBeCloseTo(width, 0)

    const chat = page
      .locator('[data-tree-group="legacy-chat"]:visible')
      .filter({ has: page.locator('[data-chat-surface]') })

    const chatWidth = (await chat.boundingBox())!.width
    await page.screenshot({ path: testInfo.outputPath('legacy-custom-files-controls.png') })
    await files.getByRole('button', { name: 'Hide panel', exact: true }).click()
    await expect(files).toHaveCount(0)
    await expect(page.locator('[data-tree-track="legacy-files"]:visible')).toHaveCount(0)
    await expect.poll(async () => (await chat.boundingBox())?.width ?? 0).toBeGreaterThan(chatWidth + width - 16)
    await expect(page.getByRole('button', { name: 'Show right sidebar', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('legacy-custom-fully-hidden.png') })
    await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
    await expect(files).toBeVisible()
    await expect(files.locator('[data-tree-tab="files"]')).toHaveAttribute('aria-selected', 'true')
    await expect.poll(async () => (await files.boundingBox())?.width ?? 0).toBeCloseTo(width, 0)
    await files.getByRole('button', { name: 'New tab', exact: true }).click()
    await expect(launcher).toBeVisible()
    const createdTab = files.locator('[data-tree-tab="tool-new-tab"]')
    await expect(createdTab).toHaveAttribute('aria-selected', 'true')

    const panesBeforeClose: string[] = (await readLayout()).tree.children.find(
      (node: { id: string }) => node.id === 'legacy-files'
    ).panes

    const chooserPosition = panesBeforeClose.indexOf('tool-new-tab')
    const expectedSibling = panesBeforeClose[chooserPosition - 1] || panesBeforeClose[chooserPosition + 1]
    await createdTab.hover()
    await createdTab.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(createdTab).toHaveCount(0)
    await expect
      .poll(async () => {
        const group = (await readLayout()).tree.children.find((node: { id: string }) => node.id === 'legacy-files')

        return { active: group.active, panes: group.panes }
      })
      .toEqual({ active: expectedSibling, panes: panesBeforeClose.filter(id => id !== 'tool-new-tab') })
    await files.locator('[data-tree-tab="files"]').click()
    await expect(files.locator('[data-tree-tab="files"]')).toHaveAttribute('aria-selected', 'true')
    await expect.poll(async () => (await readLayout()).tree).toEqual(beforeOpen.tree)
    const final = await readLayout()
    expect(final.tree).toEqual(beforeOpen.tree)
    expect(final.sizes.files).toEqual(savedSizes.files)
    expect(final.sizes.terminal).toEqual(savedSizes.terminal)
    expect(final.preset).toBe('custom')
    await expect(page.locator('[data-slot="composer-rich-input"]:visible')).toHaveText(DRAFT)
    expect(errors).toEqual([])
    writeFileSync(
      testInfo.outputPath('legacy-layout-evidence.json'),
      JSON.stringify({ beforeOpen, beforeControls, final, errors }, null, 2)
    )
  } catch (error) {
    writeFileSync(
      testInfo.outputPath('legacy-failure-diagnostics.json'),
      JSON.stringify(
        await page
          .evaluate(() => ({
            storage: Object.fromEntries(
              Object.entries(localStorage).filter(([key]) => /layout|pane|toolPanel/i.test(key))
            ),
            body: document.body.innerText,
            groups: [...document.querySelectorAll<HTMLElement>('[data-tree-group]')].map(element => ({
              data: { ...element.dataset },
              bounds: element.getBoundingClientRect().toJSON(),
              text: element.innerText.slice(0, 1500),
              html: element.outerHTML.slice(0, 8000)
            }))
          }))
          .then(value => ({ ...value, errors })),
        null,
        2
      )
    )
    throw error
  } finally {
    const logs = path.join(sandbox.hermesHome, 'logs')

    if (existsSync(logs)) {
      cpSync(logs, testInfo.outputPath('backend-logs'), { recursive: true })
    }

    try {
      stopFixtureGateway(sandbox)
    } finally {
      await legacy.cleanup()
    }
  }
})

test('legacy tool layouts unify at boot and keep every resource entry in one horizontal panel', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(240_000)

  const legacy = await setupMockBackend({
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    extraDisplayConfig: '  language: en'
  })

  const { app, page, sandbox } = legacy
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    const content = message.text()

    if (!['error', 'warning'].includes(message.type())) {
      return
    }

    if (content.includes('Electron Security Warning (Insecure Content-Security-Policy)')) {
      return
    }

    if (
      content.startsWith('[hermes-terminal] WebGL unavailable; falling back to DOM') &&
      content.includes('WebGL2 not supported')
    ) {
      return
    }

    errors.push(content)
  })

  const savedTree = {
    id: 'legacy-review-root',
    type: 'split',
    orientation: 'row',
    weights: [0.85, 3.8, 1.35, 1.2, 0.8],
    children: [
      { id: 'legacy-review-rail', type: 'group', active: 'sessions', panes: ['sessions', 'hermes-bots:pane'] },
      { id: 'legacy-review-chat', type: 'group', active: 'workspace', panes: ['workspace'] },
      { id: 'legacy-review-files', type: 'group', active: 'files', panes: ['files'], tabStrip: 'never' },
      {
        id: 'legacy-review-separated',
        type: 'group',
        active: 'review',
        panes: ['review'],
        tabStrip: 'never',
        minimized: true
      },
      {
        id: 'legacy-terminal-separated',
        type: 'group',
        active: 'terminal',
        panes: ['terminal'],
        tabStrip: 'never',
        minimized: true
      }
    ]
  }

  const toolPanel = () => page.locator('[data-tree-group="legacy-review-files"][data-tool-panel]:visible')
  const review = () => page.getByRole('complementary', { name: 'Review', exact: true })
  const input = () => page.locator('[data-slot="composer-rich-input"]:visible')

  const readState = () =>
    page.evaluate(() => ({
      tree: JSON.parse(localStorage.getItem('hermes.desktop.layoutTree.v2') || 'null'),
      sizes: JSON.parse(localStorage.getItem('hermes.desktop.paneStates.v1') || '{}'),
      preset: localStorage.getItem('hermes.desktop.layoutPreset.active'),
      reviewOpen: localStorage.getItem('hermes.desktop.reviewOpen'),
      groups: [...document.querySelectorAll<HTMLElement>('[data-tree-group]')]
        .filter(element => element.getBoundingClientRect().width > 0 && element.querySelector('[data-tree-tab]'))
        .map(element => ({
          id: element.dataset.treeGroup,
          toolPanel: element.dataset.toolPanel,
          tabs: [...element.querySelectorAll<HTMLElement>('[data-tree-tab]')].map(tab => ({
            id: tab.dataset.treeTab,
            selected: tab.getAttribute('aria-selected')
          })),
          bounds: element.getBoundingClientRect().toJSON()
        }))
    }))

  const chooseReview = async () => {
    await toolPanel().getByRole('button', { name: 'New tab', exact: true }).click()
    const chooser = page.locator('[data-tool-chooser]:visible')
    await expect(chooser).toBeVisible()
    await chooser.getByRole('button', { name: 'Review', exact: true }).click()
  }

  const expectDocked = async () => {
    await expect(toolPanel().locator('[data-tree-tab="review"]')).toHaveAttribute('aria-selected', 'true')
    await expect(toolPanel().locator('[data-tree-tab="files"]')).toBeVisible()
    await expect(page.locator('[data-tree-tab="review"]:visible')).toHaveCount(1)
    await expect(page.locator('[data-tree-group="legacy-review-separated"]:visible')).toHaveCount(0)
    await expect(page.locator('[data-tree-track="legacy-review-separated"]:visible')).toHaveCount(0)
    await expect(page.locator('[data-tree-track="legacy-terminal-separated"]:visible')).toHaveCount(0)
    await expect(review()).toBeVisible()
    expect(
      await review().evaluate(element => element.closest('[data-tree-group]')?.getAttribute('data-tree-group'))
    ).toBe('legacy-review-files')
    await expect(input()).toHaveText(DRAFT)
    const state = await readState()
    expect(state.tree.children.map((node: { id: string }) => node.id)).toEqual([
      'legacy-review-rail',
      'legacy-review-chat',
      'legacy-review-files'
    ])
    expect(state.tree.children.find((node: { id: string }) => node.id === 'legacy-review-files')).toMatchObject({
      active: 'review',
      toolPanel: true
    })
    const host = state.tree.children.find((node: { id: string }) => node.id === 'legacy-review-files')
    expect(host.panes[0]).toBe('files')
    expect([...host.panes].sort()).toEqual(['files', 'review', 'terminal'])
    expect(errors).toEqual([])
  }

  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })

    const agreement = page.getByRole('checkbox', {
      name: /^(同意用户协议和隐私政策|Agree to the user agreement and privacy policy)$/
    })

    await expect(agreement).toBeVisible({ timeout: 60_000 })
    await page.getByRole('textbox', { name: /^(手机号|Phone number)$/ }).fill('13800000128')
    await agreement.check()
    await page.getByRole('button', { name: /^(发送验证码|Send code)$/ }).click()
    await page.getByRole('textbox', { name: /^(验证码|Verification code)$/ }).fill('1234')
    await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
    await waitForAppReady(legacy, 120_000)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
    const { project, baselineHead } = prepareLegacyReviewProject(sandbox.root, ORIGINAL, DIRTY)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, project)
    await page.getByRole('button', { name: 'Open folder as project…', exact: true }).click()
    await expect(
      page.locator('[data-chat-surface]:visible').getByRole('button', { name: path.basename(project), exact: true })
    ).toBeVisible()
    await input().fill('Prepare the isolated legacy Review docking acceptance project.')
    await input().press('Enter')
    await expect(page.getByText(/Hello from the mock inference server/)).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await input().fill(DRAFT)
    const bootEvidence: unknown[] = []

    for (const marker of [null, '1']) {
      await page.evaluate(
        ({ tree, marker }) => {
          localStorage.setItem('hermes.desktop.layoutPreset.active', 'custom')

          if (marker === null) {
            localStorage.removeItem('aino.desktop.toolPanel.v1.advanced')
          } else {
            localStorage.setItem('aino.desktop.toolPanel.v1.advanced', marker)
          }

          localStorage.setItem('hermes.desktop.layoutTree.v2', JSON.stringify(tree))
          const states = JSON.parse(localStorage.getItem('hermes.desktop.paneStates.v1') || '{}')
          states['file-browser'] = { ...states['file-browser'], open: true }
          states.files = { open: true, widthOverride: 432 }
          states.review = { open: true, widthOverride: 360 }
          states.terminal = { open: false, heightOverride: 190 }
          localStorage.setItem('hermes.desktop.paneStates.v1', JSON.stringify(states))
          localStorage.setItem('hermes.desktop.reviewOpen', 'true')
          localStorage.setItem('hermes.desktop.userPlacedPanes.v1', '["files","review","terminal"]')
          localStorage.setItem('hermes.desktop.collapsedTreeSides.v1', '[]')
          localStorage.setItem('hermes.desktop.dismissedPanes.v1', '["tool-new-tab"]')
        },
        { tree: savedTree, marker }
      )
      await page.reload()
      await waitForAppReady(legacy, 120_000)
      const state = await readState()
      bootEvidence.push({ marker, state })
      writeFileSync(testInfo.outputPath('legacy-panel-boot-evidence.json'), JSON.stringify(bootEvidence, null, 2))
      await page.screenshot({ path: testInfo.outputPath('legacy-panel-boot-marker-' + (marker ?? 'absent') + '.png') })
      await expect(toolPanel()).toBeVisible()
      const host = state.tree.children.find((node: { id: string }) => node.id === 'legacy-review-files')
      expect(host).toMatchObject({ active: 'files', toolPanel: true })
      expect(host.panes[0]).toBe('files')
      expect([...host.panes].sort()).toEqual(['files', 'review', 'terminal'])
      expect(host.minimized).not.toBe(true)
      await toolPanel().getByRole('button', { name: 'Hide panel', exact: true }).click()
      await expect(toolPanel()).toHaveCount(0)
      await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
      await expect(toolPanel().locator('[data-tree-tab="files"]')).toHaveAttribute('aria-selected', 'true')
      await expect(toolPanel().getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
      await expect(toolPanel().getByRole('button', { name: 'List tabs', exact: true })).toBeVisible()
      await expect(toolPanel().getByRole('button', { name: 'Maximize panel', exact: true })).toBeVisible()
      await expect(page.locator('[data-tree-track="legacy-review-separated"]:visible')).toHaveCount(0)
      await expect(page.locator('[data-tree-track="legacy-terminal-separated"]:visible')).toHaveCount(0)
      expect(
        await toolPanel()
          .locator('[data-zone-tabstrip]')
          .evaluate(element => {
            const style = getComputedStyle(element)

            return style.flexDirection
          })
      ).toBe('row')
      await expect.poll(async () => (await toolPanel().boundingBox())?.width ?? 0).toBeCloseTo(432, 0)
      await expect(input()).toHaveText(DRAFT)
    }

    const entryEvidence: unknown[] = []

    const recordEntry = async (entry: string) => {
      const state = await readState()
      entryEvidence.push({ entry, state })
      writeFileSync(testInfo.outputPath('legacy-panel-entry-evidence.json'), JSON.stringify(entryEvidence, null, 2))
      expect(state.tree.children.map((node: { id: string }) => node.id)).toEqual([
        'legacy-review-rail',
        'legacy-review-chat',
        'legacy-review-files'
      ])
      await expect(page.locator('[data-tool-panel]:visible')).toHaveCount(1)
      await expect(page.locator('[data-tree-track="legacy-review-separated"]:visible')).toHaveCount(0)
      await expect(page.locator('[data-tree-track="legacy-terminal-separated"]:visible')).toHaveCount(0)
      await expect(input()).toHaveText(DRAFT)
      expect(errors).toEqual([])
    }

    await page
      .locator('[data-chat-surface]:visible')
      .getByRole('button', { name: 'View changes', exact: true })
      .first()
      .click()
    await expectDocked()
    await recordEntry('composer View changes')
    await toolPanel().locator('[data-tree-tab="files"]').click()
    await page.keyboard.press('ControlOrMeta+g')
    await expectDocked()
    await recordEntry('Review keyboard shortcut')
    await toolPanel().getByRole('button', { name: 'New tab', exact: true }).click()
    await page.locator('[data-tool-chooser]:visible').getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(toolPanel().locator('[data-tree-tab="terminal"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tablist', { name: 'Terminals', exact: true })).toBeVisible()
    await recordEntry('Terminal chooser')
    await toolPanel().locator('[data-tree-tab="files"]').click()
    await page
      .locator('[data-slot="titlebar-app-controls"]')
      .getByRole('button', { name: /^(Toggle terminal|Hide terminal)$/ })
      .click()
    await expect(toolPanel().locator('[data-tree-tab="terminal"]')).toHaveAttribute('aria-selected', 'true')
    await recordEntry('Terminal titlebar')
    await toolPanel().getByRole('button', { name: 'New tab', exact: true }).click()

    const search = page
      .locator('[data-tool-chooser]:visible')
      .getByRole('textbox', { name: 'Search project files', exact: true })

    await search.fill('notes/deep')
    await page.locator('[data-tool-chooser]:visible').getByRole('button').filter({ hasText: 'deep.txt' }).click()
    const nestedTab = toolPanel().locator('[data-tree-tab]').filter({ hasText: 'deep.txt' })
    await expect(nestedTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Unified panel nested preview.', { exact: true })).toBeVisible()
    await recordEntry('chooser file search preview')
    await nestedTab.hover()
    await nestedTab.getByRole('button', { name: 'Close', exact: true }).click()
    await toolPanel().locator('[data-tree-tab="files"]').click()
    await page.locator('[data-project-tree]:visible').getByText('README.md', { exact: true }).click()
    const fileTab = toolPanel().locator('[data-tree-tab]').filter({ hasText: 'README.md' })
    await expect(fileTab).toHaveAttribute('aria-selected', 'true')
    await recordEntry('Files tree preview')
    await fileTab.hover()
    await fileTab.getByRole('button', { name: 'Close', exact: true }).click()
    await toolPanel().locator('[data-tree-tab="files"]').click()
    const before = await readState()
    await chooseReview()
    const opened = await readState()
    writeFileSync(testInfo.outputPath('legacy-review-open-evidence.json'), JSON.stringify({ before, opened }, null, 2))
    await expectDocked()
    await review().getByText('README.md', { exact: true }).first().click()
    await expect(review().getByText('Local working tree change.', { exact: false })).toBeVisible()
    const dockedWidth = (await toolPanel().boundingBox())!.width
    expect(dockedWidth).toBeCloseTo(432, 0)
    await verifyLegacyReviewGeometry({ page, testInfo, review, toolPanel, expectDocked, dockedWidth })
    await page.screenshot({ path: testInfo.outputPath('legacy-review-docked-diff.png') })
    const longDiffMarker = 'AINO_REVIEW_LONG_DIFF_LAST_LINE'
    writeFileSync(
      path.join(project, 'README.md'),
      ORIGINAL +
        Array.from({ length: 300 }, (_, index) => 'Legacy review scrolling row ' + index).join('\n') +
        '\n' +
        longDiffMarker +
        '\n'
    )
    await review().getByRole('button', { name: 'Refresh tree', exact: true }).click()
    await review().getByText('README.md', { exact: true }).first().click()
    const diffScroller = review().locator('[data-slot="file-diff-panel"] > div').first()
    await expect
      .poll(() => diffScroller.evaluate(element => element.scrollHeight - element.clientHeight))
      .toBeGreaterThan(1000)

    const fixedChrome = async () => ({
      scope: await review().getByRole('button', { name: 'Uncommitted', exact: true }).boundingBox(),
      message: await review()
        .getByPlaceholder(/to commit/)
        .boundingBox(),
      commit: await review().getByRole('button', { name: 'Commit', exact: true }).boundingBox()
    })

    const chromeBeforeScroll = await fixedChrome()
    const scrollBox = (await diffScroller.boundingBox())!
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2)
    await page.mouse.wheel(0, 10_000)
    await expect.poll(() => diffScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(1000)
    const lastLine = diffScroller.getByText(longDiffMarker, { exact: true })
    await expect(lastLine).toBeAttached()

    const longDiffVisible = await lastLine.evaluate(element => {
      const row = element.getBoundingClientRect()
      let top = Math.max(row.top, 0)
      let bottom = Math.min(row.bottom, innerHeight)

      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowY)) {
          const clip = ancestor.getBoundingClientRect()
          top = Math.max(top, clip.top)
          bottom = Math.min(bottom, clip.bottom)
        }
      }

      return { row: row.toJSON(), visibleHeight: Math.max(0, bottom - top) }
    })

    expect(longDiffVisible.visibleHeight).toBeGreaterThan(0)
    const chromeAfterScroll = await fixedChrome()
    expect(chromeAfterScroll).toEqual(chromeBeforeScroll)
    await expect(input()).toHaveText(DRAFT)
    writeFileSync(
      testInfo.outputPath('legacy-review-long-diff-scroll-evidence.json'),
      JSON.stringify(
        {
          chromeBeforeScroll,
          chromeAfterScroll,
          longDiffVisible,
          scroll: await diffScroller.evaluate(element => ({
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight
          }))
        },
        null,
        2
      )
    )
    await toolPanel().screenshot({ path: testInfo.outputPath('legacy-review-long-diff-bottom.png') })
    writeFileSync(path.join(project, 'README.md'), DIRTY)
    await review().getByRole('button', { name: 'Refresh tree', exact: true }).click()
    await review().getByText('README.md', { exact: true }).first().click()
    await diffScroller.evaluate(element => {
      element.scrollTop = 0
    })
    await expect(review().getByText('Local working tree change.', { exact: false })).toBeVisible()
    await expect(diffScroller.getByText(longDiffMarker, { exact: true })).toHaveCount(0)
    await toolPanel().locator('[data-tree-tab="files"]').click()
    await expect(page.locator('[data-project-tree]:visible')).toBeVisible()
    await expect(review()).toBeHidden()
    await toolPanel().locator('[data-tree-tab="review"]').click()
    await expectDocked()
    await chooseReview()
    await expectDocked()
    const beforeReload = await readState()
    await page.reload()
    await waitForAppReady(legacy, 120_000)
    await expectDocked()
    const afterReload = await readState()
    expect(afterReload.tree).toEqual(beforeReload.tree)
    expect(afterReload.preset).toBe('custom')
    await expect.poll(async () => (await toolPanel().boundingBox())?.width ?? 0).toBeCloseTo(dockedWidth, 0)
    await review().getByText('README.md', { exact: true }).first().click()
    await expect(review().getByText('Local working tree change.', { exact: false })).toBeVisible()

    const tabOrderBeforeReviewClose = await toolPanel()
      .locator('[data-tree-tab]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-tree-tab')))

    const reviewTab = toolPanel().locator('[data-tree-tab="review"]')
    await reviewTab.hover()
    await reviewTab.getByRole('button', { name: 'Close', exact: true }).click()
    expect(
      await toolPanel()
        .locator('[data-tree-tab]')
        .evaluateAll(elements => elements.map(element => element.getAttribute('data-tree-tab')))
    ).toEqual(tabOrderBeforeReviewClose.filter(id => id !== 'review'))
    await expect(toolPanel()).toBeVisible()
    await expect(toolPanel().locator('[data-tree-tab="review"]')).toHaveCount(0)
    const reviewPosition = tabOrderBeforeReviewClose.indexOf('review')

    const expectedSibling =
      tabOrderBeforeReviewClose[reviewPosition - 1] || tabOrderBeforeReviewClose[reviewPosition + 1]

    await expect(toolPanel().locator('[data-tree-tab="' + expectedSibling + '"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(toolPanel().locator('[data-tree-tab="files"]')).toBeVisible()
    await toolPanel().locator('[data-tree-tab="files"]').click()
    await expect(toolPanel().locator('[data-tree-tab="files"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-project-tree]:visible')).toBeVisible()
    await expect(review()).toBeHidden()
    await expect(input()).toHaveText(DRAFT)
    await chooseReview()
    await expectDocked()
    await verifyLegacyPanelResponsive({
      fixture: legacy,
      testInfo,
      project,
      errors,
      draft: DRAFT,
      toolPanel,
      input,
      readState,
      expectDocked,
      recordEntry
    })
    await page.getByRole('button', { name: 'Session resources', exact: true }).click()
    const summary = page.locator('[data-slot="summary-pane"]:visible')
    await expect(summary).toBeVisible()
    expect(
      await summary.evaluate(element => {
        const group = element.closest('[data-tree-group]')

        return Boolean(group?.querySelector('[data-chat-surface]')) && !group?.hasAttribute('data-tool-panel')
      })
    ).toBe(true)
    await expect(toolPanel().locator('[data-slot="summary-pane"]')).toHaveCount(0)
    await expectDocked()
    await review().getByText('README.md', { exact: true }).first().click()
    await expect(review().getByText('Local working tree change.', { exact: false })).toBeVisible()
    const final = await readState()
    const gitDiff = verifyLegacyReviewProject(project, baselineHead, DIRTY)
    expect(errors).toEqual([])
    writeFileSync(
      testInfo.outputPath('legacy-review-final-evidence.json'),
      JSON.stringify({ before, opened, beforeReload, afterReload, final, baselineHead, gitDiff, errors }, null, 2)
    )
    await page.screenshot({ path: testInfo.outputPath('legacy-review-summary-and-diff.png') })
  } catch (error) {
    writeFileSync(
      testInfo.outputPath('legacy-review-failure-diagnostics.json'),
      JSON.stringify({ state: await readState(), body: await page.locator('body').innerText(), errors }, null, 2)
    )
    throw error
  } finally {
    const logs = path.join(sandbox.hermesHome, 'logs')

    if (existsSync(logs)) {
      cpSync(logs, testInfo.outputPath('backend-logs'), { recursive: true })
    }

    try {
      stopFixtureGateway(sandbox)
    } finally {
      await legacy.cleanup()
    }
  }
})
