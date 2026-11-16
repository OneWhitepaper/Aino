import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { bundledUpgradeHealth } from '../../../tests-js/scripts/bundled-upgrade-probe.ts'
import { type ChatIdentity, readChatIdentity } from '../../../tests-js/scripts/desktop-chat-smoke.ts'
import { type ElectronApplication, type Page, z } from '../../../tests-js/scripts/e2e-driver-deps.ts'
import { MOCK_REPLY } from '../../../tests-js/scripts/mock-server.ts'
import { readFixturePlatformSession } from '../../../tests-js/scripts/platform-account-fixture.ts'

import { runInstalledDesktopSmoke } from './desktop-smoke.ts'
import { within } from './smoke-env.mjs'

const LEGACY_COMMIT = '22a472fcbca8775f56c0f89374027b8e4c68ab5b'
const PURPOSE = 'aino-released-zip-history'
const messageSchema = z.object({ id: z.union([z.number().int().positive(), z.string().min(1)]), role: z.string(), content: z.string() })
const storedChatSchema = z.object({ profile: z.literal('default'), sessionId: z.string().min(1), messages: z.array(messageSchema).length(2) })

const ownerSchema = z.object({ pid: z.number().int().positive(), startTime: z.number(), instanceId: z.string().min(1),
  home: z.string(), commit: z.string().regex(/^[0-9a-f]{40}$/), executable: z.string() }).passthrough()

const workspaceSchema = z.object({ userData: z.string(), hermesHome: z.string(), owner: ownerSchema })

const legacySchema = workspaceSchema.extend({ purpose: z.literal(PURPOSE), status: z.literal('passed'),
  release: z.literal('v0.1.5'), legacyCommit: z.literal(LEGACY_COMMIT), storedChat: storedChatSchema })

type WorkspaceProof = z.infer<typeof workspaceSchema>
type StoredChat = z.infer<typeof storedChatSchema>
type ApiReader = (route: string) => Promise<unknown>

/** Resolve the actual OLD turn through the same history API used by the desktop. */
export async function findPersistedChat(api: ApiReader, prompt: string, reply: string): Promise<StoredChat> {
  const search = z.object({ results: z.array(z.object({ session_id: z.string() })) }).parse(
    await api(`/api/sessions/search?q=${encodeURIComponent(JSON.stringify(prompt))}&profile=default`))

  const sessions = [...new Set(search.results.map(row => row.session_id))]

  if (sessions.length !== 1) { throw new Error('ZIP prompt did not resolve exactly one durable session') }

  const history = z.object({ session_id: z.literal(sessions[0]), messages: z.array(messageSchema) }).parse(
    await api(`/api/sessions/${encodeURIComponent(sessions[0])}/messages`))

  const userIndex = history.messages.findIndex(row => row.role === 'user' && row.content === prompt)
  const user = history.messages[userIndex]
  const assistant = history.messages.slice(userIndex + 1).find(row => row.role === 'assistant' && row.content.includes(reply))

  if (userIndex < 0 || !assistant) { throw new Error('Completed ZIP chat has no matching durable user and assistant rows') }

  return { profile: 'default', sessionId: sessions[0], messages: [user, assistant] }
}

/** The app must rotate its inherited ZIP owner itself, using the original account. */
export function assertNaturalZipMigration(legacy: WorkspaceProof, current: WorkspaceProof,
  expected: { commit: string; payloadRoot: string }): void {
  if (current.userData !== legacy.userData || current.hermesHome !== legacy.hermesHome
      || current.owner.home !== legacy.owner.home || current.owner.home !== current.hermesHome) {
    throw new Error('ZIP migration changed the actual data roots')
  }

  if (legacy.owner.commit === expected.commit || current.owner.commit !== expected.commit) {
    throw new Error('ZIP migration did not replace legacy code with current code')
  }

  if (current.owner.instanceId === legacy.owner.instanceId
      || current.owner.pid === legacy.owner.pid && current.owner.startTime === legacy.owner.startTime) {
    throw new Error('ZIP migration retained the legacy gateway owner')
  }

  if (!within(expected.payloadRoot, current.owner.executable)) {
    throw new Error('Migrated gateway executable is outside the candidate payload')
  }
}

function pageApi(page: Page): ApiReader {
  return route => page.evaluate(async requestPath => {
    const bridge = (window as unknown as { hermesDesktop: {
      api: (request: unknown) => Promise<unknown>
    } }).hermesDesktop

    return bridge.api({ path: requestPath, profile: 'default', connectionId: 'local', method: 'GET', timeoutMs: 60_000 })
  }, route)
}

async function verifyStoredChat(page: Page, chat: StoredChat): Promise<void> {
  const history = z.object({ session_id: z.literal(chat.sessionId), messages: z.array(messageSchema) }).parse(
    await pageApi(page)(`/api/sessions/${encodeURIComponent(chat.sessionId)}/messages`))

  if (chat.messages.some(expected => !history.messages.some(actual => actual.id === expected.id
      && actual.role === expected.role && actual.content === expected.content))) {
    throw new Error('ZIP-written history is missing or changed in the MSIX account')
  }
}

