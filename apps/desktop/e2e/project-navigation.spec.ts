import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { receivedUserTexts } from '../../../tests-js/scripts/mock-server'

import { buildAppEnv, launchDesktop, type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture
const rendererErrors: string[] = []

// Scenarios intentionally extend the projects and conversations created above.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    extraDisplayConfig: 'language: en'
  })
  const { page } = fixture
  await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', error => rendererErrors.push(error.message))
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+8613800138000')
  await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async ({}, testInfo) => {
  const logs = fixture && path.join(fixture.sandbox.hermesHome, 'logs')

  if (logs && existsSync(logs)) {
    cpSync(logs, testInfo.outputPath('backend-logs'), { recursive: true })
  }

  await fixture?.cleanup()
})

function storedSessions(): Array<{ id: string; cwd: string | null }> {
  const db = new DatabaseSync(path.join(fixture.sandbox.hermesHome, 'state.db'), { readOnly: true })

  try {
    return db.prepare('SELECT id, cwd FROM sessions').all() as Array<{ id: string; cwd: string | null }>
  } finally {
    db.close()
  }
}

async function pickFolder(folder: string | null) {
  // Only replace the OS chooser; project persistence and session creation use
  // the real Electron bridge and backend, with isolated data and mock inference.
  await fixture.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: folder === null, filePaths: folder ? [folder] : [] })
  }, folder)
}

async function browseAllProfiles() {
  const { page } = fixture

  await page.keyboard.press('ControlOrMeta+Shift+Digit0')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hermes.desktop.showAllProfiles'))).toBe('true')
}

async function sendMessage(text: string) {
  const { page } = fixture
  const composer = page.locator('[contenteditable="true"]:visible').last()
  await expect(composer).toBeVisible()
  await composer.fill(text)
  await composer.press('Enter')
  await expect(
    page.locator('[data-chat-surface]:visible').getByText(/Hello from the mock inference server/)
  ).toBeVisible({
    timeout: 60_000
  })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect.poll(() => sessionsForMessage(text).length).toBe(1)
  await expect(composer).toBeVisible()

  return sessionsForMessage(text)[0]!
}

function sessionsForMessage(text: string): Array<{ id: string; cwd: string | null }> {
  const db = new DatabaseSync(path.join(fixture.sandbox.hermesHome, 'state.db'), { readOnly: true })

  try {
    return db
      .prepare(
        "SELECT DISTINCT s.id, s.cwd FROM sessions s JOIN messages m ON m.session_id = s.id WHERE m.role = 'user' AND instr(m.content, ?) > 0"
      )
      .all(text) as Array<{ id: string; cwd: string | null }>
  } finally {
    db.close()
  }
}

