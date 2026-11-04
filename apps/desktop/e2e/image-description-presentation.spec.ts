/**
 * Text-only chat models receive an auxiliary vision description. That model
 * input must never replace the user's caption and image in the transcript.
 * Exercise the real composer, canonical gateway, persistence and cold reload.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, type Page, test } from './test'

const CAPTION = 'E2E describe the attached magenta card'
const DESCRIPTION = 'A magenta card with a black frame appears against a white background.'
const REPLY = 'The attached card has been reviewed.'
const IMAGE_NAME = 'magenta card.png'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAAA30lEQVR42u3dwQ2AIBAAQTAWAx1iBXYI7diCuWhEMvP2dZsj+CL30hLr2oxAYARGYARGYARGYIERGIH53n7nozpOk5rQqIcNdkQjMAIjMNPeomP3N54V+5exwY5oBEZgBEZgBEZggREYgREYgREYgQVGYARGYARGYARGYIERGIERGIERGIEFRmAERmAERmAEFhiBERiBERiBERiBBUZgBEZgBEZgBBYYgREYgREYgRFYYCMQGIERmPSj94Njb9ligxEYgRFYYJaQe2mmYIMRGIERGIERGIEFRmAERmDedAFtjAtAGWDnoAAAAABJRU5ErkJggg=='

let fixture: MockBackendFixture | null = null

async function signInToDevelopmentAccount(page: Page): Promise<void> {
  const agreement = page.getByRole('checkbox', {
    name: 'Agree to the user agreement and privacy policy',
    exact: true,
  })

  await expect(agreement).toBeVisible({ timeout: 120_000 })
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('13800000101')
  await agreement.check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function expectOriginalAttachment(page: Page, stage: string): Promise<void> {
  const bubble = page.locator('[data-slot="aui_user-message-root"]:visible')
  await expect(bubble, `${stage}: one authored user message`).toHaveCount(1)
  await expect(bubble, `${stage}: authored caption survives`).toContainText(CAPTION)
  // Attachment rows are siblings of the text bubble so they stay in normal
  // transcript flow when a long user prompt is clamped.
  const thumbnail = page.locator('[data-slot="aui_user-attachments"]:visible [data-slot="aui_directive-image"] img')
  await expect(thumbnail, `${stage}: image survives`).toHaveCount(1)
  await expect(thumbnail, `${stage}: image bytes resolve`).toHaveAttribute('src', /^data:image\//)
  await expect(bubble, `${stage}: auxiliary description is model-only`).not.toContainText(DESCRIPTION)
  await expect(bubble).not.toContainText('The user sent an image')
  await expect(bubble).not.toContainText('vision_analyze')
  await expect(bubble).not.toContainText('@image:')
  await expect(bubble).not.toContainText(IMAGE_NAME)
}

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('keeps image and caption visible when a text-only model uses vision enrichment', async () => {
  const testInfo = test.info()

  test.slow()
  const rendererErrors: string[] = []
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: en',
    extraConfig: [
      'desktop:',
      '  repo_scan_enabled: false',
      'account:',
      '  dev_mode: true',
      'agent:',
      '  image_input_mode: text',
      'auxiliary:',
      '  title_generation:',
      '    enabled: false',
      '  vision:',
      '    provider: custom',
      '    model: mock-model',
    ].join('\n'),
    mockServer: {
      // Auxiliary vision requests contain multimodal parts, so the existing
      // server callback receives no plain-string prompt for that request.
      replyForPrompt: prompt => prompt.includes(CAPTION) ? REPLY : DESCRIPTION,
    },
  })
  const { app, page, sandbox, mock } = fixture
  page.on('pageerror', error => rendererErrors.push(error.message))
  await signInToDevelopmentAccount(page)
  await waitForAppReady(fixture, 120_000)

  const imageDir = path.join(sandbox.root, 'Application Support', 'image inputs')
  fs.mkdirSync(imageDir, { recursive: true })
  const imagePath = path.join(imageDir, IMAGE_NAME)
  fs.writeFileSync(imagePath, Buffer.from(PNG_BASE64, 'base64'))
  await app.evaluate(({ dialog }, selectedImage) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedImage] })
  }, imagePath)

  const composer = page.locator('[data-slot="composer-surface"]:visible')
  await composer.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Images…', exact: true }).click()
  await expect(composer.locator('[data-slot="composer-attachments"]')).toContainText(IMAGE_NAME)
  await composer.locator('[data-slot="composer-rich-input"]').fill(CAPTION)
  await composer.getByRole('button', { name: 'Send', exact: true }).click()

  await expect(page.getByText(REPLY, { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  expect(
    mock.receivedPrompts.some(prompt => prompt.includes(CAPTION) && prompt.includes(DESCRIPTION)),
    'the real chat model receives the auxiliary vision description with the authored caption',
  ).toBe(true)
  await expectOriginalAttachment(page, 'after sending')
  await page.screenshot({ path: testInfo.outputPath('image-description-after-send.png') })

  await page.reload()
  await waitForAppReady(fixture, 120_000)
  await expect(page.getByText(REPLY, { exact: true })).toBeVisible({ timeout: 30_000 })
  await expectOriginalAttachment(page, 'after cold reload')
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('image-description-cold-reload.png') })
})
