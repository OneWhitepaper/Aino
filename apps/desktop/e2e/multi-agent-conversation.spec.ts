import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Page } from '@playwright/test'

import {
  BATCH_CLARIFY_TRIGGER,
  BLOCKING_CLARIFY_QUESTION,
  BLOCKING_CLARIFY_TRIGGER,
  MOCK_REPLY,
  SIDEBAR_TEXTS,
  startMockServer
} from '../../../tests-js/scripts/mock-server'
import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
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
  await page.evaluate(() => {
    window.location.hash = '/conversations/new'
  })
  await expect(page).toHaveURL(/#\/conversations\/[a-f0-9-]+(?:\?|$)/)
  await expect(page).not.toHaveURL(previous)
  const surface = page.locator('main[data-conversation-id]')
  await expect(surface).toBeVisible()
  return surface
}

test.afterAll(async () => {
  await fixture?.cleanup()
})

test.beforeEach(() => {
  rendererErrors.length = 0
})

test.afterEach(async ({}, testInfo) => {
  if (fixture && testInfo.status !== testInfo.expectedStatus) {
    for (const profile of ['default', 'writer', 'reviewer', 'approver']) {
      const home =
        profile === 'default' ? fixture.sandbox.hermesHome : path.join(fixture.sandbox.hermesHome, 'profiles', profile)
      for (const name of ['gui.log', 'errors.log', 'desktop.log', 'agent.log']) {
        const log = path.join(home, 'logs', name)
        if (fs.existsSync(log)) await testInfo.attach(`${profile}-${name}`, { path: log, contentType: 'text/plain' })
      }
    }
    await testInfo.attach('model-requests', {
      body: JSON.stringify(fixture.mock.receivedPrompts),
      contentType: 'application/json'
    })
  }
  expect(rendererErrors).toEqual([])
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
  const extra =
    'model_overrides:\n  custom:mock:\n    mock-model:\n      supports_reasoning: true\ndesktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true\ncompression:\n  enabled: false'

  for (const profile of ['default', 'writer', 'reviewer', 'approver']) {
    const home = profile === 'default' ? sandbox.hermesHome : path.join(sandbox.hermesHome, 'profiles', profile)
    fs.mkdirSync(home, { recursive: true })
    writeMockProviderConfig(
      home,
      mock.url,
      '  language: en',
      extra + (profile === 'approver' ? '\napprovals:\n  mode: manual' : '')
    )
    const configFile = path.join(home, 'config.yaml')
    fs.writeFileSync(
      configFile,
      fs
        .readFileSync(configFile, 'utf8')
        .replace('      mock-model: {}', '      mock-model: {}\n      mock-alternate: {}') +
        `\nstt:\n  provider: acceptance-voice\n  providers:\n    acceptance-voice:\n      type: command\n      command: 'echo Voice transcript from ${profile}'\n      format: txt\n`
    )
    writeEnvFile(home)
    fs.writeFileSync(path.join(home, 'SOUL.md'), `You are the ${profile} test participant.\n`)
    const skill = path.join(home, 'skills', 'shared-command')
    fs.mkdirSync(skill, { recursive: true })
    fs.writeFileSync(
      path.join(skill, 'SKILL.md'),
      `---\nname: shared-command\ndescription: Profile-specific test method\n---\nPRIVATE-${profile}-SKILL-BODY\n`
    )
  }

  const { app, page } = await launchDesktop(buildAppEnv(sandbox, { HOME: sandbox.root }), { fakeMedia: true })
  page.on('pageerror', error => rendererErrors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  fixture = {
    app,
    page,
    mock,
    mockUrl: mock.url,
    sandbox,
    cleanup: async () => {
      await app.close()
      await mock.close()
      sandbox.cleanup()
    }
  }

  expect(
    await page.evaluate(
      () => (window as unknown as { hermesDesktop: { accountAdapter: string } }).hermesDesktop?.accountAdapter
    ),
    'Build the source-app Electron bundle with --dev for this explicit development-account test'
  ).toBe('legacy-development')

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

test('initial ordinary home and the existing new-session shortcut use the supported conversation flow', async () => {
  const { page } = fixture!
  const surface = page.locator('main[data-conversation-id]')
  await expect(surface).toBeVisible()
  const initialId = await surface.getAttribute('data-conversation-id')
  await page.getByRole('textbox', { name: 'Message', exact: true }).focus()
  await page.keyboard.press('ControlOrMeta+n')
  await expect(surface).not.toHaveAttribute('data-conversation-id', initialId!)
  await expect(surface.locator('.aino-home-title')).toBeVisible()
  await expect(surface.getByRole('button', { name: 'Choose responder', exact: true })).toHaveText('Aino')
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
    await expect(composer).toHaveText('')
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
    name: 'shared-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(fileText)
  })
  const send = surface.getByRole('button', { name: 'Send', exact: true })
  await expect(send).toBeEnabled()
  await send.click()
  const answers = surface.locator('article').filter({ hasText: MOCK_REPLY })
  await expect(answers).toHaveCount(1, { timeout: 60_000 })
  await expect(
    surface.locator('article').getByRole('button', { name: 'Download attachment: shared-notes.txt', exact: true })
  ).toBeVisible()
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
  await expect(input).toHaveText('Keep this unsent reviewer draft.')
  await expect(surface.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(surface.locator('article').first()).toContainText(BLOCKING_CLARIFY_TRIGGER)
})

test('private commands and skills target the selected expert and configuration refresh is explicit', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const { page, mock, sandbox } = fixture!
  await openConversation(page)
  const surface = page.locator('main[data-conversation-id]')
  await expect(surface).toBeVisible()
  await expect(page).toHaveURL(/#\/conversations\/[a-f0-9-]+(?:\?|$)/)
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
  const reviewerInputs = mock.receivedPrompts
    .slice(reviewerStart)
    .filter(text => text.includes('<current_user_request'))
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
    await page
      .locator('[data-slot=popover-content]')
      .getByRole('button', { name: 'Refresh expert configuration', exact: true })
      .click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(notice).toContainText('Expert configuration refreshed for the next reply.', { timeout: 30_000 })
    await expect(input).toHaveText('Keep this writer draft during configuration refresh.')
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
  await expect(input).toHaveText('Keep the reviewer draft while the approver finishes.')
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
  for (const [profile, name, directory] of [
    ['writer', 'Novel', novel],
    ['reviewer', 'Novel', novel],
    ['default', 'Media', media]
  ]) {
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await page.getByRole('combobox', { name: 'Project registration source', exact: true }).selectOption(profile)
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(name)
    await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill(directory)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Project directory', exact: true })).toHaveCount(0)
    await expect(project).toBeEnabled()
  }
  await expect(project).toHaveValue('')
  const selectedSource = await project
    .getByRole('option', { name: 'Novel · writer · local', exact: true })
    .getAttribute('value')
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
  await expect(input).toHaveText('Keep this reviewer draft while changing to the media project.')
  await expect(answers).toHaveCount(1)
  await surface.getByRole('button', { name: 'media-project', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Open folder in this window', exact: true }).click()
  await page.keyboard.press('Escape')
  await tree
    .getByRole('region', { name: 'Novel', exact: true })
    .getByRole('button', { name: 'Close folder', exact: true })
    .click()
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
  const { page, app, sandbox, mock } = fixture!
  const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
  await page.locator('[data-tour="sidebar-nav-new-session"]').click()
  await expect(page.locator('main[data-conversation-id]')).toBeVisible()
  // A confirmed disabled capability must retain the original ordinary flow.
  const configFile = path.join(sandbox.hermesHome, 'config.yaml')
  const enabledConfig = fs.readFileSync(configFile, 'utf8')
  try {
    fs.writeFileSync(configFile, enabledConfig + '\nconversations:\n  enabled: false\n')
    await page.locator('[data-tour="sidebar-nav-new-session"]').click()
    await expect(page.locator('.aino-home-layout')).toBeVisible()
    const originalComposer = page.locator('[data-slot="composer-surface"]:visible')
    await expect(originalComposer.locator('[data-tour="model-pill"]')).toContainText('Mock Model')
    await page.screenshot({ path: path.join(evidenceDirectory, 'original-ordinary-chat-home.png') })
    const promptStart = mock.receivedPrompts.length
    await originalComposer
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Original ordinary chat layout reference.')
    await originalComposer.getByRole('button', { name: 'Send', exact: true }).click()
    await expect
      .poll(() =>
        mock.receivedPrompts.slice(promptStart).some(text => text.includes('Original ordinary chat layout reference.'))
      )
      .toBe(true)
    await expect(page.getByText(MOCK_REPLY, { exact: true })).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: path.join(evidenceDirectory, 'original-ordinary-chat-sent.png') })
  } finally {
    fs.writeFileSync(configFile, enabledConfig)
  }

  const surface = await openConversation(page)
  const composer = surface.locator('[data-slot="composer-surface"]')
  const input = composer.getByRole('textbox', { name: 'Message', exact: true })
  const send = composer.getByRole('button', { name: 'Send', exact: true })
  await expect(surface.locator('.aino-home-title')).toBeVisible()
  await expect(surface.locator('.aino-home-actions button')).toHaveCount(4)
  await expect(composer.getByRole('button', { name: 'Choose responder', exact: true })).toBeVisible()
  await expect(send).toBeDisabled()
  await surface.getByRole('button', { name: 'Review code', exact: true }).click()
  await expect(input).not.toHaveText('')
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
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1], false),
      originalSize
    )
  }
  await input.fill('Check the restored conversation interface.')
  await composer.getByRole('button', { name: 'Open model picker', exact: true }).click()
  const modelSearch = page.getByRole('textbox', { name: 'Search models', exact: true })
  await modelSearch.fill('mock-alternate')
  await expect(page.getByRole('menuitem', { name: /mock.*alternate/i })).toBeVisible()
  await modelSearch.press('Enter')
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(surface.locator('[data-private-conversation-notice]')).toContainText(
    'Expert configuration refreshed for the next reply.'
  )
  await surface
    .locator('[data-private-conversation-notice]')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await expect(input).toHaveText('Check the restored conversation interface.')
  await send.click()
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toHaveCount(1, { timeout: 60_000 })
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toContainText('mock-alternate')
  await expect(surface.locator('.aino-home-layout')).toHaveCount(0)
  await expect(input).toBeVisible()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await expect(send).toBeDisabled()
  expect(rendererErrors).toEqual([])
  await page.screenshot({ path: path.join(evidenceDirectory, 'restored-multi-agent-sent.png') })
  await testInfo.attach('restored home', {
    path: path.join(evidenceDirectory, 'restored-multi-agent-home.png'),
    contentType: 'image/png'
  })
})

