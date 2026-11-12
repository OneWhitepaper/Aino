/** Actual provider-bound identity and desktop protocol over an isolated native gateway. */
import fs from 'node:fs'
import path from 'node:path'

import { type MockServerOptions, restartMockServer } from '../../../tests-js/scripts/mock-server'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

interface ProviderMessage {
  role: string
  content?: string | Array<{ text?: string }>
}

interface ProviderRequest {
  messages?: ProviderMessage[]
  tools?: unknown[]
}

let fixture: MockBackendFixture | null = null
let providerWitness: ProviderRequest[] = []

function contentText(content: ProviderMessage['content']): string {
  return typeof content === 'string' ? content : (content ?? []).map(block => block.text ?? '').join('')
}

function lastUserText(request: ProviderRequest): string {
  return contentText([...(request.messages ?? [])].reverse().find(message => message.role === 'user')?.content)
}

function systemText(request: ProviderRequest): string {
  return (request.messages ?? [])
    .filter(message => message.role === 'system')
    .map(message => contentText(message.content))
    .join('\n\n')
}

function assertAinoIdentity(request: ProviderRequest) {
  const system = systemText(request)
  expect(system).toContain('You are Aino')
  expect(system).not.toContain('You are Hermes Agent')
  expect(system).not.toContain('inside the Hermes desktop app')
}

function assertDesktopProtocol(request: ProviderRequest) {
  const system = systemText(request)
  expect(system).toContain('inside the Aino desktop app')

  for (const protocol of [
    'MEDIA:/absolute/path',
    '::preview{file="path.html"}',
    'data-hermes-send="prompt"',
    'window.hermes.send("prompt")',
    'var(--foreground)',
    'var(--muted-foreground)',
    'var(--accent)',
    'var(--border)',
    'var(--card)'
  ]) {
    expect(system).toContain(protocol)
  }
}

function assertNonDesktopSurface(request: ProviderRequest, platform: 'bot_room' | 'subagent') {
  const system = systemText(request)
  expect(system).toContain(`Platform: ${platform}`)
  expect(system).not.toContain('inside the Aino desktop app')
  expect(system).not.toContain('data-hermes-send="prompt"')
  expect(system).not.toContain('window.hermes.send("prompt")')
}

async function launch(mockServer: MockServerOptions = {}) {
  restartMockServer()
  providerWitness = []
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig:
      'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true\ngateway:\n  multiplex_profiles: true',
    mockServer: {
      ...mockServer,
      onRequest: request => {
        providerWitness.push(request as ProviderRequest)
        mockServer.onRequest?.(request)
      }
    }
  })
  const { page, app } = fixture
  // Login can render before the gateway supplies its saved display language.
  const phone = page.getByRole('textbox', { name: /^(?:手机号|Phone number)$/ })
  await phone.waitFor({ state: 'visible', timeout: 120_000 })
  await phone.fill('13800000109')
  await page
    .getByRole('checkbox', { name: /^(?:同意用户协议和隐私政策|Agree to the user agreement and privacy policy)$/ })
    .check()
  await page.getByRole('button', { name: /^(?:发送验证码|Send code)$/ }).click()
  await page.getByRole('textbox', { name: /^(?:验证码|Verification code)$/ }).fill('1234')
  await page.getByRole('button', { name: /^(?:登录|Sign in)$/ }).click()
  await waitForAppReady(fixture, 120_000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960))

  return fixture
}

test.afterEach(async () => {
  await test.info().attach('provider-request-witness', {
    body: JSON.stringify(
      providerWitness.map(request => ({
        hasTools: Boolean(request.tools?.length),
        lastUser: lastUserText(request),
        system: systemText(request)
      })),
      null,
      2
    ),
    contentType: 'application/json'
  })
  await fixture?.cleanup()
  fixture = null
  providerWitness = []
})

