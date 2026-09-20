import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

import { BATCH_CLARIFY_TRIGGER, BLOCKING_CLARIFY_QUESTION, BLOCKING_CLARIFY_TRIGGER, MOCK_REPLY, SIDEBAR_TEXTS, startMockServer } from '../../../tests-js/scripts/mock-server'
import {
  buildAppEnv, createSandbox, launchDesktop, type MockBackendFixture,
  waitForAppReady, writeEnvFile, writeMockProviderConfig
} from './fixtures'
import { expect, test } from './test'

// Source-app test using the existing explicit development account adapter.
// After npm run build, run node scripts/bundle-electron-main.mjs --dev.
let fixture: MockBackendFixture | undefined
const LONG_TRIGGER = 'E2E_CONVERSATION_FULL_ANSWER'
const LONG_ANSWER = '完整回答不应被截断。'.repeat(4000) + '正文结束。'
const APPROVAL_TRIGGER = 'E2E_CONVERSATION_APPROVAL'
let approvalDirectory: string
const rendererErrors: string[] = []
const evidenceDirectory = '/tmp/aino-ui-restoration-evidence'

async function openConversation(page: Page) {
  const previous = page.url()
  await page.evaluate(() => { window.location.hash = '/conversations/new' })
  await expect(page).toHaveURL(/#\/conversations\/[a-f0-9-]+$/)
  await expect(page).not.toHaveURL(previous)
  const surface = page.locator('main[data-conversation-id]')
  await expect(surface).toBeVisible()
  return surface
}

test.afterAll(async () => {
  await fixture?.cleanup()
})

test.afterEach(async ({}, testInfo) => {
  if (fixture && testInfo.status !== testInfo.expectedStatus) {
    for (const profile of ['default', 'writer', 'reviewer', 'approver']) {
      const home = profile === 'default' ? fixture.sandbox.hermesHome : path.join(fixture.sandbox.hermesHome, 'profiles', profile)
      for (const name of ['gui.log', 'errors.log', 'desktop.log', 'agent.log']) {
        const log = path.join(home, 'logs', name)
        if (fs.existsSync(log)) await testInfo.attach(`${profile}-${name}`, { path: log, contentType: 'text/plain' })
      }
    }
    await testInfo.attach('model-requests', { body: JSON.stringify(fixture.mock.receivedPrompts), contentType: 'application/json' })
  }
})

test.beforeAll(async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox('multi-agent-conversation')
  approvalDirectory = path.join(sandbox.root, 'approval-empty-directory')
  fs.mkdirSync(approvalDirectory)
  const quotedApprovalDirectory = `'${approvalDirectory.replaceAll("'", "'\\''")}'`
  const mock = await startMockServer({
    modelIds: ['mock-model', 'mock-alternate'],
    replyForPrompt: { marker: LONG_TRIGGER, text: LONG_ANSWER },
    approvalCommand: { marker: APPROVAL_TRIGGER, command: `rm -r ${quotedApprovalDirectory}` }
  })
  const extra = 'conversations:\n  enabled: true\ndesktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true\ncompression:\n  enabled: false'

  for (const profile of ['default', 'writer', 'reviewer', 'approver']) {
    const home = profile === 'default' ? sandbox.hermesHome : path.join(sandbox.hermesHome, 'profiles', profile)
    fs.mkdirSync(home, { recursive: true })
    writeMockProviderConfig(home, mock.url, '  language: en', extra + (profile === 'approver' ? '\napprovals:\n  mode: manual' : ''))
    const configFile = path.join(home, 'config.yaml')
    fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace('      mock-model: {}', '      mock-model: {}\n      mock-alternate: {}'))
    writeEnvFile(home)
    fs.writeFileSync(path.join(home, 'SOUL.md'), `You are the ${profile} test participant.\n`)
    const skill = path.join(home, 'skills', 'shared-command')
    fs.mkdirSync(skill, { recursive: true })
    fs.writeFileSync(path.join(skill, 'SKILL.md'), `---\nname: shared-command\ndescription: Profile-specific test method\n---\nPRIVATE-${profile}-SKILL-BODY\n`)
  }

  const { app, page } = await launchDesktop(buildAppEnv(sandbox, { HOME: sandbox.root }))
  page.on('pageerror', error => rendererErrors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  fixture = {
    app, page, mock, mockUrl: mock.url, sandbox,
    cleanup: async () => {
      await app.close()
      await mock.close()
      sandbox.cleanup()
    }
  }

  expect(await page.evaluate(() => (window as unknown as { hermesDesktop: { accountAdapter: string } }).hermesDesktop?.accountAdapter),
    'Build the source-app Electron bundle with --dev for this explicit development-account test').toBe('legacy-development')

  const agreement = page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true })
  await expect(agreement).toBeVisible({ timeout: 30_000 })
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+8613800138000')
  await agreement.check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  await expect(page.locator('.aino-home-layout')).toBeVisible()
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  await page.screenshot({ path: path.join(evidenceDirectory, 'original-ordinary-chat-home.png') })
})