test('original history controls preserve the source while editing, branching, regenerating and reacting', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const { page } = fixture!
  const surface = await openConversation(page)
  await surface.getByRole('textbox', { name: 'Message', exact: true }).fill('Original immutable public input')
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  const answers = surface.locator('article').filter({ hasText: MOCK_REPLY })
  await expect(answers).toHaveCount(1, { timeout: 60_000 })
  const sourceRoute = page.url()
  const originalIds = await surface
    .locator('article')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-event-id')))
  await answers.first().getByRole('button', { name: 'React', exact: true }).click()
  await page.getByRole('button', { name: '👍', exact: true }).click()
  await expect(answers.first().locator('[data-reacted="true"]')).toHaveText('👍')
  await answers.first().getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(answers).toHaveCount(2, { timeout: 60_000 })
  expect(
    (await surface.locator('article').evaluateAll(rows => rows.map(row => row.getAttribute('data-event-id')))).slice(
      0,
      2
    )
  ).toEqual(originalIds)
  await answers.last().getByRole('button', { name: 'Branch in new chat', exact: true }).click()
  await expect(page).not.toHaveURL(sourceRoute)
  await expect(answers).toHaveCount(2)
  const branchRoute = page.url()
  await surface
    .locator('article')
    .filter({ hasText: 'Original immutable public input' })
    .first()
    .getByRole('button', { name: 'Edit message', exact: true })
    .click()
  await surface.getByRole('textbox', { name: 'Edit message', exact: true }).fill('Edited input in its own branch')
  await surface.getByRole('button', { name: 'Send edited message', exact: true }).click()
  await expect(page).not.toHaveURL(branchRoute)
  await expect(surface).toContainText('Edited input in its own branch')
  await expect(answers).toHaveCount(1, { timeout: 60_000 })
  await expect(surface).not.toContainText('Original immutable public input')
  await page.goto(sourceRoute)
  await expect(answers).toHaveCount(2)
  await expect(surface).toContainText('Original immutable public input')
  await expect(surface).not.toContainText('Edited input in its own branch')
  await expect(answers.first().locator('[data-reacted="true"]')).toHaveText('👍')
  await page.screenshot({ path: testInfo.outputPath('original-history-controls.png') })
  expect(rendererErrors).toEqual([])
})

