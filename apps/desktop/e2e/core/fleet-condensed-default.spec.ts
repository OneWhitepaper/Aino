/**
 * Every gateway's default profile stays reachable beside a large named roster
 * (#106017, #131632). Aino's Bot management replaces the old condensed rail:
 * selecting a card previews it; explicit Open Bot Chat enters its captured
 * source without changing the ordinary workspace's gateway (DESIGN.md).
 *
 * Real app, real local backend, real second `hermes serve` registered as a
 * remote connection. Check both default doors before and after local → remote
 * → local chat switches, including the real socket and persisted owner.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import {
  coreAppEnv,
  createCoreSandbox,
  launchCoreApp,
  recordWebSockets,
  send,
  storedSessionForMarker,
  waitForInteractive,
  writeProviderHome
} from './harness'
import { startScriptedProvider } from './provider'
import { messageRows, sessionRows, startRemoteBackend } from './remote-helpers'

const REMOTE_ID = 'linuxhost'
const REMOTE_LABEL = 'Linux host'
// Keep the roster that exceeded the former condensed threshold (13).
const LOCAL_NAMED = Array.from({ length: 12 }, (_, i) => `local${i + 1}`)
const REMOTE_NAMED = ['inbox', 'research']

function seedProfiles(hermesHome: string, names: string[]): void {
  for (const name of names) {
    fs.mkdirSync(path.join(hermesHome, 'profiles', name), { recursive: true })
    fs.writeFileSync(path.join(hermesHome, 'profiles', name, 'config.yaml'), '')
  }
}

function writeConnectionsRegistry(userDataDir: string, url: string, token: string): void {
  fs.writeFileSync(
    path.join(userDataDir, 'connections.json'),
    JSON.stringify({
      version: 2,
      primary: 'local',
      launchMode: 'primary',
      lastUsed: 'local',
      connections: [
        { id: 'local', kind: 'local', label: 'This device' },
        {
          id: REMOTE_ID,
          kind: 'remote',
          label: REMOTE_LABEL,
          url,
          authMode: 'token',
          token: { encoding: 'plain', value: token }
        }
      ]
    }),
    { encoding: 'utf8', mode: 0o600 }
  )
}

const manager = (page: Page) => page.getByRole('region', { name: 'Bot management', exact: true })

function defaultDoor(page: Page, source: string) {
  return manager(page)
    .getByRole('region', { name: 'Main assistant', exact: true })
    .getByRole('button', { name: new RegExp(` · ${source}$`) })
}

async function expectDefaultDoors(page: Page) {
  await page
    .getByRole('navigation', { name: 'Switch conversation mode' })
    .getByRole('button', { name: 'Manage Bots', exact: true })
    .click()
  await expect(manager(page)).toBeVisible()
  await expect(defaultDoor(page, 'This device'), 'the local default has a door').toBeVisible()
  await expect(defaultDoor(page, REMOTE_LABEL), 'the remote default has a door').toBeVisible({ timeout: 90_000 })
  await expect(
    manager(page).getByRole('region', { name: 'Main assistant', exact: true }).getByRole('button')
  ).toHaveCount(2)
  await expect(manager(page).getByRole('region', { name: 'Bots only', exact: true }).getByRole('button')).toHaveCount(
    LOCAL_NAMED.length + REMOTE_NAMED.length
  )
  await expect(manager(page).getByRole('button', { name: 'Local1 · This device', exact: true })).toBeVisible()
  await expect(manager(page).getByRole('button', { name: `Inbox · ${REMOTE_LABEL}`, exact: true })).toBeVisible()
}

async function openDefaultChat(page: Page, source: string) {
  const door = defaultDoor(page, source)
  const label = await door.getAttribute('aria-label')
  await door.click()
  await expect(door).toHaveAttribute('aria-pressed', 'true')
  const details = manager(page).getByRole('complementary', { name: label!, exact: true })
  await expect(details).toBeVisible()
  await details.getByRole('button', { name: 'Open Bot Chat', exact: true }).click()
  await expect(manager(page)).not.toBeVisible()
}

function viewport(page: Page) {
  return page.locator('[data-slot="aui_thread-viewport"]').filter({ visible: true }).first()
}

function botChat(page: Page) {
  return page.locator('[data-chat-surface][data-bot-chat]').filter({ visible: true })
}

interface PromptAttempt {
  params: Record<string, unknown>
  reply?: { result?: unknown; error?: { code?: number; message?: string } }
}

function recordPromptReplies(page: Page): PromptAttempt[] {
  const attempts: PromptAttempt[] = []

  page.on('websocket', socket => {
    const pending = new Map<string, PromptAttempt>()
    socket.on('framesent', frame => {
      try {
        const msg = JSON.parse(String(frame.payload))

        if (msg?.method === 'prompt.submit') {
          const attempt = { params: msg.params }
          attempts.push(attempt)
          pending.set(String(msg.id), attempt)
        }
      } catch {
        /* non-JSON */
      }
    })
    socket.on('framereceived', frame => {
      try {
        const msg = JSON.parse(String(frame.payload))
        const attempt = msg?.id !== undefined ? pending.get(String(msg.id)) : undefined

        if (attempt) {
          attempt.reply = { result: msg.result, error: msg.error }
          pending.delete(String(msg.id))
        }
      } catch {
        /* non-JSON */
      }
    })
  })

  return attempts
}

