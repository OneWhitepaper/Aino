import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture

test.beforeAll(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
})

test('keeps navigation paint continuous into the titlebar without boxed icons', async ({ browserName: _browserName }, testInfo) => {
  const { page } = fixture

  const original = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-hermes-theme'),
    glass: document.documentElement.hasAttribute('data-hermes-glass'),
    dark: document.documentElement.classList.contains('dark')
  }))

  try {
    for (const mode of ['light', 'dark', 'custom', 'glass'] as const) {
      await page.evaluate(mode => {
        const root = document.documentElement
        root.setAttribute('data-hermes-theme', mode === 'custom' ? 'slate' : 'nous')
        root.classList.toggle('dark', mode === 'dark')
        root.toggleAttribute('data-hermes-glass', mode === 'glass')
      }, mode)

      const colors = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('[data-aino-sidebar]')!
        const group = sidebar.closest<HTMLElement>('[data-tree-group]')!
        const titlebar = document.querySelector<HTMLElement>('[data-slot="app-titlebar"]')!
        const icons = [...sidebar.querySelectorAll<HTMLElement>('[data-slot="sidebar-nav-icon"]')]
        const tabs = [...group.querySelectorAll<HTMLElement>('[data-tree-tab]')]

        return {
          rail: getComputedStyle(group).backgroundColor,
          top: getComputedStyle(titlebar, '::before').backgroundColor,
          canvas: getComputedStyle(titlebar).backgroundColor,
          iconsUnboxed:
            icons.length > 0 && icons.every(icon => getComputedStyle(icon).backgroundColor === 'rgba(0, 0, 0, 0)'),
          tabsUnboxed: tabs.every(tab => getComputedStyle(tab).backgroundColor === 'rgba(0, 0, 0, 0)'),
          tabLabelsFit: tabs.every(tab => {
            const label =
              tab.querySelector<HTMLElement>('[data-slot="pane-tab-label"]') ?? tab.children[1]?.firstElementChild

            return !label || label.scrollWidth <= label.clientWidth
          }),
          sidebarShadow: getComputedStyle(sidebar).boxShadow,
          sidebarBorders: [getComputedStyle(sidebar).borderLeftWidth, getComputedStyle(sidebar).borderRightWidth]
        }
      })

      expect(colors.top, `${mode}: the titlebar must continue the rail paint`).toBe(colors.rail)
      expect(colors.rail, `${mode}: navigation must remain distinct from the canvas`).not.toBe(colors.canvas)
      expect(colors.iconsUnboxed).toBe(true)
      expect(colors.tabsUnboxed, `${mode}: tabs must not double-paint the Glass tint`).toBe(true)
      expect(colors.tabLabelsFit).toBe(true)
      expect(colors.sidebarShadow).toBe('none')
      expect(colors.sidebarBorders).toEqual(['0px', '0px'])
      await page.screenshot({ path: testInfo.outputPath(`sidebar-${mode}.png`) })
    }
  } finally {
    await page.evaluate(original => {
      const root = document.documentElement

      if (original.theme === null) {root.removeAttribute('data-hermes-theme')}
      else {root.setAttribute('data-hermes-theme', original.theme)}

      root.toggleAttribute('data-hermes-glass', original.glass)
      root.classList.toggle('dark', original.dark)
    }, original)
  }
})

test('preserves navigation and the Sessions, Agent Hub and Terminal tabs', async () => {
  const { page } = fixture

  for (const route of ['skills', 'messaging', 'artifacts', 'cron', 'session-import']) {
    const button = page.locator(`[data-sidebar="menu-button"]:has([data-tour="sidebar-nav-${route}"])`)
    await button.click()
    await expect(page).toHaveURL(new RegExp(`#/${route}$`))
    await expect(button).toHaveAttribute('data-active', 'true')
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.locator('[data-sidebar="menu-button"]:has([data-tour="sidebar-nav-new-session"])').click()
    await expect(page.locator('[data-chat-surface][data-home-layout]')).toBeVisible()
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible()
  }

  // Exercise the user's mixed navigation stack in an isolated profile.
  await page.evaluate(() =>
    localStorage.setItem(
      'hermes.desktop.layoutTree.v2',
      JSON.stringify({
        active: 'workspace',
        id: 'sidebar-test-root',
        type: 'split',
        orientation: 'row',
        weights: [1, 4],
        children: [
          {
            id: 'sidebar-test-rail',
            type: 'group',
            active: 'sessions',
            panes: ['sessions', 'hermes-bots:pane', 'terminal']
          },
          { id: 'sidebar-test-main', type: 'group', active: 'workspace', panes: ['workspace'] }
        ]
      })
    )
  )
  await page.reload()
  await waitForAppReady(fixture, 120_000)

  for (const pane of ['hermes-bots:pane', 'terminal', 'sessions']) {
    const tab = page.locator(`[data-tree-tab="${pane}"]`)
    await tab.click()
    await expect(tab).toHaveAttribute('data-active', 'true')
  }

  await expect(page.locator('[data-aino-sidebar]')).toBeVisible()
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible()
})