test('original metadata menu renames and archives a conversation while archived public history stays readable', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const { page } = fixture!
  const surface = await openConversation(page)
  const sidebar = page.locator('[data-aino-sidebar]')
  const prompt = 'Automatic title from the first public input'
  await surface.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt)
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toHaveCount(1, { timeout: 60_000 })
  const route = page.url()
  const activeRow = sidebar.locator('[aria-current="page"]').filter({ hasText: prompt })
  await expect(activeRow).toBeVisible()
  await activeRow.locator('..').getByRole('button', { name: 'Session actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Rename session', exact: true })
  await dialog.getByRole('textbox').fill('Reviewed conversation title')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const renamed = sidebar.locator('[aria-current="page"]').filter({ hasText: 'Reviewed conversation title' })
  await expect(renamed).toBeVisible()
  const exportedPath = path.join(fixture!.sandbox.root, 'exported-public-conversation.json')
  await fixture!.app.evaluate(({ session }, destination) => {
    session.defaultSession.once('will-download', (_event, item) => item.setSavePath(destination))
  }, exportedPath)
  await renamed.locator('..').getByRole('button', { name: 'Session actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click()
  await expect.poll(() => fs.existsSync(exportedPath)).toBe(true)
  await expect
    .poll(() => {
      try {
        return JSON.parse(fs.readFileSync(exportedPath, 'utf8')).title
      } catch {
        return null
      }
    })
    .toBe('Reviewed conversation title')
  const exported = JSON.parse(fs.readFileSync(exportedPath, 'utf8'))
  expect(exported.format).toBe('aino-public-conversation-v1')
  expect(exported.events.filter((event: { kind: string }) => event.kind === 'conversation.response')).toHaveLength(1)
  expect(JSON.stringify(exported)).toContain(MOCK_REPLY)
  await renamed.locator('..').getByRole('button', { name: 'Session actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect(sidebar.getByText('Reviewed conversation title', { exact: true })).not.toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(route)
  await expect(surface).toContainText(prompt)
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toHaveCount(1)
  await expect(surface.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('archived-public-history.png') })
  expect(rendererErrors).toEqual([])
})

test('original dictation records through the chosen Profile and cancels when the expert changes', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const { page } = fixture!
  const surface = await openConversation(page)
  await surface.getByRole('button', { name: 'Choose responder', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^writer\b/ }).click()
  await surface.getByRole('button', { name: 'Voice dictation', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
  // The real MediaRecorder needs a non-empty capture before the scoped relay accepts it.
  const started = await page.evaluate(() => performance.now())
  await expect.poll(() => page.evaluate(() => performance.now())).toBeGreaterThan(started + 1200)
  await surface.getByRole('button', { name: 'Stop dictation', exact: true }).click()
  await page.keyboard.press('Escape')
  const composer = surface.getByRole('textbox', { name: 'Message', exact: true })
  await expect(composer).toHaveText('Voice transcript from writer', { timeout: 30_000 })
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toHaveCount(1, { timeout: 60_000 })
  await surface.getByRole('button', { name: 'Voice dictation', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await surface.getByRole('button', { name: 'Choose responder', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^reviewer\b/ }).click()
  await expect(composer).toHaveText('')
  await expect(surface.getByRole('button', { name: 'Voice dictation', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: testInfo.outputPath('owned-dictation.png') })
  expect(rendererErrors).toEqual([])
})

test('original reasoning control refreshes only the selected agent and preserves earlier model metadata', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const { page, sandbox } = fixture!
  const surface = await openConversation(page)
  const send = async (text: string) => {
    await surface.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
    await surface.getByRole('button', { name: 'Send', exact: true }).click()
  }
  await send('Before reasoning change')
  const answers = surface.locator('article').filter({ hasText: MOCK_REPLY })
  await expect(answers).toHaveCount(1, { timeout: 60_000 })
  const readModel = () => {
    const db = new DatabaseSync(path.join(sandbox.hermesHome, 'shared-state.db'), { readOnly: true })
    try {
      const id = new URL(page.url().split('#')[1], 'https://example.test').pathname.split('/').at(-1)
      return db
        .prepare(
          'SELECT session_generation, model_snapshot FROM hosted_room_conversation_runtimes WHERE conversation_id=? ORDER BY session_generation'
        )
        .all(id!)
    } finally {
      db.close()
    }
  }
  const before = readModel()
  await surface.getByTestId('reasoning-pill').click()
  await page.getByRole('menuitemradio', { name: 'Low', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(surface.getByTestId('reasoning-pill')).toContainText('Low')
  await send('After reasoning change')
  await expect(answers).toHaveCount(2, { timeout: 60_000 })
  const after = readModel()
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after.length).toBeGreaterThan(before.length)
  expect(JSON.parse(String(after.at(-1)!.model_snapshot)).reasoning_config.effort).toBe('low')
  await page.screenshot({ path: testInfo.outputPath('owned-reasoning-control.png') })
})

test('the original inline skill chip preserves prose, undo and the selected expert when sending', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const { page, mock } = fixture!
  const surface = await openConversation(page)
  await surface.getByRole('button', { name: 'Choose responder', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^writer\b/ }).click()
  const input = surface.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill('Please use /sha')
  await input.press('End')
  await expect(page.locator('[data-slot="composer-completion-drawer"]')).toContainText('shared-command', {
    timeout: 30_000
  })
  await input.press('Tab')
  const chip = input.locator('[data-ref-text="/shared-command"]')
  await expect(chip).toHaveCount(1)
  await input.press('ControlOrMeta+z')
  await expect(chip).toHaveCount(0)
  await expect(input).toContainText('Please use /sha')
  await input.press('ControlOrMeta+Shift+z')
  await expect(chip).toHaveCount(1)
  await input.press('End')
  await page.keyboard.insertText('to draft the summary.')
  await expect(input).toContainText('Please use')
  await expect(input).toContainText('to draft the summary.')
  await page.screenshot({ path: testInfo.outputPath('owned-inline-skill-chip.png') })
  const start = mock.receivedPrompts.length
  await surface.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY })).toHaveCount(1, { timeout: 60_000 })
  const requests = mock.receivedPrompts.slice(start).filter(text => text.includes('<current_user_request'))
  expect(requests).toHaveLength(1)
  expect(requests[0]).toContain('Please use /shared-command to draft the summary.')
  await expect(surface.locator('article').filter({ hasText: MOCK_REPLY }).locator('strong')).toHaveText('writer')
  await expect(input).toHaveText('')
})

test('an unsupported General execution environment retains the original ordinary chat', async () => {
  const { page, sandbox } = fixture!
  const configFile = path.join(sandbox.hermesHome, 'config.yaml')
  const original = fs.readFileSync(configFile, 'utf8')
  try {
    fs.writeFileSync(configFile, original + '\nterminal:\n  backend: docker\n')
    await page.locator('[data-tour="sidebar-nav-new-session"]').click()
    await expect(page.locator('.aino-home-layout')).toBeVisible()
    await expect(page.locator('[data-slot="composer-surface"]:visible [data-tour="model-pill"]')).toBeVisible()
    await expect(page.locator('main[data-conversation-id]')).toHaveCount(0)
  } finally {
    fs.writeFileSync(configFile, original)
  }
})

test('a backend without conversation RPCs retains the original new chat and can send a real turn', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const { page, mock, sandbox } = fixture!
  // Start on an ordinary draft, as an older installation would. Reopening a
  // managed-only ID against an old binary is deliberately not a downgrade path.
  const configFile = path.join(sandbox.hermesHome, 'config.yaml')
  const originalConfig = fs.readFileSync(configFile, 'utf8')
  try {
    fs.writeFileSync(configFile, originalConfig + '\nconversations:\n  enabled: false\n')
    await page.locator('[data-tour="sidebar-nav-new-session"]').click()
    await expect(page.locator('[data-slot="composer-surface"]:visible [data-tour="model-pill"]')).toBeVisible()
  } finally {
    fs.writeFileSync(configFile, originalConfig)
  }
  let rejectedCapabilities = 0
  // Simulate only the old protocol's missing method; all legacy traffic still
  // reaches the real authenticated backend and deterministic inference server.
  await page.routeWebSocket(/.*/, socket => {
    const backend = socket.connectToServer()
    socket.onMessage(message => {
      const request = JSON.parse(String(message)) as { id?: string | number; method?: string }
      if (request.method?.startsWith('conversations.')) {
        if (request.method === 'conversations.capabilities') rejectedCapabilities++
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })
        )
      } else {
        backend.send(message)
      }
    })
  })
  await page.reload()
  await waitForAppReady(fixture!, 60_000)
  await page.locator('[data-tour="sidebar-nav-new-session"]').click({ timeout: 60_000 })
  const composer = page.locator('[data-slot="composer-surface"]:visible')
  await expect(composer.locator('[data-tour="model-pill"]')).toBeVisible({ timeout: 30_000 })
  expect(rejectedCapabilities).toBeGreaterThan(0)
  await expect(page.locator('main[data-conversation-id]')).toHaveCount(0)
  const promptStart = mock.receivedPrompts.length
  await composer
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Continue using an older ordinary-chat backend.')
  await composer.getByRole('button', { name: 'Send', exact: true }).click()
  await expect
    .poll(() =>
      mock.receivedPrompts
        .slice(promptStart)
        .some(text => text.includes('Continue using an older ordinary-chat backend.'))
    )
    .toBe(true)
  await expect(page.getByText(MOCK_REPLY, { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('old-protocol-ordinary-chat.png') })
})
