import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture
let folder: string
const rendererErrors: string[] = []
const longName = 'a-long-file-name-that-must-stay-inside-the-file-pane.md'

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: en',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true'
  })
  const { app, page, sandbox } = fixture
  await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', error => rendererErrors.push(error.message))
  expect(
    await page.evaluate(
      () => (window as Window & { hermesDesktop?: { accountAdapter?: string } }).hermesDesktop?.accountAdapter
    )
  ).toBe('legacy-development')

  const agreement = page.getByRole('checkbox', {
    name: /^(同意用户协议和隐私政策|Agree to the user agreement and privacy policy)$/
  })

  await expect(agreement).toBeVisible({ timeout: 60_000 })
  await page.getByRole('textbox', { name: /^(手机号|Phone number)$/ }).fill('13800000109')
  await agreement.check()
  await page.getByRole('button', { name: /^(发送验证码|Send code)$/ }).click()
  await page.getByRole('textbox', { name: /^(验证码|Verification code)$/ }).fill('1234')
  await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
  await waitForAppReady(fixture, 120_000)
  await page.evaluate(() => {
    localStorage.setItem('hermes.desktop.layoutPreset.active', 'custom')
    localStorage.setItem(
      'hermes.desktop.layoutTree.v2',
      JSON.stringify({
        active: 'workspace',
        id: 'file-test-root',
        type: 'split',
        orientation: 'row',
        weights: [1, 3, 1],
        children: [
          { id: 'file-test-rail', type: 'group', active: 'sessions', panes: ['sessions', 'hermes-bots:pane'] },
          { id: 'file-test-chat', type: 'group', active: 'workspace', panes: ['workspace'] },
          { id: 'file-test-files', type: 'group', active: 'files', panes: ['files'], tabStrip: 'always' }
        ]
      })
    )
  })
  await page.reload()
  await waitForAppReady(fixture, 120_000)

  folder = path.join(realpathSync(sandbox.root), 'SampleWorkspace')
  mkdirSync(path.join(folder, 'notes'), { recursive: true })
  writeFileSync(path.join(folder, 'notes', 'draft.md'), '# File pane preview\n')
  writeFileSync(path.join(folder, longName), '# A long filename\n')
  await app.evaluate(({ dialog }, selectedFolder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFolder] })
  }, folder)
  await page.getByRole('button', { name: 'Open folder as project\u2026', exact: true }).click()
  await expect(page.locator('[data-slot="composer-surface"]:visible').getByRole('button', {
    name: 'SampleWorkspace', exact: true,
  })).toBeVisible({ timeout: 30_000 })
  const showFiles = page.getByRole('button', { name: 'Show right sidebar', exact: true })

  if (await showFiles.isVisible()) {await showFiles.click()}
  await page.locator('[data-tool-chooser]:visible').getByRole('button', { name: 'Files', exact: true }).click()
  await expect(page.locator('[data-project-tree]').getByText('notes', { exact: true })).toBeVisible()
})

test.afterAll(async () => {
  await fixture?.cleanup()
})