test('keeps the rail boundary aligned through resize, mirroring and hiding', async ({ browserName: _browserName }, testInfo) => {
  const { page, app } = fixture
  const rail = page.locator('[data-aino-sidebar]')

  const boundary = () =>
    page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>('[data-aino-sidebar]')!
      const group = sidebar.closest<HTMLElement>('[data-tree-group]')!
      const rect = group.getBoundingClientRect()
      const titlebar = document.querySelector<HTMLElement>('[data-slot="app-titlebar"]')!
      const top = getComputedStyle(titlebar, '::before')
      const side = rect.left < 1 ? 'left' : 'right'
      const edge = side === 'left' ? rect.right : rect.left

      const sash = [...document.querySelectorAll<HTMLElement>('[data-sash-axis="x"]')].find(
        el => Math.abs(el.getBoundingClientRect().left + 1 - edge) < 2
      )

      const line = sash?.querySelector<HTMLElement>('span')
      const stroke = line && getComputedStyle(line)

      return {
        aligned: Math.abs(parseFloat(top.left) - rect.left) <= 1 && Math.abs(parseFloat(top.width) - rect.width) <= 1,
        continuous: !!line && Math.abs(line.getBoundingClientRect().top - titlebar.getBoundingClientRect().bottom) <= 1,
        singleStroke:
          stroke?.opacity === '1' &&
          stroke.backgroundColor === (side === 'left' ? top.borderRightColor : top.borderLeftColor),
        side,
        width: rect.width
      }
    })

  const expectBoundary = async () => {
    await expect.poll(async () => (await boundary()).aligned).toBe(true)
    expect((await boundary()).continuous).toBe(true)
    expect((await boundary()).singleStroke).toBe(true)
  }

  await expectBoundary()
  const before = await rail.boundingBox()
  await page.mouse.move(before!.x + before!.width, 350)
  await page.mouse.down()

  try {
    await page.mouse.move(before!.x + before!.width + 60, 350, { steps: 8 })
    await expect.poll(async () => (await boundary()).width).toBeGreaterThan(before!.width + 30)
    await expectBoundary()
  } finally {
    await page.mouse.up()
  }

  await page.getByRole('button', { name: 'Swap sidebar sides', exact: true }).click()
  await expect.poll(async () => (await boundary()).side).toBe('right')
  await expectBoundary()
  await page.screenshot({ path: testInfo.outputPath('sidebar-right.png') })
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await expect(rail).toBeHidden()
  await expect
    .poll(() => page.locator('[data-slot="app-titlebar"]').evaluate(el => getComputedStyle(el, '::before').content))
    .toBe('none')
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
  await expect(rail).toBeVisible()
  await expectBoundary()
  await page.getByRole('button', { name: 'Swap sidebar sides', exact: true }).click()

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 800, false))
  await expectBoundary()
  await page.screenshot({ path: testInfo.outputPath('sidebar-narrow.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 800, false))

  await page
    .locator('[data-slot="titlebar-app-controls"]')
    .getByRole('button', { name: 'Open settings', exact: true })
    .click()
  await expect(page.locator('[data-settings-workspace]')).toBeVisible()
  await expect
    .poll(() => page.locator('[data-slot="app-titlebar"]').evaluate(el => getComputedStyle(el, '::before').content))
    .toBe('none')
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()
  await expectBoundary()

  await page.evaluate(() =>
    localStorage.setItem(
      'hermes.desktop.layoutTree.v2',
      JSON.stringify({
        active: 'workspace',
        id: 'sidebar-test-root',
        type: 'split',
        orientation: 'row',
        weights: [1, 4],
        children: [
          { id: 'sidebar-test-rail', type: 'group', active: 'sessions', panes: ['sessions', 'hermes-bots:pane'] },
          { id: 'sidebar-test-main', type: 'group', active: 'workspace', panes: ['workspace', 'terminal'] }
        ]
      })
    )
  )
  await page.reload()
  await waitForAppReady(fixture, 120_000)
  await expect(page.locator('[data-window-session-title]')).toHaveCount(0)
  await expectBoundary()

  await page.evaluate(() => {
    const tree = JSON.parse(localStorage.getItem('hermes.desktop.layoutTree.v2')!)
    tree.children.splice(1, 0, { id: 'hidden-files', type: 'group', active: 'files', panes: ['files'] })
    tree.weights = [1, 1, 4]
    localStorage.setItem('hermes.desktop.layoutTree.v2', JSON.stringify(tree))
  })
  await page.reload()
  await waitForAppReady(fixture, 120_000)
  const hideFiles = page.getByRole('button', { name: 'Hide right sidebar', exact: true })

  if (await hideFiles.isVisible()) {await hideFiles.click()}
  await expect(page.locator('[data-tree-group="hidden-files"]')).toBeHidden()
  await expectBoundary()
})

test('highlights the whole navigation boundary through hover, clamped drag and release', async ({ browserName: _browserName }, testInfo) => {
  const { page, app } = fixture
  const rail = page.locator('[data-aino-sidebar]')

  const paint = () =>
    page.evaluate(() => {
      const titlebar = document.querySelector<HTMLElement>('[data-slot="app-titlebar"]')!
      const top = getComputedStyle(titlebar, '::after')

      const rail = document
        .querySelector<HTMLElement>('[data-aino-sidebar]')!
        .closest<HTMLElement>('[data-tree-group]')!

      const bounds = rail.getBoundingClientRect()
      const edge = bounds.left < 1 ? bounds.right : bounds.left

      const sash = [...document.querySelectorAll<HTMLElement>('[data-navigation-boundary]')].find(
        node => Math.abs(node.getBoundingClientRect().left + 1 - edge) < 2
      )!

      const band = sash.children[1] as HTMLElement
      const bottom = getComputedStyle(band)
      const bandRect = band.getBoundingClientRect()
      const translateX = top.transform === 'none' ? 0 : new DOMMatrixReadOnly(top.transform).e

      return {
        topOpacity: top.content === 'none' ? 0 : Number(top.opacity),
        bottomOpacity: Number(bottom.opacity),
        colorMatches: top.backgroundColor === bottom.backgroundColor,
        widthMatches: Math.abs(parseFloat(top.width) - bandRect.width) < 0.5,
        aligned:
          Math.abs(titlebar.getBoundingClientRect().left + parseFloat(top.left) + translateX - bandRect.left) < 0.5,
        topHasNoHitTarget: top.pointerEvents === 'none',
        side: bounds.left < 1 ? 'left' : 'right'
      }
    })

  const expectHighlight = async (opacity: number) => {
    await expect.poll(async () => (await paint()).bottomOpacity).toBe(opacity)
    await expect.poll(async () => (await paint()).topOpacity).toBe(opacity)

    if (opacity) {
      const result = await paint()
      expect(result.colorMatches).toBe(true)
      expect(result.widthMatches).toBe(true)
      expect(result.aligned).toBe(true)
      expect(result.topHasNoHitTarget).toBe(true)
    }
  }

  try {
    for (const [width, side] of [
      [1220, 'left'],
      [760, 'right']
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800, false),
        width
      )

      if ((await paint()).side !== side) {
        await page.getByRole('button', { name: 'Swap sidebar sides', exact: true }).click()
      }

      await expect.poll(async () => (await paint()).side).toBe(side)
      await page.mouse.move(width / 2, 450)
      await expectHighlight(0)
      const bounds = await rail.boundingBox()
      const edge = side === 'left' ? bounds!.x + bounds!.width : bounds!.x
      await page.mouse.move(edge + 1, 300)
      await expectHighlight(1)
      await page.mouse.down()

      try {
        // Beyond the minimum size, the pointer no longer follows the sash.
        await page.mouse.move(side === 'left' ? -100 : width + 100, 300, { steps: 6 })
        await expectHighlight(1)
        await page.screenshot({ path: testInfo.outputPath(`sidebar-boundary-drag-${side}.png`) })
      } finally {
        await page.mouse.up()
      }

      await page.mouse.move(width / 2, 450)
      await expectHighlight(0)
    }
  } finally {
    await page.mouse.up()

    if ((await paint()).side !== 'left') {
      await page.getByRole('button', { name: 'Swap sidebar sides', exact: true }).click()
    }

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 800, false))
  }
})