test('one visible conversation preserves authors and context through G-A-B-G-A and reload', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const { page, mock } = fixture!
  await openConversation(page)
  const surface = page.locator('main[data-conversation-id]')
  await expect(surface).toBeVisible()
  const route = page.url()
  const composer = surface.getByRole('textbox', { name: 'Message', exact: true })
  const send = surface.getByRole('button', { name: 'Send', exact: true })
  const answers = surface.locator('article').filter({ hasText: MOCK_REPLY })
  const authors: string[] = []

  for (const [index, responder] of ['default', 'writer', 'reviewer', 'default', 'writer'].entries()) {
    if (responder === 'default' && index > 0) {
      await surface.getByRole('button', { name: 'Clear expert selection', exact: true }).click()
    } else if (responder !== 'default') {
      await surface.getByRole('button', { name: 'Choose responder', exact: true }).click()
      await page.getByRole('menuitemradio', { name: new RegExp(`^${responder}\\b`) }).click()
    }
    await composer.fill(`Public conversation turn ${index + 1}; continue the previous participants' discussion.`)
    await expect(send).toBeEnabled()
    await send.click()
    await expect(answers).toHaveCount(index + 1, { timeout: 60_000 })
    const author = await answers.nth(index).getAttribute('data-author-id')
    expect(author).toBeTruthy()
    authors.push(author!)
    await expect(page).toHaveURL(route)
    await expect(composer).toHaveValue('')
  }

  expect(authors[0]).toBe(authors[3])
  expect(authors[1]).toBe(authors[4])
  expect(new Set(authors.slice(0, 3)).size).toBe(3)
  const envelopes = mock.receivedPrompts.filter(prompt => prompt.includes('<current_user_request'))
  expect(envelopes).toHaveLength(5)
  expect(envelopes[2]).toContain('writer')
  expect(envelopes[2]).toContain(MOCK_REPLY)
  expect(envelopes[4]).toContain('reviewer')
  await page.reload()
  await expect(surface).toBeVisible({ timeout: 60_000 })
  await expect(answers).toHaveCount(5)
  expect(await answers.evaluateAll(rows => rows.map(row => row.getAttribute('data-author-id')))).toEqual(authors)
  await page.screenshot({ path: testInfo.outputPath('multi-agent-conversation.png') })
})