test('file chrome follows the conversation theme without changing directory names or overflowing', async ({ browserName: _browserName }, testInfo) => {
  const { page, app } = fixture

  const original = await page.evaluate(() => ({
    theme: localStorage.getItem('hermes-desktop-theme-v2'),
    mode: localStorage.getItem('hermes-desktop-mode-v1')
  }))

  try {
    for (const mode of ['light', 'dark', 'glass'] as const) {
      await page.evaluate(mode => {
        // Follow the real peer-window preference path so palette seeds, not
        // just the dark class, reach every component and the native window.
        localStorage.setItem('hermes-desktop-theme-v2', 'mono')
        localStorage.setItem('hermes-desktop-mode-v1', mode === 'dark' ? 'dark' : 'light')
        window.dispatchEvent(new StorageEvent('storage', { key: 'hermes-desktop-mode-v1' }))
      }, mode)
      await expect(page.locator('html')).toHaveAttribute('data-hermes-theme', 'mono')
      await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('dark'))).toBe(mode === 'dark')

      if (
        mode === 'glass' &&
        (await page.evaluate(() => {
          const desktopWindow = window as Window & { hermesDesktop?: { glassSupported?: boolean } }

          return Boolean(desktopWindow.hermesDesktop?.glassSupported)
        }))
      ) {
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        await page.getByRole('button', { name: 'Appearance', exact: true }).click()
        await page.getByRole('tab', { name: 'Window & layout', exact: true }).click()
        await page.getByRole('button', { name: /Transparency/ }).click()
        await page.getByRole('button', { name: 'Glass', exact: true }).click()
        await page.getByRole('button', { name: 'Close settings', exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-hermes-glass', '')
      }

      await expect
        .poll(() =>
          page.evaluate(() =>
            document
              .getAnimations()
              .every(animation => !(animation instanceof CSSTransition) || animation.playState !== 'running')
          )
        )
        .toBe(true)

      const appearance = await page.evaluate(() => {
        const tree = document.querySelector<HTMLElement>('[data-project-tree]')!
        const pane = tree.closest('aside')!
        const heading = pane.querySelector<HTMLElement>('[data-sidebar-label-tone]')!
        const tab = document.querySelector<HTMLElement>('[data-tree-tab="files"]')!
        const section = document.querySelector<HTMLElement>('[data-sidebar-section-label]')!
        const row = tree.querySelector<HTMLElement>('[role="treeitem"]')!
        const label = row.querySelector<HTMLElement>('.truncate')!
        const chat = document.querySelector<HTMLElement>('[data-chat-surface]')!
        const primary = document.querySelector<HTMLElement>('[data-sidebar="menu-button"]')!
        const headStyle = getComputedStyle(heading)
        const labelStyle = getComputedStyle(label)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!

        const color = (value: string) => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = value
          context.fillRect(0, 0, 1, 1)

          return [...context.getImageData(0, 0, 1, 1).data]
        }

        return {
          headingCase: headStyle.textTransform,
          headingColor: color(headStyle.color),
          sectionColor: color(getComputedStyle(section).color),
          fontMatches: headStyle.fontFamily === getComputedStyle(chat).fontFamily,
          headingSize: headStyle.fontSize,
          sectionSize: getComputedStyle(section).fontSize,
          headingRole: color(getComputedStyle(document.documentElement).getPropertyValue('--ui-text-primary')),
          rowRole: color(getComputedStyle(document.documentElement).getPropertyValue('--ui-text-secondary')),
          rowColor: color(labelStyle.color),
          primaryColor: color(getComputedStyle(primary).color),
          tabAccent: getComputedStyle(tab).getPropertyValue('--pane-tab-active-accent').trim(),
          paneBorders: [getComputedStyle(pane).borderLeftWidth, getComputedStyle(pane).borderRightWidth],
          paneShadow: getComputedStyle(pane).boxShadow,
          labelFits: label.scrollWidth <= label.clientWidth || labelStyle.textOverflow === 'ellipsis',
          lineFits: parseFloat(labelStyle.lineHeight) < row.getBoundingClientRect().height,
          noHorizontalOverflow: tree.scrollWidth <= tree.clientWidth
        }
      })

      expect(appearance.headingCase, `${mode}: preserve the actual directory spelling`).toBe('none')
      expect(appearance.headingColor).toEqual(appearance.headingRole)
      expect(appearance.fontMatches).toBe(true)
      expect(parseFloat(appearance.headingSize)).toBeGreaterThanOrEqual(parseFloat(appearance.sectionSize))
      expect(parseFloat(appearance.headingSize)).toBeLessThanOrEqual(14)
      expect(appearance.rowColor).toEqual(appearance.rowRole)
      expect(appearance.tabAccent, `${mode}: a file tab is neutral workspace chrome`).toBe('transparent')
      expect(appearance.paneBorders).toEqual(['0px', '0px'])
      expect(appearance.paneShadow).toBe('none')
      expect(appearance.labelFits).toBe(true)
      expect(appearance.lineFits).toBe(true)
      expect(appearance.noHorizontalOverflow).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`file-browser-${mode}.png`) })
    }

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 800, false))
    const showFiles = page.getByRole('button', { name: 'Show right sidebar', exact: true })

    if (await showFiles.isVisible()) {await showFiles.click()}
    const tree = page.locator('[data-project-tree]:visible')
    await expect(tree).toBeVisible()
    expect(await tree.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    const title = page.locator('aside:visible [data-sidebar-label-tone]')
    expect(await title.evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('file-browser-narrow.png') })
    expect(rendererErrors).toEqual([])
  } finally {
    await page.evaluate(original => {
      for (const [key, value] of [
        ['hermes-desktop-theme-v2', original.theme],
        ['hermes-desktop-mode-v1', original.mode]
      ] as const) {
        if (value === null) {localStorage.removeItem(key)}
        else {localStorage.setItem(key, value)}
      }

      window.dispatchEvent(new StorageEvent('storage', { key: 'hermes-desktop-mode-v1' }))
    }, original)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 800, false))
  }
})

