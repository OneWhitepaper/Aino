import { readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import type { Locator, TestInfo } from '@playwright/test'

import type { MockBackendFixture } from './fixtures'
import { expect as baseExpect } from './test'

const expect = baseExpect.configure({ timeout: 30_000 })

interface LegacyPanelState {
  tree: { children: { id: string; panes: string[] }[] }
}

interface LegacyPanelResponsiveProof {
  fixture: MockBackendFixture
  testInfo: TestInfo
  project: string
  errors: string[]
  draft: string
  toolPanel: () => Locator
  input: () => Locator
  readState: () => Promise<LegacyPanelState>
  expectDocked: () => Promise<void>
  recordEntry: (entry: string) => Promise<void>
}

export async function verifyLegacyPanelResponsive({
  fixture,
  testInfo,
  project,
  errors,
  draft,
  toolPanel,
  input,
  readState,
  expectDocked,
  recordEntry
}: LegacyPanelResponsiveProof) {
  const { app, page } = fixture
  const beforeWholeHide = await readState()
  const panelWidth = (await toolPanel().boundingBox())!.width

  const chatGroup = page
    .locator('[data-tree-group="legacy-review-chat"]:visible')
    .filter({ has: page.locator('[data-chat-surface]') })

  const chatWidth = (await chatGroup.boundingBox())!.width
  await toolPanel().getByRole('button', { name: 'Hide panel', exact: true }).click()
  await expect(page.locator('[data-tool-panel]:visible')).toHaveCount(0)
  await expect(page.locator('[data-tree-track="legacy-review-files"]:visible')).toHaveCount(0)
  await expect
    .poll(async () => (await chatGroup.boundingBox())?.width ?? 0)
    .toBeGreaterThan(chatWidth + panelWidth - 16)
  await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
  await expectDocked()
  expect((await readState()).tree).toEqual(beforeWholeHide.tree)
  await recordEntry('whole panel hide and titlebar restore')
  await toolPanel().locator('[data-tree-tab="terminal"]').click()
  const terminalHost = page.locator('[data-pane-host="terminal"]:visible')
  const terminalHandle = await terminalHost.elementHandle()
  await toolPanel().locator('[data-tree-tab="files"]').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(600, 800, false))
  await expect.poll(() => page.evaluate(() => matchMedia('(max-width: 639.98px)').matches)).toBe(true)
  await expect(page.locator('[data-tree-track="legacy-review-files"]:visible')).toHaveCount(0)
  await input().click()
  await page.keyboard.press('ControlOrMeta+g')
  const overlay = () => page.locator('[data-narrow-overlay][data-tool-panel]:visible')
  const narrowTabGeometry: unknown[] = []

  const expectOverlay = async (active: string) => {
    await expect(overlay()).toHaveCount(1)
    await expect(overlay()).toHaveAttribute('data-narrow-overlay', active)
    const selectedTab = overlay().getByRole('tab', { selected: true })

    const readTabGeometry = () =>
      selectedTab.evaluate(element => {
        const clippedBounds = (target: Element) => {
          const bounds = target.getBoundingClientRect()
          let left = Math.max(bounds.left, 0)
          let right = Math.min(bounds.right, innerWidth)
          let top = Math.max(bounds.top, 0)
          let bottom = Math.min(bounds.bottom, innerHeight)

          for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor)
            const clip = ancestor.getBoundingClientRect()

            if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
              left = Math.max(left, clip.left)
              right = Math.min(right, clip.right)
            }

            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
              top = Math.max(top, clip.top)
              bottom = Math.min(bottom, clip.bottom)
            }
          }

          return {
            bounds: bounds.toJSON(),
            visibleWidth: Math.max(0, right - left),
            visibleHeight: Math.max(0, bottom - top)
          }
        }

        const label = element.querySelector('[data-slot="pane-tab-label"]')!
        const close = element.querySelector('[data-slot="pane-tab-close"] button')
        const list = element.closest('[role="tablist"]')!

        return {
          ...clippedBounds(element),
          label: clippedBounds(label),
          close: close ? clippedBounds(close) : null,
          list: {
            bounds: list.getBoundingClientRect().toJSON(),
            scrollLeft: list.scrollLeft,
            scrollWidth: list.scrollWidth,
            clientWidth: list.clientWidth
          },
          borderRadius: getComputedStyle(element).borderRadius,
          background: getComputedStyle(element).backgroundColor
        }
      })

    const initialGeometry = await readTabGeometry()
    narrowTabGeometry.push({ active, phase: 'before visibility wait', ...initialGeometry })
    writeFileSync(
      testInfo.outputPath('legacy-panel-narrow-tab-geometry.json'),
      JSON.stringify(narrowTabGeometry, null, 2)
    )
    await expect
      .poll(
        async () => {
          const geometry = await readTabGeometry()
          const required = [geometry.label, ...(geometry.close ? [geometry.close] : [])]

          return required.every(
            part =>
              part.bounds.width > 0 &&
              part.bounds.height > 0 &&
              part.visibleWidth >= part.bounds.width - 1 &&
              part.visibleHeight >= part.bounds.height - 1
          )
        },
        { message: 'Selected narrow tab label and Close must fit the actual clipped viewport' }
      )
      .toBe(true)
    const tabGeometry = await readTabGeometry()
    narrowTabGeometry.push({ active, ...tabGeometry })
    writeFileSync(
      testInfo.outputPath('legacy-panel-narrow-tab-geometry.json'),
      JSON.stringify(narrowTabGeometry, null, 2)
    )
    expect(tabGeometry.bounds.height).toBe(32)
    expect(tabGeometry.borderRadius).toBe('6px')
    await expect(page.locator('[data-tree-track="legacy-review-files"]:visible')).toHaveCount(0)
    await expect(page.locator('[data-tree-track="legacy-review-separated"]:visible')).toHaveCount(0)
    await expect(page.locator('[data-tree-track="legacy-terminal-separated"]:visible')).toHaveCount(0)

    const resourceDiagnostics = await page.evaluate(() => {
      const selectors = [
        '[data-terminal]',
        '[data-tool-chooser]',
        '[data-project-tree]',
        'aside[aria-label="Review"]',
        '[data-pane-overlay="true"][data-pane-host^="preview-tile:"]'
      ]

      return Object.fromEntries(
        selectors.map(selector => [
          selector,
          [...document.querySelectorAll<HTMLElement>(selector)].map(element => {
            const ancestry: unknown[] = []

            for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
              const box = parent.getBoundingClientRect()
              const style = getComputedStyle(parent)
              ancestry.push({
                tag: parent.tagName,
                data: { ...parent.dataset },
                ariaHidden: parent.getAttribute('aria-hidden'),
                inert: parent.inert,
                bounds: box.toJSON(),
                display: style.display,
                visibility: style.visibility,
                position: style.position,
                overflow: style.overflow,
                opacity: style.opacity
              })
            }

            return { text: element.innerText.slice(0, 300), ancestry }
          })
        ])
      )
    })

    writeFileSync(
      testInfo.outputPath(
        'legacy-panel-narrow-resources-' + active.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120) + '.json'
      ),
      JSON.stringify(resourceDiagnostics, null, 2)
    )

    const paintedResourceCount = () =>
      page.evaluate(() => {
        const selectors = [
          '[data-terminal]',
          '[data-tool-chooser]',
          '[data-project-tree]',
          'aside[aria-label="Review"]',
          '[data-pane-overlay="true"][data-pane-host^="preview-tile:"]'
        ]

        return selectors.map(
          selector =>
            [...document.querySelectorAll<HTMLElement>(selector)].filter(element => {
              const rect = element.getBoundingClientRect()

              if (getComputedStyle(element).visibility !== 'visible' || rect.width <= 0 || rect.height <= 0) {
                return false
              }

              let top = Math.max(rect.top, 0)
              let bottom = Math.min(rect.bottom, innerHeight)
              let left = Math.max(rect.left, 0)
              let right = Math.min(rect.right, innerWidth)

              for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor)

                if (style.display === 'none' || Number(style.opacity) === 0) {
                  return false
                }

                const clip = ancestor.getBoundingClientRect()

                if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
                  top = Math.max(top, clip.top)
                  bottom = Math.min(bottom, clip.bottom)
                }

                if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
                  left = Math.max(left, clip.left)
                  right = Math.min(right, clip.right)
                }
              }

              return bottom > top && right > left
            }).length
        )
      })

    await expect.poll(async () => (await paintedResourceCount()).reduce((total, count) => total + count, 0)).toBe(1)
    await expect(page.locator('[data-pane-host="terminal"]')).toHaveCount(1)
    await expect(overlay().getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
    await expect(overlay().getByRole('button', { name: 'List tabs', exact: true })).toBeVisible()
    await expect(overlay().getByRole('button', { name: 'Maximize panel', exact: true })).toHaveCount(0)
    await expect(input()).toHaveText(draft)
    expect(errors).toEqual([])
  }

  await expectOverlay('review')
  await overlay().getByRole('button', { name: 'New tab', exact: true }).click()
  await expectOverlay('tool-new-tab')
  await page.locator('[data-tool-chooser]:visible').getByRole('button', { name: 'Files', exact: true }).click()
  await expectOverlay('files')
  await expect(page.locator('[data-project-tree]:visible')).toBeVisible()
  await overlay().getByRole('button', { name: 'New tab', exact: true }).click()
  await page.locator('[data-tool-chooser]:visible').getByRole('button', { name: 'Terminal', exact: true }).click()
  await expectOverlay('terminal')
  expect(await terminalHandle!.evaluate(element => element.isConnected)).toBe(true)
  expect(await terminalHost.evaluate((element, original) => element === original, terminalHandle)).toBe(true)
  await overlay().getByRole('button', { name: 'New tab', exact: true }).click()
  await page.locator('[data-tool-chooser]:visible').getByRole('button', { name: 'Browser', exact: true }).click()
  const browserConsent = page.getByRole('dialog', { name: 'Stay signed in to your sites', exact: true })
  await expect(browserConsent).toBeVisible()
  await browserConsent.getByRole('button', { name: 'Not now', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Address', exact: true })).toBeVisible()
  const browserPaneId = await overlay().getAttribute('data-narrow-overlay')
  expect(browserPaneId).toMatch(/^preview-tile:/)
  await expectOverlay(browserPaneId!)
  writeFileSync(
    testInfo.outputPath('legacy-panel-narrow-overlay-evidence.json'),
    JSON.stringify(
      {
        state: await readState(),
        browserPaneId,
        visibleHosts: await page.locator('[data-pane-overlay="true"]:visible').count(),
        dockTracks: await page.locator('[data-tree-track="legacy-review-files"]:visible').count()
      },
      null,
      2
    )
  )
  await page.screenshot({ path: testInfo.outputPath('legacy-panel-narrow-browser-overlay.png') })
  const browserTab = overlay().locator('[data-narrow-overlay-tab="' + browserPaneId + '"]')
  await browserTab.hover()
  await browserTab.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('[data-pane-host="' + browserPaneId + '"]')).toHaveCount(0)
  await expect(overlay().locator('[data-narrow-overlay-tab="' + browserPaneId + '"]')).toHaveCount(0)
  await expectOverlay('terminal')
  await overlay().getByRole('button', { name: 'New tab', exact: true }).click()

  const narrowSearch = page
    .locator('[data-tool-chooser]:visible')
    .getByRole('textbox', { name: 'Search project files', exact: true })

  await narrowSearch.fill('notes/deep')
  await page.locator('[data-tool-chooser]:visible').getByRole('button').filter({ hasText: 'deep.txt' }).click()
  await expect(overlay()).toHaveAttribute('data-narrow-overlay', /^preview-tile:/)
  const narrowFileId = (await overlay().getAttribute('data-narrow-overlay'))!
  await expectOverlay(narrowFileId)
  const narrowFileHost = page.locator('[data-pane-host="' + narrowFileId + '"]:visible')
  await narrowFileHost.getByRole('button', { name: 'Edit', exact: true }).click()
  const narrowEditor = narrowFileHost.locator('.cm-content[contenteditable="true"]')
  await narrowEditor.fill('Keep this narrow editor draft.\n')
  const narrowEditorHandle = await narrowEditor.elementHandle()
  const narrowFileTab = overlay().locator('[data-narrow-overlay-tab="' + narrowFileId + '"]')
  await narrowFileTab.hover()
  await narrowFileTab.getByRole('button', { name: 'Close', exact: true }).click()
  const dirtyGuard = page.getByRole('dialog', { name: 'Unsaved changes', exact: true })
  await expect(dirtyGuard).toBeVisible()
  await dirtyGuard.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expectOverlay(narrowFileId)
  expect(await narrowEditor.evaluate((element, original) => element === original, narrowEditorHandle)).toBe(true)
  await expect(narrowEditor).toContainText('Keep this narrow editor draft.')
  expect(readFileSync(path.join(project, 'notes', 'deep.txt'), 'utf8')).toBe('Unified panel nested preview.\n')
  await page.screenshot({ path: testInfo.outputPath('legacy-panel-narrow-dirty-cancel.png') })
  await narrowFileTab.hover()
  await narrowFileTab.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dirtyGuard).toBeVisible()
  await dirtyGuard.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page.locator('[data-pane-host="' + narrowFileId + '"]')).toHaveCount(0)
  const narrowChooserTab = overlay().locator('[data-narrow-overlay-tab="tool-new-tab"]')
  await expect(narrowChooserTab).toHaveAttribute('aria-selected', 'true')
  await expectOverlay('tool-new-tab')
  await narrowChooserTab.hover()
  await narrowChooserTab.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(narrowChooserTab).toHaveCount(0)
  await expect
    .poll(
      async () =>
        (await readState()).tree.children.find((node: { id: string }) => node.id === 'legacy-review-files')!.panes
    )
    .toEqual(['files', 'review', 'terminal'])
  await overlay().getByRole('button', { name: 'List tabs', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Review', exact: true }).click()
  await expectOverlay('review')
  await page.screenshot({ path: testInfo.outputPath('legacy-panel-narrow-return-review.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
  await expect(toolPanel()).toBeVisible()
  await toolPanel().locator('[data-tree-tab="review"]').click()
  await expectDocked()
  expect(await terminalHandle!.evaluate(element => element.isConnected)).toBe(true)
  expect((await readState()).tree).toEqual(beforeWholeHide.tree)
  await recordEntry('narrow Review chooser Files Terminal Browser and wide restore')

  const toggleMode = async (expected: 'simple' | 'advanced') => {
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog').filter({ has: page.getByRole('combobox') })
    const search = palette.getByRole('combobox')
    await search.fill('Simple mode')
    const modeOption = palette.getByRole('option').filter({ hasText: 'Simple mode' })
    await expect(modeOption).toHaveCount(1)

    if ((await modeOption.getAttribute('aria-selected')) !== 'true') {
      await search.press('ArrowDown')
    }

    await expect(modeOption).toHaveAttribute('aria-selected', 'true')
    await search.press('Enter')
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hermes.desktop.interfaceMode.v1') === 'simple'))
      .toBe(expected === 'simple')
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  }

  await toggleMode('simple')
  await page.keyboard.press('ControlOrMeta+g')
  const simplePanel = page.locator('[data-tool-panel]:visible')
  await expect(simplePanel).toHaveCount(1)
  await expect(simplePanel.locator('[data-tree-tab="review"]')).toHaveAttribute('aria-selected', 'true')
  await expect(input()).toHaveText(draft)
  await toggleMode('advanced')
  await expectDocked()
  expect((await readState()).tree).toEqual(beforeWholeHide.tree)
  await recordEntry('Simple explicit Review and Advanced restore')
}