test('selected expert keeps real clarification and delegated work while the next responder changes', async ({}, testInfo) => {
  test.setTimeout(180_000)
  expect(fixture).toBeDefined()
  const page = fixture!.page

  const openWriterConversation = async () => {
    await openConversation(page)
    const surface = page.locator('main[data-conversation-id]')
    await surface.getByRole('button', { name: 'Choose responder', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /^writer\b/ }).click()
    return surface
  }

  const surface = await openWriterConversation()
  await surface.getByRole('textbox', { name: 'Message', exact: true }).fill(BATCH_CLARIFY_TRIGGER)
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  const questions = surface.locator('form').filter({ hasText: 'Pick a batch drink?' })
  await expect(questions).toBeVisible({ timeout: 60_000 })
  await surface.getByRole('button', { name: 'Choose responder', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^reviewer\b/ }).click()
  await questions.getByRole('button', { name: /^B Tea$/ }).click()
  await questions.getByRole('button', { name: /^A Morning\b/ }).click()
  await questions.getByRole('button', { name: /Confirm and continue/ }).click()
  const answer = surface.locator('article').filter({ hasText: MOCK_REPLY })
  await expect(answer).toHaveCount(1, { timeout: 60_000 })
  await expect(answer.locator('strong')).toHaveText('writer')
  await expect(surface.getByRole('button', { name: 'Choose responder', exact: true })).toHaveText('reviewer')

  const delegated = await openWriterConversation()
  await delegated.getByRole('textbox', { name: 'Message', exact: true }).fill('E2E_SIDEBAR_TRIGGER')
  await delegated.getByRole('button', { name: 'Send', exact: true }).click()
  await delegated.getByRole('button', { name: 'Choose responder', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^reviewer\b/ }).click()
  const child = delegated.locator('[data-subagent-id]').filter({ hasText: SIDEBAR_TEXTS.subagentGoal })
  await expect(child).toBeVisible({ timeout: 60_000 })
  await expect(child).toContainText('writer')
  const completed = delegated.locator('article').filter({ hasText: SIDEBAR_TEXTS.finalText })
  await expect(completed).toHaveCount(1, { timeout: 60_000 })
  await expect(completed.locator('strong')).toHaveText('writer')
  await expect(delegated.getByRole('button', { name: 'Choose responder', exact: true })).toHaveText('reviewer')
  await page.screenshot({ path: testInfo.outputPath('multi-agent-tools-and-child.png') })
})

test('an uploaded file survives responder changes and a long answer survives reload intact', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const { page, mock } = fixture!
  await openConversation(page)
  const surface = page.locator('main[data-conversation-id]')
  const fileText = 'Shared attachment evidence: the red kite is beside the river.'
  await surface.locator('input[type=file]').setInputFiles({
    name: 'shared-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(fileText)
  })
  const send = surface.getByRole('button', { name: 'Send', exact: true })
  await expect(send).toBeEnabled()
  await send.click()
  const answers = surface.locator('article').filter({ hasText: MOCK_REPLY })
  await expect(answers).toHaveCount(1, { timeout: 60_000 })
  await expect(surface.locator('article').getByRole('button', { name: 'Download attachment: shared-notes.txt', exact: true })).toBeVisible()
  await surface.getByRole('button', { name: 'Choose responder', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^writer\b/ }).click()
  const input = surface.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill('Continue using the earlier shared notes.')
  await expect(send).toBeEnabled()
  await send.click()
  await expect(answers).toHaveCount(2, { timeout: 60_000 })
  const received = mock.receivedPrompts.filter(text => text.includes(fileText))
  expect(received.length).toBeGreaterThanOrEqual(2)
  expect(received.at(-1)).toContain('writer')
  await input.fill(LONG_TRIGGER)
  await expect(send).toBeEnabled()
  await send.click()
  const long = surface.locator('article').filter({ hasText: '正文结束。' })
  await expect(long).toHaveCount(1, { timeout: 60_000 })
  await expect(long.locator('p')).toHaveText(LONG_ANSWER)
  await page.reload()
  await expect(long.locator('p')).toHaveText(LONG_ANSWER, { timeout: 60_000 })
  await page.screenshot({ path: testInfo.outputPath('multi-agent-shared-attachment.png') })
})