test('Bot management keeps both gateway defaults reachable across chat switches (#131632)', async () => {
  test.setTimeout(240_000)
  const provider = await startScriptedProvider()
  const clientBox = createCoreSandbox('fleet-default-client')
  const remoteBox = createCoreSandbox('fleet-default-remote')
  writeProviderHome(clientBox.hermesHome, provider.url)
  writeProviderHome(remoteBox.hermesHome, provider.url)
  seedProfiles(clientBox.hermesHome, LOCAL_NAMED)
  seedProfiles(remoteBox.hermesHome, REMOTE_NAMED)
  const remote = await startRemoteBackend(remoteBox)
  writeConnectionsRegistry(clientBox.userDataDir, remote.url, remote.token)

  const { app, page } = await launchCoreApp(coreAppEnv(clientBox))
  const ws = recordWebSockets(page)
  const promptAttempts = recordPromptReplies(page)

  const checkTurn = async (owner: typeof clientBox, other: typeof clientBox, n: number, port?: number) => {
    const marker = `U${n}-fleet`
    const answer = `A${n}-fleet owned default reply`
    provider.script(marker, [{ text: [answer] }])
    await send(page, `${marker} which default owns this chat?`, 'Enter', ws)
    await expect(viewport(page)).toContainText(answer)
    await expect.poll(() => provider.completions.some(row => row.marker === marker && row.finished)).toBe(true)
    await expect.poll(() => storedSessionForMarker(owner, 'default', marker)).not.toBeNull()
    const id = storedSessionForMarker(owner, 'default', marker)!
    // Bot chats own tiles; the ordinary Sessions URL deliberately stays unchanged.
    await expect(botChat(page)).toHaveCount(1)
    await expect(botChat(page)).toHaveAttribute('data-stored-session-id', id)
    expect(sessionRows(owner).find(row => row.id === id)?.title, 'the owner default canonical chat').toBe('Bot Chat')
    expect(storedSessionForMarker(other, 'default', marker), 'the other gateway did not run this turn').toBeNull()
    expect(
      messageRows(owner, id).filter(row => row.role === 'user' && row.content.includes(marker)),
      'exactly one persisted user turn'
    ).toHaveLength(1)
    expect(provider.completions.filter(row => row.marker === marker && row.finished)).toHaveLength(1)
    await expect
      .poll(() => ws.events.filter(event => event.type === 'message.complete' && event.payload?.text === answer))
      .toHaveLength(1)

    const submits = ws.sent.filter(
      frame => frame.method === 'prompt.submit' && String(frame.params?.text).includes(marker)
    )

    expect(submits.length).toBeGreaterThan(0)
    const attempts = promptAttempts.filter(attempt => String(attempt.params.text).includes(marker))
    await expect.poll(() => attempts.every(attempt => attempt.reply)).toBe(true)
    await test.info().attach(`prompt-admission-${n}.json`, {
      body: JSON.stringify(attempts, null, 2),
      contentType: 'application/json'
    })
    expect(attempts).toHaveLength(submits.length)
    const accepted = attempts.filter(attempt => !attempt.reply!.error)
    const refused = attempts.filter(attempt => attempt.reply!.error)
    expect(accepted, 'exactly one successful prompt admission').toHaveLength(1)
    expect(accepted[0]!.reply!.result).toBeTruthy()
    expect(refused.length, 'at most one explicit pre-admission compatibility refusal').toBeLessThanOrEqual(1)

    for (const refusal of refused) {
      const error = refusal.reply!.error!
      expect(refusal.params.submission_id).toEqual(expect.any(String))
      expect(error.code === 4094 || (error.code === 4000 && /submission_id/.test(error.message ?? ''))).toBe(true)
      expect(accepted[0]!.params).not.toHaveProperty('submission_id')
    }

    // Legacy serve rejects submission_id before admission and retries identityless.
    // Count the committed turn above; every attempt must still use the same owner.
    expect(new Set(submits.map(frame => frame.socket)).size, 'one captured owner socket').toBe(1)

    for (const submit of submits) {
      const socket = new URL(ws.sockets[submit.socket]!.url)
      expect(socket.searchParams.get('profile') || 'default', 'the default profile socket').toBe('default')

      if (port) {
        expect(socket.port, 'the remote default owns the sending socket').toBe(String(port))
      } else {
        expect(socket.port, 'the local default has its own socket').not.toBe(String(remote.port))
      }
    }

    return id
  }

  try {
    await waitForInteractive(app, page)

    let localChat = ''

    await test.step('the local default opens beside the at-rest remote default', async () => {
      await expectDefaultDoors(page)
      await openDefaultChat(page, 'This device')
      localChat = await checkTurn(clientBox, remoteBox, 1)
    })

    await test.step(`open ${REMOTE_LABEL}'s default with This device still reachable`, async () => {
      await expectDefaultDoors(page)
      await openDefaultChat(page, REMOTE_LABEL)
      const remoteChat = await checkTurn(remoteBox, clientBox, 2, remote.port)
      expect(remoteChat, 'different source defaults have different canonical chats').not.toBe(localChat)
    })

    await test.step('return to the same local default chat from the remote chat', async () => {
      await expectDefaultDoors(page)
      await openDefaultChat(page, 'This device')
      await expect(botChat(page)).toHaveAttribute('data-stored-session-id', localChat)
      await expect(viewport(page)).toContainText('A1-fleet owned default reply')
      await expect(viewport(page)).not.toContainText('A2-fleet owned default reply')
      expect(await checkTurn(clientBox, remoteBox, 3)).toBe(localChat)
      await expectDefaultDoors(page)
    })
  } finally {
    await app.close().catch(() => undefined)
    await remote.kill()
    await provider.close()
    clientBox.cleanup()
    remoteBox.cleanup()
  }
})