test('file rows retain expand, preview, rename and attach operations with stable geometry', async ({ browserName: _browserName }, testInfo) => {
  const { page } = fixture
  const composerSurface = page.locator('[data-slot="composer-surface"]:visible')
  const homeShadow = await composerSurface.evaluate(el => getComputedStyle(el).boxShadow)
  const composer = page.locator('[data-slot="composer-rich-input"]:visible')
  await composer.fill('Check the file pane')
  await composer.press('Enter')
  await expect(page.getByText(/Hello from the mock inference server/)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  expect(await composerSurface.evaluate(el => getComputedStyle(el).boxShadow)).toBe(homeShadow)
  const tree = page.locator('[data-project-tree]:visible')
  const notes = tree.getByText('notes', { exact: true })
  await notes.click()
  const draft = tree.getByText('draft.md', { exact: true })
  await expect(draft).toBeVisible()
  const folderBox = await notes.boundingBox()
  const childBox = await draft.boundingBox()
  expect(childBox!.x).toBeGreaterThan(folderBox!.x)
  expect(childBox!.y).toBeGreaterThanOrEqual(folderBox!.y + folderBox!.height)

  await draft.dblclick()
  await expect(page.getByText('File pane preview', { exact: true })).toBeVisible()
  await page.locator('[data-tree-tab="files"]:visible').click()
  await expect(draft).toBeVisible()
  await draft.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename\u2026', exact: true }).click()
  const rename = tree.getByRole('textbox', { name: 'New name', exact: true })
  await expect(rename).toBeFocused()
  const renameBox = await rename.boundingBox()
  const treeBox = await tree.boundingBox()
  expect(renameBox!.x + renameBox!.width).toBeLessThanOrEqual(treeBox!.x + treeBox!.width)
  await rename.fill('polished.md')
  await rename.press('Enter')
  await expect(tree.getByText('polished.md', { exact: true })).toBeVisible()
  expect(existsSync(path.join(folder, 'notes', 'draft.md'))).toBe(false)
  expect(readFileSync(path.join(folder, 'notes', 'polished.md'), 'utf8')).toBe('# File pane preview\n')

  const file = tree.getByText(longName, { exact: true })
  await file.dragTo(page.locator('[data-slot="composer-rich-input"]:visible'))
  await expect(page.locator('[data-slot="composer-root"]:visible').getByText(longName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse all folders', exact: true }).click()
  await expect(tree.getByText('polished.md', { exact: true })).toHaveCount(0)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('file-browser-actions.png') })

  await file.dblclick()
  const previewTab = page.locator('[data-tree-tab]').filter({ hasText: longName })
  await previewTab.dragTo(page.locator('[data-zone-tabstrip="file-test-files"]'))
  await expect(
    page.locator('[data-zone-tabstrip="file-test-files"] [data-tree-tab]').filter({ hasText: longName })
  ).toBeVisible()
  await previewTab.hover()
  const close = previewTab.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeVisible()
  expect(
    await previewTab.evaluate(el => {
      const content = el.querySelector<HTMLElement>('.pane-tab-content')!
      const label = el.querySelector<HTMLElement>('[data-slot="pane-tab-label"]')!
      const close = el.querySelector<HTMLElement>('[data-slot="pane-tab-close"] button')!
      const bounds = close.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      const reserved = parseFloat(getComputedStyle(content).paddingRight)

      return (
        reserved >= bounds.width &&
        label.getBoundingClientRect().right <= bounds.left + 1 &&
        Boolean(hit && close.contains(hit))
      )
    }),
    'the filename leaves enough room for the clickable close chip on solid and glass surfaces'
  ).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('file-browser-long-tab-close.png') })
  await close.click()
  await expect(previewTab).toHaveCount(0)

  await page.evaluate(() => {
    const layout = JSON.parse(localStorage.getItem('hermes.desktop.layoutTree.v2')!)
    localStorage.setItem('hermes.desktop.layoutPreset.active', 'custom')
    localStorage.setItem(
      'hermes.desktop.layoutTree.v2',
      JSON.stringify({
        ...layout,
        weights: [1, 4],
        children: [
          { id: 'file-test-rail', type: 'group', active: 'sessions', panes: ['sessions', 'hermes-bots:pane'] },
          {
            id: 'file-test-stack',
            type: 'split',
            orientation: 'column',
            weights: [3, 1],
            children: [
              { id: 'file-test-chat', type: 'group', active: 'workspace', panes: ['workspace'] },
              { id: 'file-test-files', type: 'group', active: 'files', panes: ['files'], tabStrip: 'always' }
            ]
          }
        ]
      })
    )
  })
  await page.reload()
  await waitForAppReady(fixture, 120_000)

  const group = page
    .locator('[data-tree-group="file-test-files"]')
    .filter({ has: page.locator('[data-zone-tabstrip="file-test-files"]') })

  await group.locator('[data-tree-tab="files"]').click()
  await group.locator('[data-zone-tabstrip="file-test-files"]').hover()
  const mountedTree = await group.locator('[data-project-tree]').elementHandle()
  await group.getByRole('button', { name: 'Hide panel', exact: true }).click()
  await expect(group.locator('[data-project-tree]')).toBeHidden()
  await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
  await expect(group.locator('[data-project-tree]')).toBeVisible()
  expect(await group.locator('[data-project-tree]').evaluate((element, original) => element === original, mountedTree)).toBe(true)
  const restored = await group.boundingBox()
  const tab = await group.locator('[data-tree-tab="files"]').boundingBox()
  expect(tab!.y + tab!.height, 'the full tab and its close target fit the restored panel').toBeLessThanOrEqual(
    restored!.y + restored!.height
  )
})
