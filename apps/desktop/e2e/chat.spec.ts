/**
 * E2E chat tests — send a message and verify a response appears.
 *
 * Requires the full boot chain to complete (hermes serve + mock inference
 * provider). The mock server returns a canned reply, so we verify the
 * response text shows up in the chat transcript.
 *
 * Prerequisite: `npm run build` must have been run so dist/ exists.
 */

import { BLOCKING_CLARIFY_QUESTION, BLOCKING_CLARIFY_TRIGGER } from '../../../tests-js/scripts/mock-server'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'
import { expectVisualSnapshot } from './visual-snapshot'

let fixture: MockBackendFixture | null = null

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: en',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true'
  })
  const { page } = fixture

  const agreement = page.getByRole('checkbox', {
    name: 'Agree to the user agreement and privacy policy',
    exact: true
  })

  await expect(agreement).toBeVisible({ timeout: 120_000 })
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+8613800138000')
  await agreement.check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture!, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test.describe('chat interaction with mock backend', () => {
  test('send a message and receive a response', async () => {
    const page = fixture!.page

    // Find the composer — it's a contenteditable textbox.
    const composer = page.locator('[contenteditable="true"]').first()
    await composer.waitFor({ state: 'visible', timeout: 10_000 })

    // Click to focus, then type the message character by character.
    // Using `type` instead of `fill` because the composer is a
    // contenteditable div with custom keydown handling that tracks
    // IME composition state — `fill` bypasses the event chain.
    await composer.click()
    await composer.type('Hello, can you hear me?', { delay: 20 })

    // Submit with Enter — the composer's keydown handler intercepts
    // plain Enter (without Shift) and calls submitDraft().
    await page.keyboard.press('Enter')

    // Wait for the user's message to appear in the transcript.
    // The message renders as an assistant-ui message in the chat view.
    await page.waitForFunction(
      () => {
        const body = document.body

        if (!body) {
          return false
        }

        return (body.textContent ?? '').includes('Hello, can you hear me?')
      },
      undefined,
      { timeout: 15_000 }
    )

    // Wait for the mock response to appear. The canned reply is:
    // "Hello from the mock inference server! The full boot chain is working."
    // Give it a generous timeout — the inference request goes through the
    // gateway → hermes serve → mock server → streaming SSE back.
    await page.waitForFunction(
      () => {
        const body = document.body

        if (!body) {
          return false
        }

        const text = body.textContent ?? ''

        return text.includes('mock inference server') || text.includes('boot chain is working')
      },
      undefined,
      { timeout: 60_000 }
    )
  })

  test('shows session search results below the titlebar and resumes the selected conversation', async () => {
    const page = fixture!.page
    await page.locator('button:has-text("New session")').first().click()
    const composer = page.locator('[contenteditable="true"]').first()

    await composer.waitFor({ state: 'visible', timeout: 10_000 })
    await expect(composer).toHaveText('')
    await composer.click()
    await composer.type('Find this titlebar search conversation', { delay: 10 })
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => (document.body.textContent ?? '').includes('mock inference server'), undefined, {
      timeout: 60_000
    })
    await expect(composer).toHaveText('')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)

    const titlebar = page.locator('[data-slot="app-titlebar"]')
    const sidebar = page.locator('[data-aino-sidebar]')
    const anySessionSearch = page.getByRole('textbox', { name: 'Search sessions' })
    const titlebarSearch = titlebar.getByRole('textbox', { name: 'Search sessions' })
    const targetUrl = page.url()
    const targetTitle = await page.locator('[data-current-session-title]').first().innerText()

    // First prove the existing search surface has mounted; a missing field is
    // a different regression from rendering the real field in the wrong pane.
    await expect(anySessionSearch).toBeVisible({ timeout: 30_000 })
    await expect(titlebarSearch).toBeVisible()
    await expect(sidebar).toBeVisible()
    await expect(page.locator('[data-slot="sidebar-identity-footer"]')).toBeVisible()
    await expect(sidebar.getByRole('textbox', { name: 'Search sessions' })).toHaveCount(0)

    await page.locator('button:has-text("New session")').first().click()
    await expect(page).not.toHaveURL(targetUrl)
    await expect(titlebar.locator('[data-window-session-title]')).toHaveCount(0)
    const chatSurface = page.locator('[data-chat-surface]').first()
    const chatBeforeSearch = await chatSurface.boundingBox()

    await titlebarSearch.fill('mock inference')
    await expect(titlebarSearch).toBeFocused()
    await expect(sidebar.locator('[data-sessions-mode="search"]')).toHaveCount(0)

    const results = page.locator('[data-session-search-results]')
    await expect(results).toBeVisible()
    const resultRow = results.getByRole('button', { name: targetTitle, exact: false }).first()
    await expect(resultRow).toBeVisible()

    const resultsLabel = results.locator('[data-sidebar-section-label]')
    await expect(resultsLabel).toHaveText(/\S+/)
    await expect(resultsLabel).toHaveAttribute('data-sidebar-label-tone', 'neutral')
    await expect(resultsLabel.locator('.dither')).toHaveCount(0)

    const resultsLabelStyle = await resultsLabel.evaluate(label => {
      const styles = getComputedStyle(label)

      return {
        color: styles.color,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
        letterSpacing: styles.letterSpacing,
        textTransform: styles.textTransform
      }
    })

    expect(resultsLabelStyle.color, JSON.stringify(resultsLabelStyle)).not.toBe('rgb(43, 127, 255)')
    expect(resultsLabelStyle.fontSize, JSON.stringify(resultsLabelStyle)).toBe('13px')
    expect(resultsLabelStyle.fontWeight, JSON.stringify(resultsLabelStyle)).toBe('500')
    expect(resultsLabelStyle.letterSpacing, JSON.stringify(resultsLabelStyle)).toBe('normal')
    expect(resultsLabelStyle.textTransform, JSON.stringify(resultsLabelStyle)).toBe('none')

    const placement = await titlebarSearch.locator('..').evaluate(field => {
      const titlebar = field.closest<HTMLElement>('[data-slot="app-titlebar"]')

      if (!titlebar) {
        throw new Error('Session search is not inside the app titlebar')
      }

      const fieldRect = field.getBoundingClientRect()
      const titlebarRect = titlebar.getBoundingClientRect()
      const windowControls = document.querySelector('[data-slot="titlebar-window-controls"]')?.getBoundingClientRect()
      const tools = document.querySelector('[data-slot="titlebar-app-controls"]')?.getBoundingClientRect()

      if (!windowControls || !tools) {
        throw new Error('Window control clusters are missing')
      }

      return {
        containedVertically: fieldRect.top >= titlebarRect.top && fieldRect.bottom <= titlebarRect.bottom,
        clearsWindowControls: fieldRect.left >= windowControls.right,
        clearsTools: fieldRect.right <= tools.left,
        width: fieldRect.width
      }
    })

    expect(placement.containedVertically, JSON.stringify(placement)).toBe(true)
    expect(placement.clearsWindowControls, JSON.stringify(placement)).toBe(true)
    expect(placement.clearsTools, JSON.stringify(placement)).toBe(true)
    expect(placement.width, JSON.stringify(placement)).toBeGreaterThanOrEqual(120)

    const panelPlacement = await results.evaluate(panel => {
      const titlebar = panel.closest<HTMLElement>('[data-slot="app-titlebar"]')
      const shell = panel.closest<HTMLElement>('[data-session-search-shell]')

      if (!titlebar || !shell) {
        throw new Error('Session results are not anchored to the titlebar search shell')
      }

      const panelRect = panel.getBoundingClientRect()
      const shellRect = shell.getBoundingClientRect()
      const titlebarRect = titlebar.getBoundingClientRect()

      return {
        alignedRight: Math.abs(panelRect.right - shellRect.right),
        belowTitlebar: panelRect.top >= titlebarRect.bottom - 1,
        atLeastFieldWidth: panelRect.width >= shellRect.width,
        insideWindow: panelRect.left >= 0 && panelRect.right <= window.innerWidth
      }
    })

    expect(panelPlacement.belowTitlebar, JSON.stringify(panelPlacement)).toBe(true)
    expect(panelPlacement.alignedRight, JSON.stringify(panelPlacement)).toBeLessThanOrEqual(2)
    expect(panelPlacement.atLeastFieldWidth, JSON.stringify(panelPlacement)).toBe(true)
    expect(panelPlacement.insideWindow, JSON.stringify(panelPlacement)).toBe(true)

    const chatDuringSearch = await chatSurface.boundingBox()
    expect(chatDuringSearch?.y, JSON.stringify({ chatBeforeSearch, chatDuringSearch })).toBe(chatBeforeSearch?.y)
    expect(chatDuringSearch?.height, JSON.stringify({ chatBeforeSearch, chatDuringSearch })).toBe(
      chatBeforeSearch?.height
    )

    await resultRow.click()
    await expect(page).toHaveURL(targetUrl)
    await expect(titlebarSearch).toHaveValue('')
    await expect(results).toHaveCount(0)
    const restoredHeading = titlebar.locator('[data-window-session-title]')
    await expect(restoredHeading).toBeVisible()
    await expect(restoredHeading).toContainText(targetTitle)

    const restoredPlacement = await titlebarSearch.locator('..').evaluate(field => {
      const heading = field.closest('[data-slot="app-titlebar"]')?.querySelector('[data-window-session-title]')

      if (!heading) {
        throw new Error('The restored conversation title is missing')
      }

      return {
        headingRight: heading.getBoundingClientRect().right,
        searchLeft: field.getBoundingClientRect().left
      }
    })

    expect(restoredPlacement.searchLeft, JSON.stringify(restoredPlacement)).toBeGreaterThanOrEqual(
      restoredPlacement.headingRight
    )
  })

  test('keeps the composer docked and uses the focused conversation layout after send', async () => {
    const page = fixture!.page
    await page.locator('button:has-text("New session")').first().click()
    const input = page.locator('[contenteditable="true"]').first()
    await expect(input).toHaveText('')
    await input.click()
    await input.type('Keep the composer available after this message', { delay: 10 })
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-slot="aui_assistant-message-content"]').first()).toContainText(
      'mock inference server',
      { timeout: 60_000 }
    )
    await expect(input).toHaveText('')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    const surface = page.locator('[data-chat-surface]').first()
    const composer = surface.locator('[data-slot="composer-surface"]')
    const userBubble = surface.locator('[data-slot="aui_user-bubble-actions"] button').first()
    const assistantContent = surface.locator('[data-slot="aui_assistant-message-content"]').first()
    const userActionRow = surface.locator('[data-slot="aui_user-actions-row"]').first()

    await expect(surface).toHaveAttribute('data-conversation-layout', '')
    await expect(composer).toBeVisible()
    await expect(userBubble).toBeVisible()
    await expect(assistantContent).toBeVisible()
    await expect(userActionRow).toBeVisible()
    await expect(userActionRow.getByRole('button', { name: 'Copy' })).toBeVisible()
    await expect(userActionRow.getByRole('button', { name: 'Edit message' })).toBeVisible()
    await expect(userActionRow.getByRole('button', { name: 'Restore checkpoint' })).toBeVisible()

    const metrics = await surface.evaluate(node => {
      const composerNode = node.querySelector<HTMLElement>('[data-slot="composer-surface"]')
      const composerBounds = node.querySelector<HTMLElement>('[data-slot="composer-bounds"]')
      const composerDock = node.querySelector<HTMLElement>('[data-slot="composer-dock"]')
      const userMessageRoot = node.querySelector<HTMLElement>('[data-slot="aui_user-message-root"]')
      const userNode = node.querySelector<HTMLElement>('[data-slot="aui_user-bubble-actions"] button')
      const userBubbleNode = node.querySelector<HTMLElement>('[data-slot="aui_user-bubble"]')
      const userActionsNode = node.querySelector<HTMLElement>('[data-slot="aui_user-actions-row"]')
      const assistantNode = node.querySelector<HTMLElement>('[data-slot="aui_assistant-message-content"]')
      const firstAssistantAction = node.querySelector<HTMLElement>('[data-slot="aui_msg-actions"] button')

      if (
        !composerNode ||
        !composerBounds ||
        !composerDock ||
        !userMessageRoot ||
        !userNode ||
        !userBubbleNode ||
        !userActionsNode ||
        !assistantNode ||
        !firstAssistantAction
      ) {
        throw new Error('Conversation layout did not render its composer and message surfaces')
      }

      const surfaceRect = node.getBoundingClientRect()
      const boundsRect = composerBounds.getBoundingClientRect()
      const dockRect = composerDock.getBoundingClientRect()
      const composerRect = composerNode.getBoundingClientRect()
      const userRect = userNode.getBoundingClientRect()
      const userBubbleRect = userBubbleNode.getBoundingClientRect()
      const userActionsRect = userActionsNode.getBoundingClientRect()
      const assistantRect = assistantNode.getBoundingClientRect()

      const actionRect = firstAssistantAction
        .closest('[data-slot="aui_assistant-actions-row"]')!
        .getBoundingClientRect()

      const composerHitTarget = document.elementFromPoint(
        composerRect.left + composerRect.width / 2,
        composerRect.top + composerRect.height / 2
      )

      return {
        actionLeft: actionRect.left,
        assistantLeft: assistantRect.left,
        boundsBottom: boundsRect.bottom,
        composerBottomGap: surfaceRect.bottom - composerRect.bottom,
        composerCenterDelta: Math.abs(
          composerRect.left + composerRect.width / 2 - (surfaceRect.left + surfaceRect.width / 2)
        ),
        composerLeft: composerRect.left,
        composerReceivesPointer: Boolean(composerHitTarget && composerNode.contains(composerHitTarget)),
        composerWidth: composerRect.width,
        dockPosition: getComputedStyle(composerDock).position,
        dockTop: dockRect.top,
        surfaceWidth: surfaceRect.width,
        userMessagePosition: getComputedStyle(userMessageRoot).position,
        userActionsBelowBubble: userActionsRect.top >= userBubbleRect.bottom,
        userActionsRightGap: Math.abs(userActionsRect.right - userBubbleRect.right),
        userRightGap: composerRect.right - userRect.right,
        userWidth: userRect.width
      }
    })

    expect(metrics.composerBottomGap, JSON.stringify(metrics)).toBeGreaterThanOrEqual(0)
    expect(metrics.composerBottomGap, JSON.stringify(metrics)).toBeLessThanOrEqual(32)
    expect(metrics.composerCenterDelta, JSON.stringify(metrics)).toBeLessThanOrEqual(1)
    expect(metrics.composerReceivesPointer, JSON.stringify(metrics)).toBe(true)
    expect(metrics.dockPosition, JSON.stringify(metrics)).toBe('relative')
    expect(Math.abs(metrics.boundsBottom - metrics.dockTop), JSON.stringify(metrics)).toBeLessThanOrEqual(1)
    expect(metrics.composerWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(800)
    expect(metrics.composerWidth, JSON.stringify(metrics)).toBeLessThan(metrics.surfaceWidth - 64)
    expect(metrics.userWidth, JSON.stringify(metrics)).toBeLessThan(metrics.composerWidth * 0.8)
    expect(metrics.userMessagePosition, JSON.stringify(metrics)).toBe('static')
    expect(Math.abs(metrics.userRightGap), JSON.stringify(metrics)).toBeLessThanOrEqual(1)
    expect(metrics.userActionsBelowBubble, JSON.stringify(metrics)).toBe(true)
    expect(metrics.userActionsRightGap, JSON.stringify(metrics)).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.assistantLeft - metrics.composerLeft), JSON.stringify(metrics)).toBeLessThanOrEqual(24)
    expect(Math.abs(metrics.actionLeft - metrics.assistantLeft), JSON.stringify(metrics)).toBeLessThanOrEqual(24)
  })
  test('screenshot of chat with messages', async () => {
    await expectVisualSnapshot(fixture!.page, { name: 'chat-with-messages', app: fixture!.app })
  })

  test('offers stop, steer, and queue actions while busy', async () => {
    const testInfo = test.info()
    const page = fixture!.page
    const composer = page.locator('[contenteditable="true"]').first()
    const primary = page.locator('[data-slot="composer-root"] button[type="submit"]')
    const queue = page.locator('[data-slot="composer-root"] button[aria-label="Queue message"]')
    const dictation = page.locator('[data-slot="composer-root"] button[aria-label="Voice dictation"]')
    const voice = page.locator('[data-slot="composer-root"]').getByRole('button', { name: 'Voice', exact: true })

    await composer.click()
    await composer.type(BLOCKING_CLARIFY_TRIGGER)
    await page.keyboard.press('Enter')
    await page.getByText(BLOCKING_CLARIFY_QUESTION).waitFor({ state: 'visible', timeout: 30_000 })

    await expect(primary).toHaveAttribute('aria-label', 'Stop')

    await composer.click()
    await composer.type('please answer tersely')
    // Since "running is not busy" (3bc52fb9df) the primary keeps the Send
    // affordance mid-turn — steer is routed through the submit engine, not a
    // separate labeled button. Queue remains the explicit secondary action.
    await expect(primary).toHaveAttribute('aria-label', 'Send')
    await expect(dictation).toBeVisible()
    await expect(voice).toBeVisible()
    await expect(queue).toBeVisible()
    await expect(queue.locator('svg.tabler-icon-playlist-add')).toBeVisible()

    const controlLabels = await page
      .locator('[data-slot="composer-root"] button')
      .evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))

    expect(controlLabels.indexOf('Voice dictation')).toBeLessThan(controlLabels.indexOf('Voice'))
    expect(controlLabels.indexOf('Voice')).toBeLessThan(controlLabels.indexOf('Queue message'))
    expect(controlLabels.indexOf('Queue message')).toBeLessThan(controlLabels.indexOf('Send'))
    await voice.click()
    const readReplies = page.getByRole('menuitemcheckbox', { name: 'Read replies aloud', exact: true })
    await expect(readReplies).toHaveAttribute('aria-checked', 'false')
    await readReplies.click()
    const stopReading = page.getByRole('menuitemcheckbox', { name: 'Stop reading replies aloud', exact: true })
    await expect(stopReading).toHaveAttribute('aria-checked', 'true')
    await stopReading.click()
    await expect(readReplies).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(composer).toHaveText('please answer tersely')
    await page.screenshot({ path: testInfo.outputPath('busy-composer-steer.png') })

    await queue.click()
    await expect(primary).toHaveAttribute('aria-label', 'Stop')
    await expect(queue).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('busy-composer-queue.png') })
    await expect(page.getByText('1 Queued')).toBeVisible()

    await primary.click()
    await expect(page.getByText('1 Queued — paused')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('busy-composer-queue-paused.png') })
  })
})
