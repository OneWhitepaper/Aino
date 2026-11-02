import { writeFileSync } from 'node:fs'

import type { Locator, Page, TestInfo } from '@playwright/test'

import { expect as baseExpect } from './test'

const expect = baseExpect.configure({ timeout: 30_000 })

interface LegacyReviewGeometryProof {
  page: Page
  testInfo: TestInfo
  review: () => Locator
  toolPanel: () => Locator
  expectDocked: () => Promise<void>
  dockedWidth: number
}

export async function verifyLegacyReviewGeometry({
  page,
  testInfo,
  review,
  toolPanel,
  expectDocked,
  dockedWidth
}: LegacyReviewGeometryProof) {
  const originalMode = await page.evaluate(() => localStorage.getItem('hermes-desktop-mode-v1'))
  const uiGeometry: unknown[] = []

  const recordReviewGeometry = async (mode: 'light' | 'dark', size: 'wide' | 'narrow') => {
    await expect(review().getByRole('button', { name: 'Uncommitted', exact: true })).toBeVisible()
    await expect(review().getByPlaceholder(/to commit/)).toBeVisible()

    const geometry = await review().evaluate(
      (element, state) => {
        const box = element.getBoundingClientRect()
        const groupId = element.closest<HTMLElement>('[data-tree-group]')!.dataset.treeGroup
        const group = document.querySelector('[data-tool-panel][data-tree-group="' + groupId + '"]')!
        const strip = group.querySelector('[data-zone-tabstrip]')!.getBoundingClientRect()

        const scope = [...element.querySelectorAll<HTMLElement>('button')].find(
          button => button.textContent?.trim() === 'Uncommitted' && button.getBoundingClientRect().width > 0
        )!

        const diff = element.querySelector<HTMLElement>('[data-slot="file-diff-panel"]')!
        const scroll = diff.firstElementChild as HTMLElement

        const diffRow = [...diff.querySelectorAll<HTMLElement>('*')]
          .filter(row => row.textContent?.includes('Local working tree change.'))
          .find(row => ![...row.children].some(child => child.textContent?.includes('Local working tree change.')))!

        const rowBox = diffRow.getBoundingClientRect()
        let visibleTop = Math.max(rowBox.top, 0)
        let visibleBottom = Math.min(rowBox.bottom, innerHeight)
        const clippedBy: { tag: string; height: number; overflowY: string }[] = []

        for (let ancestor = diffRow.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor)

          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            const clip = ancestor.getBoundingClientRect()
            visibleTop = Math.max(visibleTop, clip.top)
            visibleBottom = Math.min(visibleBottom, clip.bottom)
            clippedBy.push({ tag: ancestor.tagName, height: clip.height, overflowY: style.overflowY })
          }
        }

        return {
          ...state,
          bounds: box.toJSON(),
          strip: strip.toJSON(),
          paddingTop: getComputedStyle(element).paddingTop,
          scopeTop: scope.getBoundingClientRect().top,
          diff: diff.getBoundingClientRect().toJSON(),
          diffScroll: scroll.getBoundingClientRect().toJSON(),
          diffRow: rowBox.toJSON(),
          diffVisibleHeight: Math.max(0, visibleBottom - visibleTop),
          clippedBy,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          children: [...element.children].map(child => ({
            width: child.clientWidth,
            scrollWidth: child.scrollWidth
          })),
          controls: [...element.querySelectorAll<HTMLElement>('button, textarea')]
            .filter(control => control.getBoundingClientRect().width > 0)
            .map(control => ({
              label: control.getAttribute('aria-label') || control.textContent,
              bounds: control.getBoundingClientRect().toJSON()
            }))
        }
      },
      { mode, size }
    )

    uiGeometry.push(geometry)
    writeFileSync(testInfo.outputPath('legacy-review-ui-geometry.json'), JSON.stringify(uiGeometry, null, 2))
    expect(geometry.diff.height).toBeGreaterThanOrEqual(64)
    expect(geometry.diffScroll.height).toBeGreaterThanOrEqual(64)
    expect(geometry.diffRow.height).toBeGreaterThan(0)
    expect(geometry.diffVisibleHeight).toBeGreaterThan(0)
    expect(geometry.paddingTop).toBe('0px')
    expect(Math.abs(geometry.bounds.top - geometry.strip.bottom)).toBeLessThanOrEqual(1)
    expect(geometry.scopeTop - geometry.bounds.top).toBeLessThanOrEqual(20)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)

    for (const child of geometry.children) {
      expect(child.scrollWidth).toBeLessThanOrEqual(child.width + 1)
    }

    for (const control of geometry.controls) {
      expect(control.bounds.left).toBeGreaterThanOrEqual(geometry.bounds.left - 1)
      expect(control.bounds.right).toBeLessThanOrEqual(geometry.bounds.right + 1)
    }

    await toolPanel().screenshot({
      path: testInfo.outputPath('legacy-review-diff-scope-commit-' + mode + '-' + size + '.png')
    })
  }

  try {
    await page.evaluate(() => {
      localStorage.setItem('hermes-desktop-mode-v1', 'light')
      window.dispatchEvent(new StorageEvent('storage', { key: 'hermes-desktop-mode-v1' }))
    })
    await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(false)
    await recordReviewGeometry('light', 'wide')
    const sash = page.locator('[data-tree-track="legacy-review-files"] > [role="separator"]')
    const sashBox = (await sash.boundingBox())!
    await page.mouse.move(sashBox.x + 4, sashBox.y + 120)
    await page.mouse.down()
    await page.mouse.move(sashBox.x + 100, sashBox.y + 120, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await toolPanel().boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(300)
    await expect.poll(async () => (await toolPanel().boundingBox())?.width ?? 0).toBeLessThanOrEqual(360)
    await page.evaluate(() => {
      localStorage.setItem('hermes-desktop-mode-v1', 'dark')
      window.dispatchEvent(new StorageEvent('storage', { key: 'hermes-desktop-mode-v1' }))
    })
    await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(true)
    await recordReviewGeometry('dark', 'narrow')
    await expectDocked()
    const narrowSash = (await sash.boundingBox())!
    await page.mouse.move(narrowSash.x + 4, narrowSash.y + 120)
    await page.mouse.down()
    await page.mouse.move(sashBox.x + 4, sashBox.y + 120, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await toolPanel().boundingBox())?.width ?? 0).toBeCloseTo(dockedWidth, 0)
  } finally {
    await page.evaluate(mode => {
      if (mode === null) {
        localStorage.removeItem('hermes-desktop-mode-v1')
      } else {
        localStorage.setItem('hermes-desktop-mode-v1', mode)
      }

      window.dispatchEvent(new StorageEvent('storage', { key: 'hermes-desktop-mode-v1' }))
    }, originalMode)
    writeFileSync(testInfo.outputPath('legacy-review-ui-geometry.json'), JSON.stringify(uiGeometry, null, 2))
  }
}