test('ordinary, Bot, group and real delegated children preserve Aino identity and their surface contracts', async () => {
  test.setTimeout(360_000)
  const testInfo = test.info()
  const requests: ProviderRequest[] = []
  const { page } = await launch({ onRequest: request => requests.push(request as ProviderRequest) })

  const mainRequest = (predicate: (text: string) => boolean) =>
    requests.find(request => request.tools?.length && predicate(lastUserText(request)))

  const ordinary = 'Aino ordinary conversation identity witness'
  const editor = page.locator('[data-slot="composer-rich-input"]:visible')
  await editor.fill(ordinary)
  await editor.press('Enter')
  await expect.poll(() => Boolean(mainRequest(text => text === ordinary)), { timeout: 60_000 }).toBe(true)
  assertAinoIdentity(mainRequest(text => text === ordinary)!)
  assertDesktopProtocol(mainRequest(text => text === ordinary)!)
  await expect(
    page.getByText('Hello from the mock inference server! The full boot chain is working.', { exact: true })
  ).toBeVisible({ timeout: 60_000 })

  const ordinaryGoal = 'Aino ordinary delegated child identity witness'
  await editor.fill(
    `E2E_CALL(delegate_task)[${JSON.stringify({ goal: ordinaryGoal, context: 'Check the delegated identity using local inference only.' })}]`
  )
  await editor.press('Enter')
  const ordinaryChild = () => mainRequest(text => text === ordinaryGoal)
  await expect.poll(() => Boolean(ordinaryChild()), { timeout: 90_000 }).toBe(true)
  assertAinoIdentity(ordinaryChild()!)
  assertNonDesktopSurface(ordinaryChild()!, 'subagent')

  await page.locator('[data-sidebar-mode-header] button').click()
  await page.getByRole('menuitemradio', { name: /^Bot(?:\s|$)/ }).click()
  await expect(page.getByRole('button', { name: /@hermes/ }).first()).toBeVisible({ timeout: 30_000 })
  const botPrompt = 'Aino Bot conversation identity witness'
  await editor.fill(botPrompt)
  await editor.press('Enter')
  await expect.poll(() => Boolean(mainRequest(text => text === botPrompt)), { timeout: 60_000 }).toBe(true)
  assertAinoIdentity(mainRequest(text => text === botPrompt)!)
  assertDesktopProtocol(mainRequest(text => text === botPrompt)!)

  await page.getByRole('button', { name: '新建机器人或群聊', exact: true }).click()
  await page.getByRole('menuitem', { name: /新建机器人/ }).click()
  const bot = page.getByRole('dialog', { name: '新建机器人', exact: true })
  await bot.getByPlaceholder('起个不重复的名字，用来区分不同机器人').fill('identity-reviewer')
  await bot.getByPlaceholder('界面上显示的称呼，不填就用上面的名字').fill('Identity Reviewer')
  await bot.getByRole('button', { name: '创建机器人', exact: true }).click()
  await expect(bot).toBeHidden({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /Identity Reviewer/ }).first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '新建机器人或群聊', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建群聊', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建群聊', exact: true })
  const choices = create.locator('.aino-group-create-member')
  await expect(choices).toHaveCount(2)

  for (const choice of await choices.all()) {
    await choice.getByRole('checkbox').click()
  }

  await create.getByRole('textbox', { name: '群聊名称', exact: true }).fill('Aino 身份验收小组')
  await create.getByRole('button', { name: '新建群聊 (2)', exact: true }).click()
  await expect(create).toBeHidden({ timeout: 30_000 })
  const roomComposer = page.getByRole('textbox', { name: '群组消息', exact: true }).filter({ visible: true })
  await expect(roomComposer).toBeEnabled({ timeout: 30_000 })
  const goal = 'Aino delegated child identity witness'
  const groupPrompt = `@hermes E2E_CALL(delegate_task)[${JSON.stringify({ goal, context: 'Verify the desktop identity without using external services.' })}]`
  await roomComposer.fill(groupPrompt)
  await page.locator('.aino-group-composer').getByRole('button', { name: '发送', exact: true }).click()
  await expect(roomComposer).toHaveValue('')
  const groupRequest = () => mainRequest(text => text.includes('E2E_CALL(delegate_task)') && text.includes(goal))
  const childRequest = () => mainRequest(text => text === goal)
  await expect.poll(() => Boolean(groupRequest()), { timeout: 90_000 }).toBe(true)
  assertAinoIdentity(groupRequest()!)
  assertNonDesktopSurface(groupRequest()!, 'bot_room')
  await expect.poll(() => Boolean(childRequest()), { timeout: 90_000 }).toBe(true)
  assertAinoIdentity(childRequest()!)
  assertNonDesktopSurface(childRequest()!, 'subagent')
  await testInfo.attach('actual-provider-surface-witness', {
    body: JSON.stringify(
      {
        ordinary: {
          lastUser: lastUserText(mainRequest(text => text === ordinary)!),
          system: systemText(mainRequest(text => text === ordinary)!)
        },
        ordinaryChild: { lastUser: lastUserText(ordinaryChild()!), system: systemText(ordinaryChild()!) },
        bot: {
          lastUser: lastUserText(mainRequest(text => text === botPrompt)!),
          system: systemText(mainRequest(text => text === botPrompt)!)
        },
        group: { lastUser: lastUserText(groupRequest()!), system: systemText(groupRequest()!) },
        child: { lastUser: lastUserText(childRequest()!), system: systemText(childRequest()!) }
      },
      null,
      2
    ),
    contentType: 'application/json'
  })
})