test('separates pinned, project and ordinary chats through real folder and session workflows', async () => {
  test.setTimeout(180_000)
  const testInfo = test.info()
  const { page, sandbox } = fixture
  const sidebar = page.locator('[data-aino-sidebar]')
  const projects = sidebar.getByRole('button', { name: 'Projects', exact: true })
  const recents = sidebar.getByRole('button', { name: 'Recent', exact: true })
  const openFolder = sidebar.getByRole('button', { name: 'Open folder as project…', exact: true })
  const plainNew = sidebar.locator('[data-sidebar="menu-button"]:has([data-tour="sidebar-nav-new-session"])')

  const recentSection = sidebar
    .locator('[data-sidebar-section]')
    .filter({ has: page.getByRole('button', { name: 'Recent', exact: true }) })

  const projectSection = sidebar
    .locator('[data-sidebar-section]')
    .filter({ has: page.getByRole('button', { name: 'Projects', exact: true }) })

  const row = (text: string) => sidebar.locator('[data-sidebar-session-row]').filter({ hasText: text })

  await browseAllProfiles()
  await expect(projects).toBeVisible()
  await expect(recents).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Pinned', exact: true })).toHaveCount(0)

  if ((await projects.getAttribute('aria-expanded')) === 'true') {
    await projects.click()
  }

  await expect(openFolder).toBeVisible()
  await pickFolder(null)
  await openFolder.click()
  await expect(openFolder).toBeEnabled()
  await expect(projects).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => localStorage.getItem('hermes.desktop.showAllProfiles'))).toBe('true')

  if ((await recents.getAttribute('aria-expanded')) !== 'true') {
    await recents.click()
  }

  const folder = path.join(realpathSync(sandbox.root), 'sample-app')
  mkdirSync(folder)
  await pickFolder(folder)
  await openFolder.click()
  await expect(projects).toHaveAttribute('aria-expanded', 'true')
  await expect(sidebar.getByRole('button', { name: 'New session in sample-app', exact: true }).first()).toBeVisible()
  await expect(
    page.locator('[data-chat-surface]:visible').getByRole('button', { name: 'sample-app', exact: true })
  ).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('hermes.desktop.showAllProfiles'))).toBe('false')
  const projectChat = await sendMessage('Project conversation')
  expect(projectChat.cwd).toBe(folder)
  await expect(projectSection.getByText('Project conversation', { exact: true })).toBeVisible()
  await expect(recentSection.getByText('Project conversation', { exact: true })).toHaveCount(0)

  await plainNew.click()
  await expect(
    page.locator('[data-chat-surface]:visible').getByRole('button', { name: 'Select project', exact: true })
  ).toBeVisible()
  const ordinaryChat = await sendMessage('Ordinary conversation')
  expect(ordinaryChat.cwd).toBeNull()
  await expect(recentSection.getByText('Ordinary conversation', { exact: true })).toBeVisible()
  await expect(projectSection.getByText('Ordinary conversation', { exact: true })).toHaveCount(0)

  await row('Project conversation').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: 'Pinned', exact: true })).toBeVisible()
  await expect(row('Project conversation')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('project-navigation-pinned.png') })
  await row('Project conversation').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: 'Pinned', exact: true })).toHaveCount(0)
  await expect(row('Project conversation')).toHaveCount(1)

  await openFolder.click()
  await expect(sidebar.getByRole('button', { name: 'New session in sample-app', exact: true }).first()).toBeVisible()
  await expect(
    page.locator('[data-chat-surface]:visible').getByRole('button', { name: 'sample-app', exact: true })
  ).toBeVisible()
  await plainNew.click()
  await expect(
    page.locator('[data-chat-surface]:visible').getByRole('button', { name: 'Select project', exact: true })
  ).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Open sample-app', exact: true })).toHaveCount(1)

  const createdFolder = path.join(realpathSync(sandbox.root), 'created-project')
  mkdirSync(createdFolder)
  await browseAllProfiles()
  await pickFolder(createdFolder)
  await sidebar.getByRole('button', { name: 'New project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project', exact: true })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('hermes.desktop.showAllProfiles'))).toBe('false')
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Created project')
  await dialog.getByRole('button', { name: 'Add folder', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(
    sidebar.getByRole('button', { name: 'New session in Created project', exact: true }).first()
  ).toBeVisible()
  await expect(
    page.locator('[data-chat-surface]:visible').getByRole('button', { name: 'Created project', exact: true })
  ).toBeVisible()
  const createdChat = await sendMessage('Created project conversation')
  expect(createdChat.cwd).toBe(createdFolder)
  await plainNew.click()
  await expect(sidebar.getByRole('button', { name: 'Open Created project', exact: true })).toBeVisible()

  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('project-navigation-desktop.png') })
})

test('keeps project entry points and composer usable at a narrow desktop width', async () => {
  const testInfo = test.info()
  const { page, app } = fixture

  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 800, false))
    const actions = page.locator('[data-project-section-actions]')
    const sidebar = page.locator('[data-aino-sidebar]')
    await expect(actions.getByRole('button', { name: 'New project', exact: true })).toBeVisible()
    await expect(actions.getByRole('button', { name: 'Open folder as project…', exact: true })).toBeVisible()
    const actionsBox = await actions.boundingBox()
    const sidebarBox = await sidebar.boundingBox()
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width)
    await expect(page.locator('[contenteditable="true"]:visible').last()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('project-navigation-narrow.png') })
    expect(rendererErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 800, false))
  }
})