async function workspaceProof(app: ElectronApplication, page: Page, options: MigrationOptions) {
  const identity = await readChatIdentity(page)

  if (!identity.hermesHome) { throw new Error('Migration desktop did not report its actual account data root') }
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))

  const connection = await page.evaluate(async () => {
    const descriptor = await (window as unknown as { hermesDesktop: {
      getConnection: () => Promise<{ baseUrl: string; mode?: string }>
    } }).hermesDesktop.getConnection()

    return { baseUrl: descriptor.baseUrl, mode: descriptor.mode }
  })

  const owner = ownerSchema.parse(bundledUpgradeHealth({ root: options.root, home: identity.hermesHome,
    commit: options['expect-commit'], connection, identity }))

  const platformSession = await readFixturePlatformSession(page)
  return { userData: fs.realpathSync(userData), hermesHome: fs.realpathSync(identity.hermesHome), owner, identity, connection, platformSession }
}

const absolutePath = z.string().refine(path.isAbsolute, 'An absolute path is required')

const migrationOptionsSchema = z.object({ mode: z.enum(['legacy', 'current']), exe: absolutePath, root: absolutePath,
  home: absolutePath, 'user-data': absolutePath, out: absolutePath, 'mock-url': z.string(),
  'expect-commit': z.string().regex(/^[0-9a-f]{40}$/), 'legacy-proof': absolutePath.optional() })

type MigrationOptions = z.infer<typeof migrationOptionsSchema>

export async function runReleasedZipMigration(options: MigrationOptions): Promise<void> {
  const legacy = options.mode === 'current'
    ? legacySchema.parse(JSON.parse(fs.readFileSync(options['legacy-proof']!, 'utf8').replace(/^\uFEFF/, ''))) : null

  if (options.mode === 'legacy' && options['expect-commit'] !== LEGACY_COMMIT) { throw new Error('Legacy smoke must use the pinned v0.1.5 commit') }
  let observed: Awaited<ReturnType<typeof workspaceProof>> | undefined
  let storedChat: StoredChat | undefined
  const phase = options.mode === 'legacy' ? 'old' : 'new'
  await runInstalledDesktopSmoke({ ...options, origin: 'bundled', phase, 'platform-account': true, 'keep-signed-in': true,
    'require-existing-account': !!legacy },
    undefined, async (app, page) => {
      observed = await workspaceProof(app, page, options)

      if (legacy) {
        await verifyStoredChat(page, legacy.storedChat)
        assertNaturalZipMigration(legacy, observed, { commit: options['expect-commit'], payloadRoot: options.root })
        storedChat = legacy.storedChat
      } else {
        const chat = z.object({ prompt: z.string() }).parse(JSON.parse(fs.readFileSync(path.join(options.out, 'desktop-chat-old.json'), 'utf8')))
        storedChat = await findPersistedChat(pageApi(page), chat.prompt, MOCK_REPLY)
      }

      return { ...observed, storedChat }
    })

  if (!observed || !storedChat) { throw new Error('Migration smoke produced no account/history observation') }
  const account = z.object({ account: z.object({ authenticatedProfileRequests: z.number().int().positive(),
    existingSessionRequired: z.boolean(), requests: z.array(z.object({ method: z.string(), path: z.string() })) }) }).parse(
    JSON.parse(fs.readFileSync(path.join(options.out, `desktop-chat-${phase}.json`), 'utf8'))).account
  if (legacy && (!account.existingSessionRequired || account.requests.some(request =>
    request.method === 'POST' && request.path.startsWith('/api/v1/auth/') && request.path !== '/api/v1/auth/refresh'))) {
    throw new Error('First MSIX authenticated by a new login instead of its persisted ZIP session')
  }

  // runInstalledDesktopSmoke closed only Electron. Observe the exact remaining
  // owner before the harness installs anything; never stop it to manufacture a pass.
  const surviving = ownerSchema.parse(bundledUpgradeHealth({ root: options.root, home: observed.hermesHome,
    commit: options['expect-commit'], identity: observed.identity as ChatIdentity, connection: observed.connection }))

  if (surviving.instanceId !== observed.owner.instanceId || surviving.pid !== observed.owner.pid
      || surviving.startTime !== observed.owner.startTime) { throw new Error('Closing the desktop unexpectedly changed its canonical gateway owner') }

  const receipt = { purpose: PURPOSE, status: 'passed', release: 'v0.1.5', legacyCommit: LEGACY_COMMIT,
    ...observed, storedChat, appExitedGatewaySurvived: true, tested: true,
    currentCodeSha: surviving.commit, legacyCodeSha: legacy?.owner.commit ?? observed.owner.commit, legacyOwner: legacy?.owner,
    manualFirstMsixInstall: options.mode === 'current', sameUserData: true, oldWrittenHistoryPreserved: !!legacy,
    authenticationPreservedWithoutLogin: !!legacy, authenticatedProfileRequests: account.authenticatedProfileRequests }

  fs.writeFileSync(path.join(options.out, options.mode === 'legacy' ? 'released-zip-opened.json' : 'released-zip-migration.json'), JSON.stringify(receipt, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: Object.fromEntries(['mode', 'exe', 'root', 'home', 'user-data', 'out',
    'mock-url', 'expect-commit', 'legacy-proof'].map(name => [name, { type: 'string' as const }])) })

  runReleasedZipMigration(migrationOptionsSchema.parse(values)).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