test('inline preview keeps theme tokens and both legacy widget send bridges after rebranding', async () => {
  test.setTimeout(240_000)
  const testInfo = test.info()
  let previewPath = ''
  const requests: ProviderRequest[] = []

  const { page, sandbox, mock } = await launch({
    onRequest: request => requests.push(request as ProviderRequest),
    replyForPrompt: prompt =>
      prompt === 'Show the Aino inline preview witness'
        ? `Aino inline preview is ready.\n\n::preview{file="${previewPath}"}`
        : 'Aino widget request received.'
  })

  previewPath = path.join(sandbox.root, 'aino-inline-witness.html')
  const widgetPrompt = 'Aino declarative widget send witness'
  const scriptPrompt = 'Aino script widget send witness'
  fs.writeFileSync(
    previewPath,
    `<!doctype html><html><head><style>
    body{color:var(--foreground);font:inherit;background:transparent}
    button{color:var(--foreground);background:var(--card);border:1px solid var(--border)}
    p{color:var(--muted-foreground)}
  </style></head><body><h2>Aino inline witness</h2><p>Live desktop theme</p>
    <button data-hermes-send="${widgetPrompt}">Send from widget</button>
  </body></html>`,
    'utf8'
  )
  const editor = page.locator('[data-slot="composer-rich-input"]:visible')
  await editor.fill('Show the Aino inline preview witness')
  await editor.press('Enter')
  const frame = page.frameLocator(`iframe[title="${previewPath}"]`)
  await expect(frame.getByRole('heading', { name: 'Aino inline witness', exact: true })).toBeVisible({
    timeout: 60_000
  })

  const aliases: Record<string, string> = {
    '--foreground': '--ui-text-primary',
    '--muted-foreground': '--ui-text-tertiary',
    '--accent': '--ui-accent',
    '--border': '--ui-stroke-tertiary',
    '--card': '--ui-bg-editor'
  }

  const expectedTheme = await page.evaluate(tokens => {
    const root = getComputedStyle(document.documentElement)

    return Object.fromEntries(
      Object.entries(tokens).map(([alias, source]) => [alias, root.getPropertyValue(source).trim()])
    )
  }, aliases)

  const actualTheme = await frame.locator('body').evaluate((_, tokens) => {
    const root = getComputedStyle(document.documentElement)

    return Object.fromEntries(Object.keys(tokens).map(alias => [alias, root.getPropertyValue(alias).trim()]))
  }, aliases)

  expect(actualTheme).toEqual(expectedTheme)
  expect(Object.values(actualTheme).every(Boolean)).toBe(true)
  const draft = 'Keep this unsent desktop draft while the widget sends.'
  await editor.fill(draft)
  const firstSendAt = Date.now()
  await frame.getByRole('button', { name: 'Send from widget', exact: true }).click()
  await expect.poll(() => mock.receivedPrompts.includes(widgetPrompt), { timeout: 60_000 }).toBe(true)
  await expect(editor).toHaveText(draft)
  await expect(page.getByText(widgetPrompt, { exact: true })).toHaveCount(0)
  await expect.poll(() => Date.now(), { timeout: 3000 }).toBeGreaterThanOrEqual(firstSendAt + 1000)

  const ack = await frame.locator('body').evaluate(async (_, prompt) => {
    const bridge = (window as unknown as { hermes: { send: (text: string) => Promise<{ ok: boolean }> } }).hermes

    return bridge.send(prompt)
  }, scriptPrompt)

  expect(ack).toEqual({ ok: true })
  await expect.poll(() => mock.receivedPrompts.includes(scriptPrompt), { timeout: 60_000 }).toBe(true)
  await expect(editor).toHaveText(draft)
  await expect(page.getByText(scriptPrompt, { exact: true })).toHaveCount(0)
  const first = requests.find(request => request.tools?.length)
  expect(first).toBeTruthy()
  assertAinoIdentity(first!)
  assertDesktopProtocol(first!)
  await page.screenshot({ path: testInfo.outputPath('aino-inline-preview-widget.png'), scale: 'css' })
})
