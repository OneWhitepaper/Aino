/**
 * E2E: the Settings-hosted fleet profile rail with two registered gateways.
 *
 * "This device" is the Electron-managed local backend (mock inference). The
 * second gateway, "Homelab", is a REAL second `hermes serve` this spec spawns
 * with its own HERMES_HOME, profiles and session token, registered in the v2
 * connections.json as a remote URL connection. A click on an at-rest square
 * therefore performs the same dial → commit → re-home the statusbar switcher
 * does, against a real backend — not a stub.
 *
 * Prerequisite: `npm run build` must have been run so dist/ exists, and the
 * repo's Python venv (`.venv`) must exist for both backends.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { startMockServer } from '../../../tests-js/scripts/mock-server'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  type Sandbox,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
} from './fixtures'
import {
  REMOTE_ID,
  REMOTE_LABEL,
  type RemoteGateway,
  seedProfiles,
  startRemoteGateway,
  writeConnectionsRegistry
} from './remote-gateway-fixture'
import { type ElectronApplication, expect, type Page, test } from './test'

// FLEET_RAIL_SCREENSHOT_DIR=<dir> saves full-window captures at the key
// states — handy for design review; never part of the assertions.
async function capture(page: Page, name: string): Promise<void> {
  const dir = process.env.FLEET_RAIL_SCREENSHOT_DIR

  if (!dir) {
    return
  }

  fs.mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, `${name}.png`) })
}

// OverlayNav keeps both its wide rail and narrow dropdown mounted so the
// responsive CSS can swap them without remounting the page. Scope assertions
// to the painted rail; the hidden counterpart is not an additional user
// surface.
const rail = (page: Page) => page.locator('[data-slot="profile-rail"]:visible')

const gatewayGroup = (page: Page, id: string) =>
  rail(page).locator(`[data-slot="profile-rail-gateway"][data-connection-id="${id}"]`)

const activeGatewayGroup = (page: Page) => rail(page).locator('[data-slot="profile-rail-gateway"][data-active="true"]')

async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.evaluate(target => {
    window.location.hash = target
  }, route)
  await page.waitForFunction(target => window.location.hash === `#${target}`, route)
}

async function groupOrder(page: Page): Promise<Array<[string, boolean]>> {
  return rail(page)
    .locator('[data-slot="profile-rail-gateway"]')
    .evaluateAll(nodes =>
      nodes.map(
        node =>
          [node.getAttribute('data-connection-id') ?? '', node.getAttribute('data-active') === 'true'] as [
            string,
            boolean
          ]
      )
    )
}

test.describe('fleet profile rail — two registered gateways', () => {
  test.describe.configure({ mode: 'serial' })

  let mock: Awaited<ReturnType<typeof startMockServer>>
  let sandbox: Sandbox
  let remote: RemoteGateway
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    mock = await startMockServer()
    sandbox = createSandbox('fleet')
    writeMockProviderConfig(sandbox.hermesHome, mock.url)
    writeEnvFile(sandbox.hermesHome)
    // A named profile on This device too, so the active group has a square
    // beside its home pill. "research" exists on BOTH gateways on purpose: the
    // rail must keep the two apart by gateway, never by name alone.
    seedProfiles(sandbox.hermesHome, ['research'])

    remote = await startRemoteGateway(sandbox, mock.url, ['inbox', 'research'])
    writeConnectionsRegistry(sandbox, remote.url)

    ;({ app, page } = await launchDesktop(buildAppEnv(sandbox)))
    await waitForAppReady({ app, page } as MockBackendFixture, 120_000)
    // `waitForAppReady` waits for the composer and for all boot overlays to
    // clear. The gateway-health statusbar item was intentionally moved into
    // Settings, so there is no longer a stable `ready` label in the bar to
    // use as a second boot gate.
    await page.waitForTimeout(2_000)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => undefined)
    await remote?.close()
    await mock?.close()
    sandbox?.cleanup()
  })

  test('lays both gateways on one strip, active gateway in its registry slot', async () => {
    // Profile and gateway configuration no longer occupies the chat sidebar.
    // The same live rail belongs to Settings, where its full behavior remains
    // available instead of being duplicated by a second set of controls.
    await gotoRoute(page, '/')
    await expect(rail(page)).toHaveCount(0)
    await gotoRoute(page, '/settings?tab=about')
    const settingsNav = page.locator('[data-settings-workspace] [data-tour="overlay-nav"]')
    await expect(settingsNav).toBeVisible()
    await expect(settingsNav.locator('[data-slot="profile-rail"]')).toBeVisible()
    await expect(activeGatewayGroup(page)).toHaveAttribute('aria-label', 'Profiles on This device', {
      timeout: 60_000
    })

    // The remote gateway's group appears once the roster has enumerated it.
    const homelab = gatewayGroup(page, REMOTE_ID)
    await expect(homelab).toBeVisible({ timeout: 60_000 })
    await expect(homelab.getByRole('button', { name: `default · ${REMOTE_LABEL}` })).toBeVisible()
    await expect(homelab.getByRole('button', { name: `inbox · ${REMOTE_LABEL}` })).toBeVisible()
    await expect(homelab.getByRole('button', { name: `research · ${REMOTE_LABEL}` })).toBeVisible()
    await expect(homelab).toHaveAttribute('data-reachable', 'true')

    // Its marker carries the remote (network) glyph.
    await expect(
      rail(page).locator(
        `[data-slot="profile-rail-divider"][data-connection-id="${REMOTE_ID}"] [data-connection-kind="remote"]`
      )
    ).toBeVisible()

    // This device is the active group: its squares are unqualified, as before.
    const local = gatewayGroup(page, 'local')
    await expect(local).toHaveAttribute('data-active', 'true')
    await expect(local.getByRole('button', { name: 'research', exact: true })).toBeVisible()

    // Registry order: This device first, Homelab second.
    expect(await groupOrder(page)).toEqual([
      ['local', true],
      [REMOTE_ID, false]
    ])

    // Fleet pill replaces the default↔all toggle; the single-gateway plug is gone.
    await expect(rail(page).getByRole('button', { name: 'All profiles on this gateway' })).toBeVisible()
    await expect(rail(page).getByRole('button', { name: 'Manage gateways…' })).toHaveCount(0)

    await gatewayGroup(page, REMOTE_ID)
      .getByRole('button', { name: `inbox · ${REMOTE_LABEL}` })
      .hover()
    await capture(page, '1-on-this-device-hover-inbox-homelab')
  })

  test('clicking an at-rest square re-homes onto that exact gateway and profile', async () => {
    test.setTimeout(180_000)
    await gatewayGroup(page, REMOTE_ID)
      .getByRole('button', { name: `inbox · ${REMOTE_LABEL}` })
      .click()

    // A source switch intentionally starts a fresh chat, so the route leaves
    // Settings. Confirm the active source through the statusbar switcher,
    // then return to Settings to inspect the rail there.
    await expect(page.locator('[data-slot="connection-switcher"]')).toContainText(REMOTE_LABEL, {
      timeout: 120_000
    })
    await gotoRoute(page, '/settings?tab=about')
    await expect(rail(page)).toHaveCount(1)
    await expect(activeGatewayGroup(page)).toHaveAttribute('aria-label', `Profiles on ${REMOTE_LABEL}`, {
      timeout: 60_000
    })

    // …Homelab's group is now the active one, on the clicked profile…
    const homelab = gatewayGroup(page, REMOTE_ID)
    await expect(homelab).toHaveAttribute('data-active', 'true', { timeout: 30_000 })
    await expect(homelab.getByRole('button', { name: 'inbox', exact: true })).toHaveAttribute('aria-pressed', 'true', {
      timeout: 30_000
    })

    // …This device is at rest with qualified squares…
    const local = gatewayGroup(page, 'local')
    await expect(local).toHaveAttribute('data-active', 'false')
    await expect(local.getByRole('button', { name: 'research · This device' })).toBeVisible()

    // …and nothing moved: the order is still This device, then Homelab.
    expect(await groupOrder(page)).toEqual([
      ['local', false],
      [REMOTE_ID, true]
    ])

    await capture(page, '2-re-homed-on-homelab-inbox')
  })

  test('editing SOUL.md on an at-rest square reads the owning gateway, not the foreground one', async () => {
    const square = gatewayGroup(page, 'local').getByRole('button', { name: 'research · This device' })
    await square.click({ button: 'right' })
    await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Edit SOUL.md…' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('research · This device · SOUL.md')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('switching back lands on the clicked profile of This device and keeps the order', async () => {
    test.setTimeout(180_000)
    await gatewayGroup(page, 'local').getByRole('button', { name: 'research · This device' }).click()

    await expect(page.locator('[data-slot="connection-switcher"]')).toContainText('This device', { timeout: 120_000 })
    await gotoRoute(page, '/settings?tab=about')
    await expect(rail(page)).toHaveCount(1)
    await expect(activeGatewayGroup(page)).toHaveAttribute('aria-label', 'Profiles on This device', {
      timeout: 60_000
    })
    const local = gatewayGroup(page, 'local')
    await expect(local).toHaveAttribute('data-active', 'true', { timeout: 30_000 })
    await expect(local.getByRole('button', { name: 'research', exact: true })).toHaveAttribute('aria-pressed', 'true', {
      timeout: 30_000
    })
    await expect(gatewayGroup(page, REMOTE_ID).getByRole('button', { name: `inbox · ${REMOTE_LABEL}` })).toBeVisible()

    expect(await groupOrder(page)).toEqual([
      ['local', true],
      [REMOTE_ID, false]
    ])
  })
})
