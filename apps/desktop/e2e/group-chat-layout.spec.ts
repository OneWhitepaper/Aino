import path from 'node:path'

import { type NoProviderFixture, setupNoProvider } from './fixtures'
import { expect, test } from './test'

const desktop = path.resolve(import.meta.dirname, '..')
const token = 'long_unbroken_file_path_'.repeat(40)
let fixture: NoProviderFixture | null = null

test.beforeAll(async () => {
  fixture = await setupNoProvider()
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('group history fits its scrollport and stays aligned with the composer', async () => {
  const page = fixture!.page

  await page.setViewportSize({ width: 1800, height: 900 })
  await page.setContent(`<style>
    * { box-sizing: border-box; }
    body { margin: 0; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
  </style>`)
  await page.addStyleTag({ path: path.join(desktop, 'src/styles/aino-theme.css') })
  await page.addStyleTag({ path: path.join(desktop, 'src/plugins/hermes-bots/canonical-group.css') })

  for (const width of [320, 700, 1000, 1600]) {
    await page.locator('body').evaluate(
      (body, { width, token }) => {
        body.innerHTML = `<section class="aino-group-workspace" style="width:${width}px;height:600px">
        <div class="aino-group-layout"><div class="aino-group-chat">
          <div class="aino-group-messages-scroll" role="log">
            <div class="aino-group-messages">
              ${Array.from(
                { length: 12 },
                () => `<article class="aino-group-message">
                <div class="aino-group-human-avatar">A</div>
                <div class="aino-group-message-main"><div class="aino-group-message-bubble">
                  <div class="aino-group-message-text"><p>${token}</p><pre>${token}</pre></div>
                </div></div>
              </article>`
              ).join('')}
            </div>
          </div>
          <div class="aino-group-composer-zone"><div class="aino-group-composer">Message</div></div>
        </div></div>
      </section>`
      },
      { width, token }
    )

    const metrics = await page.getByRole('log').evaluate(scrollport => {
      const content = scrollport.querySelector('.aino-group-messages')!.getBoundingClientRect()
      const composer = document.querySelector('.aino-group-composer-zone')!.getBoundingClientRect()
      const prose = scrollport.querySelector('p')!
      const code = scrollport.querySelector('pre')!

      return {
        client: scrollport.clientWidth,
        scroll: scrollport.scrollWidth,
        verticalOverflow: scrollport.scrollHeight > scrollport.clientHeight,
        leftDifference: Math.abs(content.left - composer.left),
        widthDifference: Math.abs(content.width - composer.width),
        proseFits: prose.scrollWidth <= prose.clientWidth,
        codeScrolls: code.scrollWidth > code.clientWidth && getComputedStyle(code).overflowX === 'auto'
      }
    })

    expect(metrics.verticalOverflow, `${width}px history is scrollable`).toBe(true)
    expect(metrics.scroll, `${width}px history must not scroll horizontally`).toBe(metrics.client)
    expect(metrics.leftDifference, `${width}px left edges align`).toBeLessThan(1)
    expect(metrics.widthDifference, `${width}px widths align`).toBeLessThan(1)
    expect(metrics.proseFits, `${width}px long prose wraps`).toBe(true)
    expect(metrics.codeScrolls, `${width}px code keeps its own scrollbar`).toBe(true)
  }
})