test('keeps draft text through project selection and manages folders without changing sent chats', async () => {
  test.setTimeout(180_000)
  const { page, sandbox } = fixture
  const sidebar = page.locator('[data-aino-sidebar]')
  const plainNew = sidebar.locator('[data-sidebar="menu-button"]:has([data-tour="sidebar-nav-new-session"])')
  await plainNew.click()
  const composer = page.locator('[contenteditable="true"]:visible').last()
  await composer.fill('Draft project binding probe')
  const originalEditor = await composer.elementHandle()
  const surface = page.locator('[data-chat-surface]:visible').last()
  await surface.getByRole('button', { name: 'Select project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'sample-app', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'sample-app', exact: true })).toBeVisible()
  await expect(composer).toHaveText('Draft project binding probe')
  expect(await originalEditor!.evaluate(el => el.isConnected)).toBe(true)

  const attachedFolder = path.join(realpathSync(sandbox.root), 'sample-app', 'context-source')
  mkdirSync(attachedFolder)
  await pickFolder(attachedFolder)
  await surface.locator('[data-slot="composer-context-menu"]').click()
  await page.getByRole('menuitem', { name: 'Folder…', exact: true }).click()
  await expect(surface.locator('[data-slot="composer-attachments"]')).toContainText('context-source')

  await surface.getByRole('button', { name: 'sample-app', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Created project', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'Created project', exact: true })).toBeVisible()
  await expect(composer).toHaveText('Draft project binding probe')
  await surface.getByRole('button', { name: 'Created project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'No project', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'Select project', exact: true })).toBeVisible()
  await expect(composer).toHaveText('Draft project binding probe')
  await surface.getByRole('button', { name: 'Select project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Created project', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'Created project', exact: true })).toBeVisible()
  const original = await sendMessage('Draft project binding probe')
  expect(original.cwd).toBe(path.join(realpathSync(sandbox.root), 'created-project'))
  expect(receivedUserTexts().find(text => text.includes('Draft project binding probe'))).toContain(attachedFolder)

  const sentSurfaceId = await surface.getAttribute('data-composer-surface-id')
  await surface.getByRole('button', { name: 'Created project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New session in Created project', exact: true }).click()
  // The sent chat's composer is already empty; wait for the newly created
  // session surface before opening its project picker.
  await expect(surface).not.toHaveAttribute('data-composer-surface-id', sentSurfaceId!)
  await expect(composer).toHaveText('')
  await surface.getByRole('button', { name: 'Created project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'sample-app', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'sample-app', exact: true })).toBeVisible()
  await expect(composer).toHaveText('')
  expect(storedSessions().find(row => row.id === original.id)?.cwd).toBe(original.cwd)

  await composer.fill('Unsent tile project binding probe')
  const tileEditor = await composer.elementHandle()
  await pickFolder(attachedFolder)
  await surface.locator('[data-slot="composer-context-menu"]').click()
  await page.getByRole('menuitem', { name: 'Folder…', exact: true }).click()
  await expect(surface.locator('[data-slot="composer-attachments"]')).toContainText('context-source')
  await surface.getByRole('button', { name: 'sample-app', exact: true }).click()
  await expect(page.getByText('Start a new chat in project', { exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Created project', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'Created project', exact: true })).toBeEnabled()
  await expect(composer).toHaveText('Unsent tile project binding probe')
  expect(await tileEditor!.evaluate(el => el.isConnected)).toBe(true)
  const tile = await sendMessage('Unsent tile project binding probe')
  expect(tile.id).not.toBe(original.id)
  expect(tile.cwd).toBe(original.cwd)
  expect(receivedUserTexts().find(text => text.includes('Unsent tile project binding probe'))).toContain(attachedFolder)

  await plainNew.click()
  await sidebar.getByRole('button', { name: 'Open sample-app', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Manage folders', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Manage folders', exact: true })
  const extra = path.join(realpathSync(sandbox.root), 'extra-folder')
  mkdirSync(extra)
  await pickFolder(extra)
  await manager.getByRole('button', { name: 'Add folder', exact: true }).click()
  const added = manager.getByRole('listitem').filter({ hasText: extra })
  await added.getByRole('button', { name: 'Set as primary folder', exact: true }).click()
  await expect(added.getByText('primary', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('project-folders-manager.png') })

  const previous = manager
    .getByRole('listitem')
    .filter({ hasText: path.join(realpathSync(sandbox.root), 'sample-app') })

  await previous.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(previous).toHaveCount(0)
  expect(existsSync(path.join(realpathSync(sandbox.root), 'sample-app'))).toBe(true)
  expect(sessionsForMessage('Project conversation')[0]?.cwd).toBe(path.join(realpathSync(sandbox.root), 'sample-app'))
  await manager.getByRole('button', { name: 'Close', exact: true }).click()
  await sidebar.getByRole('button', { name: 'New session in sample-app', exact: true }).first().click()
  const primary = await sendMessage('Primary folder project probe')
  expect(primary.cwd).toBe(extra)
  expect(rendererErrors).toEqual([])
  await page.screenshot({ path: test.info().outputPath('draft-project-binding.png') })
})

test('creates and opens projects from the composer without replacing the draft', async () => {
  test.setTimeout(120_000)
  const { page, sandbox } = fixture
  const sidebar = page.locator('[data-aino-sidebar]')
  await sidebar.locator('[data-sidebar="menu-button"]:has([data-tour="sidebar-nav-new-session"])').click()
  const composer = page.locator('[contenteditable="true"]:visible').last()
  const surface = page.locator('[data-chat-surface]:visible').last()
  await expect(surface.getByRole('button', { name: 'Select project', exact: true })).toBeVisible()
  await composer.fill('Composer project creation probe')
  const editor = await composer.elementHandle()
  const createdFolder = path.join(realpathSync(sandbox.root), 'composer-created')
  mkdirSync(createdFolder)
  await pickFolder(createdFolder)
  await surface.getByRole('button', { name: 'Select project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project', exact: true })
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Composer created')
  await dialog.getByRole('button', { name: 'Add folder', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(surface.getByRole('button', { name: 'Composer created', exact: true })).toBeVisible()
  await expect(composer).toHaveText('Composer project creation probe')
  expect(await editor!.evaluate(el => el.isConnected)).toBe(true)

  const openedFolder = path.join(realpathSync(sandbox.root), 'composer-opened')
  mkdirSync(openedFolder)
  await pickFolder(openedFolder)
  await surface.getByRole('button', { name: 'Composer created', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open folder as project…', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'composer-opened', exact: true })).toBeEnabled()
  await expect(composer).toHaveText('Composer project creation probe')
  expect(await editor!.evaluate(el => el.isConnected)).toBe(true)
  const row = await sendMessage('Composer project creation probe')
  expect(row.cwd).toBe(openedFolder)

  await sidebar.getByRole('button', { name: 'Workspaces', exact: true }).click()
  const workspaces = page.locator('[data-workspaces-page]')
  await workspaces.getByRole('button', { name: 'Advanced workspaces', exact: true }).click()
  const allProfiles = workspaces.getByRole('switch', { name: 'All profiles', exact: true })
  await expect(allProfiles).toBeVisible()
  await allProfiles.check()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hermes.desktop.showAllProfiles'))).toBe('true')
  await allProfiles.uncheck()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hermes.desktop.showAllProfiles'))).toBe('false')
  await page.screenshot({ path: test.info().outputPath('workspaces-advanced-workspaces.png') })
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 800, false))

  try {
    const advanced = workspaces.getByRole('button', { name: 'Advanced workspaces', exact: true })
    await expect(advanced).toBeVisible()

    if ((await advanced.getAttribute('aria-expanded')) !== 'true') {
      await advanced.click()
    }

    await expect(allProfiles).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('workspaces-advanced-narrow.png') })
  } finally {
    await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 800, false))
    await sidebar.locator('[data-sidebar="menu-button"]:has([data-tour="sidebar-nav-new-session"])').click()
  }

  expect(rendererErrors).toEqual([])
})

test('keeps files, summary, review and new shells attached to a chat tab without moving running terminals', async () => {
  test.setTimeout(180_000)
  const { page, sandbox } = fixture
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
  const sidebar = page.locator('[data-aino-sidebar]')
  const openFolder = sidebar.getByRole('button', { name: 'Open folder as project…', exact: true })
  const row = (text: string) => sidebar.locator('[data-sidebar-session-row]').filter({ hasText: text })

  const showProject = async (name: string) => {
    const back = sidebar.getByRole('button', { name: 'All projects', exact: true })

    if (await back.isVisible()) {
      await back.click()
    }

    await sidebar.getByRole('button', { name: `Open ${name}`, exact: true }).click()
  }

  const folders = ['tools-project-a', 'tools-project-b'].map(name => path.join(realpathSync(sandbox.root), name))
  const conversationIds: string[] = []

  for (const [index, folder] of folders.entries()) {
    mkdirSync(folder)
    writeFileSync(path.join(folder, `project-${index}.txt`), `Project ${index}\n`)
    writeFileSync(path.join(folder, 'shared.txt'), 'original\n')
    execFileSync('git', ['init', '--quiet', folder])
    execFileSync('git', ['-C', folder, 'add', '.'])
    execFileSync('git', [
      '-C',
      folder,
      '-c',
      'user.name=Aino Test',
      '-c',
      'user.email=aino-test@example.com',
      'commit',
      '--quiet',
      '-m',
      'Fixture'
    ])
    writeFileSync(path.join(folder, 'shared.txt'), `changed in project ${index}\n`)
    await pickFolder(folder)
    await openFolder.click()
    await expect(
      page.locator('[data-chat-surface]:visible').getByRole('button', { name: path.basename(folder), exact: true })
    ).toBeVisible()
    const sent = await sendMessage(`Tools conversation ${index}`)
    expect(sent.cwd).toBe(folder)
    conversationIds.push(sent.id)
  }

  await sidebar.locator('[data-sidebar="menu-button"]:has([data-tour="sidebar-nav-new-session"])').click()
  await expect(
    page.locator('[data-chat-surface]:visible').getByRole('button', { name: 'Select project', exact: true })
  ).toBeVisible()
  await showProject('tools-project-a')
  await row('Tools conversation 0')
    .getByRole('button')
    .first()
    .click({ modifiers: ['ControlOrMeta'] })
  const tile = page.locator(`[data-chat-surface][data-composer-target="tile:${conversationIds[0]}"]`)
  await expect(tile).toBeAttached()
  await row('Tools conversation 0').getByRole('button').first().click()
  await expect(tile.getByRole('button', { name: 'tools-project-a', exact: true })).toBeVisible()
  await tile.locator('[contenteditable="true"]').click()

  const showRight = page.getByRole('button', { name: 'Show right sidebar', exact: true })

  if (await showRight.isVisible()) {
    await showRight.click()
  }

  const files = page.locator('[data-file-browser]:visible')
  await expect(files.getByText('project-0.txt', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Session resources', exact: true }).click()
  const summary = page.locator('[data-slot="summary-pane"]')
  await expect(summary.getByText('tools-project-a', { exact: true })).toBeVisible()
  await files.getByRole('button', { name: 'Refresh tree', exact: true }).click()
  await expect(summary.getByText('tools-project-a', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /^(Show|Toggle) terminal$/ }).click()
  const terminalTabs = page.getByRole('tablist', { name: 'Terminals', exact: true })
  await expect(terminalTabs.getByRole('tab')).toHaveCount(1)

  const savedTerminals = () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') || '{}')

      return state as {
        activeTerminalId: string
        terminals: Array<{ cwd: string; id: string; title: string; reviveBuffer?: string }>
      }
    })

  await expect.poll(async () => (await savedTerminals()).terminals[0]?.cwd).toBe(folders[0])
  await expect(terminalTabs.getByRole('tab').first()).not.toHaveAccessibleName('1. Terminal')
  const firstTerminal = (await savedTerminals()).terminals[0]!

  const termInput = page.locator('[data-terminal]:visible .xterm-helper-textarea')
  await termInput.fill('')
  await termInput.press('Control+u')
  await termInput.pressSequentially('printf "aino-live-%s\\n" "$PWD"')
  await termInput.press('Enter')
  await expect
    .poll(async () => (await savedTerminals()).terminals[0]?.reviveBuffer)
    .toContain(`aino-live-${folders[0]}`)

  await summary.getByRole('button', { name: 'Details', exact: true }).click()
  await summary.getByRole('button', { name: 'View diff', exact: true }).click()
  const review = page.getByRole('complementary', { name: 'Review', exact: true })
  await expect(review.getByText('shared.txt', { exact: true })).toBeVisible()
  await showProject('tools-project-b')
  await row('Tools conversation 1').click()
  await expect(summary.getByText('tools-project-b', { exact: true })).toBeVisible()
  // Review was explicitly opened for A; changing the chat must not repin it.
  await review.getByText('shared.txt', { exact: true }).click()
  await expect(review.getByText('changed in project 0', { exact: false })).toBeVisible()

  await terminalTabs.getByRole('button', { name: 'New terminal', exact: true }).click()
  await expect(terminalTabs.getByRole('tab')).toHaveCount(2)
  await expect.poll(async () => (await savedTerminals()).terminals[1]?.cwd).toBe(folders[1])
  expect((await savedTerminals()).terminals[0]!.id).toBe(firstTerminal.id)
  expect((await savedTerminals()).terminals[0]!.cwd).toBe(folders[0])
  expect((await savedTerminals()).terminals[0]!.reviveBuffer).toContain(`aino-live-${folders[0]}`)
  await page.screenshot({ path: test.info().outputPath('tools-project-b-pinned-review-a.png') })

  await showProject('tools-project-a')
  await row('Tools conversation 0').click()
  await expect(summary.getByText('tools-project-a', { exact: true })).toBeVisible()
  await expect.poll(async () => (await savedTerminals()).activeTerminalId).toBe(firstTerminal.id)
  expect(rendererErrors).toEqual([])
  await page.screenshot({ path: test.info().outputPath('tools-project-a-restored.png') })
})

test('selects local and isolated work locations without losing the draft or moving sent conversations', async () => {
  test.setTimeout(180_000)
  const { page, sandbox } = fixture
  const sidebar = page.locator('[data-aino-sidebar]')
  const folder = path.join(realpathSync(sandbox.root), 'work-location-project')
  mkdirSync(folder)
  writeFileSync(path.join(folder, 'README.md'), '# Work locations\n')
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', folder])
  execFileSync('git', ['-C', folder, 'add', 'README.md'])
  execFileSync('git', [
    '-C',
    folder,
    '-c',
    'user.name=Aino Test',
    '-c',
    'user.email=aino-test@example.com',
    'commit',
    '--quiet',
    '-m',
    'Fixture'
  ])
  const attachedFolder = path.join(folder, 'context-source')
  mkdirSync(attachedFolder)
  writeFileSync(path.join(attachedFolder, 'notes.txt'), 'Draft context\n')

  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 900, false))
  await pickFolder(folder)
  await sidebar.getByRole('button', { name: 'Open folder as project…', exact: true }).click()
  const surface = page.locator('[data-chat-surface]:visible').last()
  const composer = surface.locator('[contenteditable="true"]')
  await expect(surface.getByRole('button', { name: 'work-location-project', exact: true })).toBeVisible()
  await composer.fill('Work location draft probe')
  const editor = await composer.elementHandle()
  await pickFolder(attachedFolder)
  await surface.locator('[data-slot="composer-context-menu"]').click()
  await page.getByRole('menuitem', { name: 'Folder…', exact: true }).click()
  const attachments = surface.locator('[data-slot="composer-attachments"]')
  await expect(attachments).toContainText('context-source')
  const mode = surface.getByRole('button', { name: 'Work location', exact: true })
  await expect(mode).toHaveText('Local')
  await mode.click()
  await page.getByRole('menuitem', { name: 'Create worktree…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New worktree', exact: true })
  await dialog.getByPlaceholder('e.g. my-feature').fill('work-location-probe')
  await dialog.getByRole('button', { name: 'New worktree', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(mode).toHaveText('Worktree')
  await expect(surface.locator('.coding-status-bar')).toContainText('work-location-probe')
  await expect(composer).toHaveText('Work location draft probe')
  await expect(attachments).toContainText('context-source')
  expect(await editor!.evaluate(el => el.isConnected)).toBe(true)
  expect(execFileSync('git', ['-C', folder, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('main')
  await page.screenshot({ path: test.info().outputPath('composer-isolated-worktree.png') })

  await mode.click()
  await page.getByRole('menuitem', { name: 'Local', exact: true }).click()
  await expect(mode).toHaveText('Local')
  await expect(composer).toHaveText('Work location draft probe')
  await expect(attachments).toContainText('context-source')
  await mode.click()
  await page.getByRole('menuitem', { name: 'work-location-probe', exact: true }).click()
  await expect(mode).toHaveText('Worktree')
  const sent = await sendMessage('Work location draft probe')
  expect(sent.cwd).not.toBe(folder)
  expect(execFileSync('git', ['-C', sent.cwd!, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe(
    'work-location-probe'
  )
  expect(receivedUserTexts().find(text => text.includes('Work location draft probe'))).toContain(attachedFolder)

  await mode.click()
  await expect(page.getByText('New chat location', { exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Local', exact: true }).click()
  await expect(composer).toHaveText('')
  await expect(mode).toHaveText('Local')
  expect(storedSessions().find(row => row.id === sent.id)?.cwd).toBe(sent.cwd)
  const review = page.getByRole('complementary', { name: 'Review', exact: true })

  if (await review.isVisible()) {
    await review.getByRole('button', { name: 'Close', exact: true }).first().click()
  }

  const hideFiles = page.getByRole('button', { name: 'Hide right sidebar', exact: true })

  if (await hideFiles.isVisible()) {
    await hideFiles.click()
  }

  const summaryToggle = page.getByRole('button', { name: 'Session resources', exact: true })

  if ((await summaryToggle.getAttribute('aria-pressed')) !== 'true') {
    await summaryToggle.click()
  }

  const summaryPane = page.locator('[data-slot="summary-pane"]')
  await expect(summaryPane.getByText('work-location-project', { exact: true })).toBeVisible()
  await expect(summaryPane.getByText('Could not load this conversation’s history', { exact: true })).toHaveCount(0)
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 900, false))
  await mode.click()
  await expect(page.getByRole('menuitem', { name: 'Create worktree…', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('composer-work-locations-narrow.png') })
  await page.keyboard.press('Escape')
  expect(rendererErrors).toEqual([])
})

test('restores a worktree conversation and its draft and tools after closing the desktop', async () => {
  test.setTimeout(180_000)
  const { page, sandbox } = fixture
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
  const surface = page.locator('[data-chat-surface]:visible').last()
  await surface.getByRole('button', { name: 'Work location', exact: true }).click()
  await page.getByRole('menuitem', { name: 'work-location-probe', exact: true }).click()
  const sent = await sendMessage('Restart worktree conversation')
  writeFileSync(path.join(sent.cwd!, 'restart-proof.txt'), 'Persisted worktree file\n')
  const sidebar = page.locator('[data-aino-sidebar]')
  const row = sidebar.locator('[data-sidebar-session-row]').filter({ hasText: 'Restart worktree conversation' })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  const recent = sidebar.getByRole('button', { name: 'Recent', exact: true })

  if ((await recent.getAttribute('aria-expanded')) === 'true') {
    await recent.click()
  }

  const showFiles = page.getByRole('button', { name: 'Show right sidebar', exact: true })

  if (await showFiles.isVisible()) {
    await showFiles.click()
  }

  // A narrowed pane can remain as a collapsed rail after the window widens.
  if (!(await page.locator('[data-file-browser]:visible').isVisible())) {
    await page.getByRole('tab', { name: 'Files', exact: true }).click()
  }

  await page.locator('[data-file-browser]:visible').getByRole('button', { name: 'Refresh tree', exact: true }).click()
  await expect(
    page.locator('[data-file-browser]:visible').getByText('restart-proof.txt', { exact: true })
  ).toBeVisible()
  const summary = page.locator('[data-slot="summary-pane"]')
  await expect(summary.getByText('work-location-project', { exact: true })).toBeVisible()
  const terminalTabs = page.getByRole('tablist', { name: 'Terminals', exact: true })
  await terminalTabs.getByRole('button', { name: 'New terminal', exact: true }).click()

  const terminalState = (target: typeof page) =>
    target.evaluate(
      () =>
        JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') || '{}') as {
          activeTerminalId: string
          terminals: Array<{ id: string; cwd: string; reviveBuffer?: string }>
        }
    )

  await expect
    .poll(async () => {
      const state = await terminalState(page)

      return state.terminals.find(terminal => terminal.id === state.activeTerminalId)?.cwd
    })
    .toBe(sent.cwd)
  const before = await terminalState(page)
  const input = page.locator('[data-terminal]:visible .xterm-helper-textarea')
  await expect(input).toHaveCount(1)
  await input.pressSequentially('printf "aino-before-restart-%s\\n" "$PWD"')
  await input.press('Enter')
  await expect
    .poll(
      async () =>
        (await terminalState(page)).terminals.find(terminal => terminal.id === before.activeTerminalId)?.reviveBuffer
    )
    .toContain(`aino-before-restart-${sent.cwd}`)
  await surface.locator('[contenteditable="true"]').fill('Keep this unfinished worktree draft')
  await page.screenshot({ path: test.info().outputPath('worktree-before-restart.png') })

  await fixture.app.close()
  const reopened = await launchDesktop(buildAppEnv(sandbox))
  reopened.page.on('pageerror', error => rendererErrors.push(error.message))

  try {
    await waitForAppReady({ ...fixture, ...reopened }, 120_000)
    const restored = reopened.page
    const restoredSurface = restored.locator('[data-chat-surface]:visible').last()
    await expect(restoredSurface.getByRole('button', { name: 'Work location', exact: true })).toHaveText('Worktree')
    await expect(restoredSurface.locator('[contenteditable="true"]')).toHaveText('Keep this unfinished worktree draft')
    // Summary visibility is a window-local choice; its contents still follow
    // the restored chat when the user opens it in the new window.
    await restored.getByRole('button', { name: 'Session resources', exact: true }).click()
    await expect(
      restored.locator('[data-slot="summary-pane"]').getByText('work-location-project', { exact: true })
    ).toBeVisible()
    await expect(
      restored.locator('[data-file-browser]:visible').getByText('restart-proof.txt', { exact: true })
    ).toBeVisible()
    await expect(
      restored.locator('[data-aino-sidebar]').getByRole('button', { name: 'Pinned', exact: true })
    ).toBeVisible()
    await expect(
      restored.locator('[data-aino-sidebar]').getByRole('button', { name: 'Recent', exact: true })
    ).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(async () => (await terminalState(restored)).activeTerminalId).toBe(before.activeTerminalId)
    const terminal = (await terminalState(restored)).terminals.find(item => item.id === before.activeTerminalId)!
    expect(terminal.cwd).toBe(sent.cwd)
    expect(terminal.reviveBuffer).toContain(`aino-before-restart-${sent.cwd}`)
    const restoredInput = restored.locator('[data-terminal]:visible .xterm-helper-textarea')
    await expect(restoredInput).toHaveCount(1)
    await restoredInput.pressSequentially('printf "aino-after-restart-%s\\n" "$PWD"')
    await restoredInput.press('Enter')
    await expect
      .poll(
        async () =>
          (await terminalState(restored)).terminals.find(item => item.id === before.activeTerminalId)?.reviveBuffer
      )
      .toContain(`aino-after-restart-${sent.cwd}`)
    await restoredSurface.locator('[contenteditable="true"]').press('Enter')
    await expect
      .poll(() => sessionsForMessage('Keep this unfinished worktree draft').map(session => session.id))
      .toEqual([sent.id])
    expect(storedSessions().find(session => session.id === sent.id)?.cwd).toBe(sent.cwd)
    await expect(restored.locator('vite-error-overlay')).toHaveCount(0)
    expect(rendererErrors).toEqual([])
    await restored.screenshot({ path: test.info().outputPath('worktree-after-restart.png') })
  } finally {
    await reopened.app.close()
  }
})