test('stop targets the running expert while preserving the next expert and draft', async () => {
  test.setTimeout(90_000)
  const { page } = fixture!
  await openConversation(page)
  const surface = page.locator('main[data-conversation-id]')
  const choose = surface.getByRole('button', { name: 'Choose responder', exact: true })
  await choose.click()
  await page.getByRole('menuitemradio', { name: /^writer\b/ }).click()
  const input = surface.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill(BLOCKING_CLARIFY_TRIGGER)
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(surface.getByText(BLOCKING_CLARIFY_QUESTION, { exact: true })).toBeVisible({ timeout: 60_000 })
  await choose.click()
  await page.getByRole('menuitemradio', { name: /^reviewer\b/ }).click()
  await input.fill('Keep this unsent reviewer draft.')
  const stop = surface.getByRole('button', { name: 'Stop', exact: true })
  await stop.click()
  await expect(stop).toHaveCount(0, { timeout: 30_000 })
  await expect(choose).toHaveText('reviewer')
  await expect(input).toHaveValue('Keep this unsent reviewer draft.')
  await expect(surface.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(surface.locator('article').first()).toContainText(BLOCKING_CLARIFY_TRIGGER)
})

test('private commands and skills target the selected expert and configuration refresh is explicit', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const { page, mock, sandbox } = fixture!
  await openConversation(page)
  const surface = page.locator('main[data-conversation-id]')
  await expect(surface).toBeVisible()
  await expect(page).toHaveURL(/#\/conversations\/[a-f0-9-]+$/)
  const route = page.url()
  const choose = surface.getByRole('button', { name: 'Choose responder', exact: true })
  const input = surface.getByRole('textbox', { name: 'Message', exact: true })
  const send = surface.getByRole('button', { name: 'Send', exact: true })
  const answers = surface.locator('article').filter({ hasText: MOCK_REPLY })
  const notice = surface.locator('[data-private-conversation-notice]')
  await choose.click()
  await page.getByRole('menuitemradio', { name: /^writer\b/ }).click()
  await input.fill('Establish the writer conversation before checking its private commands.')
  await send.click()
  await expect(answers).toHaveCount(1, { timeout: 60_000 })
  await input.fill('/prompt')
  await expect(send).toBeEnabled()
  await send.click()
  await expect(notice).toContainText('You are the writer test participant.', { timeout: 30_000 })
  await expect(surface.locator('article')).toHaveCount(2)
  await notice.getByRole('button', { name: 'Close', exact: true }).click()

  const promptStart = mock.receivedPrompts.length
  await input.fill('/shared-command review the public discussion')
  await expect(send).toBeEnabled()
  await send.click()
  await expect(answers).toHaveCount(2, { timeout: 60_000 })
  const skillInputs = mock.receivedPrompts.slice(promptStart).filter(text => text.includes('<current_user_request'))
  expect(skillInputs).toHaveLength(1)
  expect(skillInputs[0]).toContain('PRIVATE-writer-SKILL-BODY')
  expect(skillInputs[0]).not.toContain('PRIVATE-reviewer-SKILL-BODY')
  const skillEvent = surface.locator('article').filter({ has: page.getByTitle('/shared-command', { exact: true }) })
  await expect(skillEvent).toHaveCount(1)
  await expect(skillEvent).toContainText('review the public discussion')
  await expect(surface.locator('article').filter({ hasText: 'PRIVATE-writer-SKILL-BODY' })).toHaveCount(0)

  await choose.click()
  await page.getByRole('menuitemradio', { name: /^reviewer\b/ }).click()
  const reviewerStart = mock.receivedPrompts.length
  await input.fill('Continue the public discussion as the reviewer.')
  await expect(send).toBeEnabled()
  await send.click()
  await expect(answers).toHaveCount(3, { timeout: 60_000 })
  const reviewerInputs = mock.receivedPrompts.slice(reviewerStart).filter(text => text.includes('<current_user_request'))
  expect(reviewerInputs).toHaveLength(1)
  expect(reviewerInputs[0]).toContain('/shared-command review the public discussion')
  expect(reviewerInputs[0]).not.toContain('PRIVATE-writer-SKILL-BODY')

  await choose.click()
  await page.getByRole('menuitemradio', { name: /^writer\b/ }).click()
  const soul = path.join(sandbox.hermesHome, 'profiles', 'writer', 'SOUL.md')
  const previousSoul = fs.readFileSync(soul, 'utf8')
  try {
    fs.writeFileSync(soul, 'You are the explicitly refreshed writer test participant.\n')
    await input.fill('Keep this writer draft during configuration refresh.')
    await surface.getByRole('button', { name: 'Refresh expert configuration', exact: true }).click()
    await page.locator('[data-slot=popover-content]').getByRole('button', { name: 'Refresh expert configuration', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(notice).toContainText('Expert configuration refreshed for the next reply.', { timeout: 30_000 })
    await expect(input).toHaveValue('Keep this writer draft during configuration refresh.')
    await expect(page).toHaveURL(route)
    await expect(answers).toHaveCount(3)
    await expect(send).toBeEnabled()
    await send.click()
    await expect(answers).toHaveCount(4, { timeout: 60_000 })
    await input.fill('/prompt')
    await expect(send).toBeEnabled()
    await send.click()
    await expect(notice).toContainText('You are the explicitly refreshed writer test participant.', { timeout: 30_000 })
    await expect(surface.locator('article')).toHaveCount(8)
    await page.screenshot({ path: testInfo.outputPath('multi-agent-private-command-refresh.png') })
  } finally {
    fs.writeFileSync(soul, previousSoul)
  }
})

test('terminal approval remains with its original expert while the next expert and draft change', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const { page } = fixture!
  await openConversation(page)
  const surface = page.locator('main[data-conversation-id]')
  const choose = surface.getByRole('button', { name: 'Choose responder', exact: true })
  await choose.click()
  await page.getByRole('menuitemradio', { name: /^approver\b/ }).click()
  const input = surface.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill(APPROVAL_TRIGGER)
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  const allow = surface.locator('[data-slot=tool-approval-inline]').getByRole('button', { name: /^Run/ })
  await expect(allow).toBeVisible({ timeout: 60_000 })
  expect(fs.existsSync(approvalDirectory)).toBe(true)
  await choose.click()
  await page.getByRole('menuitemradio', { name: /^reviewer\b/ }).click()
  await input.fill('Keep the reviewer draft while the approver finishes.')
  await allow.click()
  const answer = surface.locator('article').filter({ hasText: MOCK_REPLY })
  await expect(answer).toHaveCount(1, { timeout: 30_000 })
  await expect(answer.locator('strong')).toHaveText('approver')
  expect(fs.existsSync(approvalDirectory)).toBe(false)
  await expect(choose).toHaveText('reviewer')
  await expect(input).toHaveValue('Keep the reviewer draft while the approver finishes.')
  await page.screenshot({ path: testInfo.outputPath('multi-agent-original-expert-approval.png') })
})

test('shared projects preserve source and expert selection and show only explicitly opened folders', async ({}, testInfo) => {
  test.setTimeout(150_000)
  const { page, sandbox, mock } = fixture!
  const novel = path.join(sandbox.root, 'novel-project')
  const media = path.join(sandbox.root, 'media-project')
  fs.mkdirSync(novel)
  fs.mkdirSync(media)
  fs.writeFileSync(path.join(novel, 'novel-notes.txt'), 'Novel preview belongs to the explicitly opened folder.')
  fs.writeFileSync(path.join(media, 'media-notes.txt'), 'Media preview belongs to its own project folder.')
  const surface = await openConversation(page)
  await surface.getByRole('button', { name: 'Select project', exact: true }).click()
  const project = page.getByRole('combobox', { name: 'Conversation project source', exact: true })
  await expect(project).toBeEnabled({ timeout: 30_000 })
  for (const [profile, name, directory] of [['writer', 'Novel', novel], ['reviewer', 'Novel', novel], ['default', 'Media', media]]) {
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await page.getByRole('combobox', { name: 'Project registration source', exact: true }).selectOption(profile)
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(name)
    await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill(directory)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Project directory', exact: true })).toHaveCount(0)
    await expect(project).toBeEnabled()
  }
  await expect(project).toHaveValue('')
  const selectedSource = await project.getByRole('option', { name: 'Novel · writer · local', exact: true }).getAttribute('value')
  await project.selectOption({ label: 'Novel · writer · local' })
  await page.getByRole('dialog').getByRole('button', { name: 'Apply project change', exact: true }).click()
  await surface.getByRole('button', { name: 'novel-project', exact: true }).click()
  await expect(project).toHaveValue(selectedSource!)
  await page.keyboard.press('Escape')
  const showSidebar = page.getByRole('button', { name: 'Show right sidebar', exact: true })
  if (await showSidebar.isVisible()) await showSidebar.click()
  const tree = page.getByRole('complementary', { name: 'Opened project folders', exact: true })
  await expect(tree).toContainText('No folders opened in this window.')
  await expect(tree.getByText('novel-notes.txt', { exact: true })).toHaveCount(0)
  await surface.getByRole('button', { name: 'novel-project', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Open folder in this window', exact: true }).click()
  await page.keyboard.press('Escape')
  await tree.getByRole('treeitem', { name: 'novel-notes.txt', exact: true }).dblclick()
  await expect(tree).toContainText('Novel preview belongs to the explicitly opened folder.')
  await expect(tree.getByText('media-notes.txt', { exact: true })).toHaveCount(0)
  const choose = surface.getByRole('button', { name: 'Choose responder', exact: true })
  await choose.click()
  await page.getByRole('menuitemradio', { name: /^writer\b/ }).click()
  const input = surface.getByRole('textbox', { name: 'Message', exact: true })
  const answers = surface.locator('article').filter({ hasText: MOCK_REPLY })
  await input.fill('Start the novel project discussion.')
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(answers).toHaveCount(1, { timeout: 60_000 })
  await choose.click()
  await page.getByRole('menuitemradio', { name: /^reviewer\b/ }).click()
  await surface.getByRole('button', { name: 'novel-project', exact: true }).click()
  await expect(project).toHaveValue(selectedSource!)
  await page.keyboard.press('Escape')
  await input.fill('Keep this reviewer draft while changing to the media project.')
  await surface.getByRole('button', { name: 'novel-project', exact: true }).click()
  await project.selectOption({ label: 'Media · default · local' })
  await page.getByRole('dialog').getByRole('button', { name: 'Apply project change', exact: true }).click()
  await surface.getByRole('button', { name: 'media-project', exact: true }).click()
  await expect(project.locator('option:checked')).toHaveText('Media · default · local')
  await page.keyboard.press('Escape')
  await expect(choose).toHaveText('reviewer')
  await expect(input).toHaveValue('Keep this reviewer draft while changing to the media project.')
  await expect(answers).toHaveCount(1)
  await surface.getByRole('button', { name: 'media-project', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Open folder in this window', exact: true }).click()
  await page.keyboard.press('Escape')
  await tree.getByRole('region', { name: 'Novel', exact: true }).getByRole('button', { name: 'Close folder', exact: true }).click()
  await expect(tree.getByText('novel-notes.txt', { exact: true })).toHaveCount(0)
  await tree.getByRole('treeitem', { name: 'media-notes.txt', exact: true }).dblclick()
  await expect(tree).toContainText('Media preview belongs to its own project folder.')
  const start = mock.receivedPrompts.length
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(answers).toHaveCount(2, { timeout: 60_000 })
  expect(mock.receivedPrompts.slice(start).some(text => text.includes(media))).toBe(true)
  await page.reload()
  await surface.getByRole('button', { name: 'media-project', exact: true }).click({ timeout: 60_000 })
  await expect(project.locator('option:checked')).toHaveText('Media · default · local')
  await page.keyboard.press('Escape')
  await expect(tree.getByText('media-notes.txt', { exact: true })).toBeVisible()
  await expect(tree.getByText('novel-notes.txt', { exact: true })).toHaveCount(0)
  await expect(answers).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('multi-agent-shared-project.png') })
})

test('ordinary and multi-agent chats share the designed home and responsive composer', async ({}, testInfo) => {
  test.setTimeout(150_000)
  const { page, app } = fixture!
  const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
  await page.locator('[data-tour="sidebar-nav-new-session"]').click()
  await expect(page.locator('.aino-home-layout')).toBeVisible()
  const originalComposer = page.locator('[data-slot="composer-surface"]:visible')
  await expect(originalComposer.locator('[data-tour="model-pill"]')).toContainText('Mock Model')
  await page.screenshot({ path: path.join(evidenceDirectory, 'original-ordinary-chat-home.png') })
  await originalComposer.getByRole('textbox', { name: 'Message', exact: true }).fill('Original ordinary chat layout reference.')
  await originalComposer.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText(MOCK_REPLY, { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.screenshot({ path: path.join(evidenceDirectory, 'original-ordinary-chat-sent.png') })

  const surface = await openConversation(page)
  const composer = surface.locator('[data-slot="composer-surface"]')
  const input = composer.getByRole('textbox', { name: 'Message', exact: true })
  const send = composer.getByRole('button', { name: 'Send', exact: true })
  await expect(surface.locator('.aino-home-title')).toBeVisible()
  await expect(surface.locator('.aino-home-actions button')).toHaveCount(4)
  await expect(composer.getByRole('button', { name: 'Choose responder', exact: true })).toBeVisible()
  await expect(send).toBeDisabled()
  await surface.getByRole('button', { name: 'Review code', exact: true }).click()
  await expect(input).not.toHaveValue('')
  await input.fill('')
  await page.screenshot({ path: path.join(evidenceDirectory, 'restored-multi-agent-home.png') })

  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 800, false))
    await input.fill('Long text should grow within the existing input and leave its controls usable.\n'.repeat(45))
    await expect.poll(() => composer.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: path.join(evidenceDirectory, 'restored-multi-agent-narrow.png') })
    const inputBox = await input.boundingBox()
    const sendBox = await send.boundingBox()
    expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(sendBox!.y)
    const subtitle = surface.locator('.aino-home-subtitle')
    expect(await subtitle.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: path.join(evidenceDirectory, 'restored-multi-agent-narrow.png') })
  } finally {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1], false), originalSize)
  }
  await input.fill('Check the restored conversation interface.')
  await composer.getByRole('button', { name: 'Open model picker', exact: true }).click()
  const modelSearch = page.getByRole('textbox', { name: 'Search models', exact: true })
  await modelSearch.fill('mock-alternate')
  await expect(page.getByRole('menuitem', { name: /mock.*alternate/i })).toBeVisible()
  await modelSearch.press('Enter')
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(surface.locator('[data-private-conversation-notice]')).toContainText('Expert configuration refreshed for the next reply.')
  await surface.locator('[data-private-conversation-notice]').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(input).toHaveValue('Check the restored conversation interface.')
  await send.click()
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toHaveCount(1, { timeout: 60_000 })
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toContainText('mock-alternate')
  await expect(surface.locator('.aino-home-layout')).toHaveCount(0)
  await expect(input).toBeVisible()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await expect(send).toBeDisabled()
  expect(rendererErrors).toEqual([])
  await page.screenshot({ path: path.join(evidenceDirectory, 'restored-multi-agent-sent.png') })
  await testInfo.attach('restored home', { path: path.join(evidenceDirectory, 'restored-multi-agent-home.png'), contentType: 'image/png' })
})
