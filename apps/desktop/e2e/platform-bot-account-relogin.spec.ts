/** A staged managed selection survives real native logout and same-account login. */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { buildAppEnv, createSandbox, waitForAppReady } from './fixtures'
import { activeAccountSandbox, fixtureAccountTemplate, seedFixtureMetadata } from './platform-account-home'
import { nativeBindingObservations, replaceAccountWindow } from './platform-account-window'
import {
  fixtureEnvironment,
  guardedPlatformPython,
  installLoopbackNodeGuard,
  installLoopbackPythonGuard,
  launchGuardedDesktop,
  type NativeState,
  startRealPlatformAPI
} from './platform-real-api'
import { stopFixtureGateway } from './platform-workspace-proof'
import { collectErrorBanners, expect, type Page, test } from './test'

interface AccountWindow {
  hermesDesktop: {
    platformAccount: { status(): Promise<{ phase: string; revision: number; account: { id: string } | null }> }
    platformModels: { owner(revision: number): Promise<{ user_id: string; platform_origin: string }> }
    api<T>(request: { path: string; method?: string }): Promise<T>
  }
}

interface StagedSession {
  id: string
  message_count: number
  model_config: string
}

function canonical(home: string): StagedSession | undefined {
  const file = path.join(home, 'state.db')

  if (!fs.existsSync(file)) {
    return undefined
  }

  const db = new DatabaseSync(file, { readOnly: true })

  try {
    return db.prepare("SELECT id, message_count, model_config FROM sessions WHERE title = 'Bot Chat'").get() as
      StagedSession | undefined
  } finally {
    db.close()
  }
}

async function botMode(page: Page) {
  await page.locator('[data-sidebar-mode-header] button').click()
  await page.getByRole('menuitemradio', { name: /^Bot(?:\s|$)/ }).click()
  await expect(page.locator('[data-sidebar-mode-header]')).toContainText('Bot')
}

async function accountSnapshot(page: Page) {
  return page.evaluate(async () => {
    const bridge = (window as unknown as AccountWindow).hermesDesktop
    const snapshot = await bridge.platformAccount.status()

    return {
      phase: snapshot.phase,
      revision: snapshot.revision,
      owner: await bridge.platformModels.owner(snapshot.revision)
    }
  })
}

const STAGE_MANAGED_SELECTION = `import asyncio, json, os, sqlite3, sys, uuid
from pathlib import Path
from hermes_cli.gateway_runtime import discover_gateway_endpoint
from hermes_cli.gateway_client import _session_ticket, gateway_ws_target
from websockets.asyncio.client import connect
async def main():
    home=Path(os.environ['HERMES_HOME'])
    discovery=discover_gateway_endpoint(home)
    if discovery.state != 'ready' or discovery.endpoint is None:
        raise RuntimeError('isolated fixture gateway not ready')
    ticket=_session_ticket(home,discovery.endpoint,scope='host')
    url,protocols=gateway_ws_target(discovery.endpoint,ticket)
    with sqlite3.connect((home/'state.db').as_uri()+'?mode=ro',uri=True) as db:
        revision,generation=db.execute('SELECT runtime_revision,runtime_generation FROM sessions WHERE id=?',
                                       (sys.argv[1],)).fetchone()
    async with connect(url,subprotocols=protocols,proxy=None,open_timeout=5) as ws:
        for rid,method,params in [
            (1,'session.mutate',{'session_id':sys.argv[1],'request_id':str(uuid.uuid4()),
                                'expected_revision':revision,'expected_generation':generation,
                                'operation':'model','payload':{'model':'g9-glm-5.3-flash','model_source':'aino'}}),
            (2,'model.options',{'session_id':sys.argv[1],'profile':'default',
                                'explicit_only':True,'include_session_info':True})]:
            await ws.send(json.dumps({'jsonrpc':'2.0','id':rid,'method':method,'params':params}))
            while True:
                row=json.loads(await asyncio.wait_for(ws.recv(),30))
                if row.get('id') != rid: continue
                if row.get('error'): raise RuntimeError(row['error'].get('message','RPC failed'))
                if rid==2:
                    info=row['result']['session_info']
                    print(json.dumps({key:info[key] for key in
                        ('model_source','model_id','model_status','platform_owner') if key in info}))
                break
asyncio.run(main())
`

test('same-account relogin recovers an empty staged Bot model without marking it as foreign history', async ({
  browserName: _browserName
}, info) => {
  test.setTimeout(300_000)
  const sandbox = createSandbox('platform-bot-account-relogin')

  const api = await startRealPlatformAPI(path.resolve(import.meta.dirname, '../../../../Aino-API'), {
    selectableWithoutDefault: true
  })

  let launched: Awaited<ReturnType<typeof launchGuardedDesktop>> | null = null
  let accountSandbox = sandbox
  let stage = 'setup'
  const proof: Record<string, unknown> = {}

  try {
    const template = fixtureAccountTemplate(sandbox)
    fs.mkdirSync(template, { mode: 0o700 })
    fs.writeFileSync(
      path.join(template, 'config.yaml'),
      'updates:\n  check: false\nonboarding:\n  run: false\napprovals:\n  mode: off\ndisplay:\n  language: en\nauxiliary:\n  title_generation:\n    enabled: false\n'
    )
    fs.writeFileSync(path.join(template, '.env'), '')
    seedFixtureMetadata(template)
    fs.writeFileSync(
      path.join(sandbox.userDataDir, 'platform-development.json'),
      JSON.stringify({ enabled: true, origin: api.info.origin })
    )
    const python = process.env.HERMES_DESKTOP_PYTHON!
    const pythonGuard = installLoopbackPythonGuard(sandbox.root)

    const env = {
      ...fixtureEnvironment(),
      ...buildAppEnv(sandbox),
      AINO_E2E_ACCOUNT_TEMPLATE: template,
      HERMES_DESKTOP_CDP_PORT: 'off',
      HERMES_DESKTOP_ISOLATED_BACKEND: '0',
      HERMES_DESKTOP_PYTHON: guardedPlatformPython(sandbox.root, pythonGuard, python),
      HERMES_DESKTOP_CWD: path.dirname(api.info.fixture_path)
    }

    launched = await launchGuardedDesktop(env, installLoopbackNodeGuard(sandbox.root))

    const login = async (previousCodeAt = 0) => {
      let page = launched!.page
      await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible({ timeout: 60_000 })
      await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill(api.info.phone)
      const remaining = 61_000 - (Date.now() - previousCodeAt)

      if (remaining > 0 && previousCodeAt > 0) {
        await page.waitForTimeout(Math.min(remaining, 60_000))
      }

      await page.getByRole('button', { name: 'Send code', exact: true }).click()
      await expect(page.getByRole('textbox', { name: 'Verification code', exact: true })).toBeVisible()
      await page
        .getByRole('textbox', { name: 'Verification code', exact: true })
        .fill((await api.control<{ code: string }>('code')).code)
      const codeAt = Date.now()
      page = await replaceAccountWindow(launched!, current =>
        current.getByRole('button', { name: 'Sign in', exact: true }).click()
      )
      await expect(page.locator('[data-sidebar-mode-header]')).toBeVisible({ timeout: 60_000 })
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              try {
                await (window as unknown as AccountWindow).hermesDesktop.api({ path: '/api/profiles' })

                return true
              } catch {
                return false
              }
            }),
          { timeout: 120_000 }
        )
        .toBe(true)

      return { page, codeAt }
    }

    stage = 'first-login'
    const first = await login()
    let page = first.page
    await waitForAppReady(launched as never, 120_000)
    accountSandbox = await activeAccountSandbox(sandbox, launched)
    const before = await accountSnapshot(page)
    const firstWindow = await launched.app.browserWindow(page)
    const partition = await firstWindow.evaluate(window => window.webContents.session.getStoragePath())
    await page.evaluate(() => localStorage.setItem('aino-bot-relogin-marker', 'original-account'))
    await botMode(page)
    await expect.poll(() => canonical(accountSandbox.hermesHome)).toBeTruthy()
    const sid = canonical(accountSandbox.hermesHome)!.id
    const surface = () => page.locator(`[data-chat-surface][data-session-anchor="session-tile:${sid}"]:visible`)
    await expect(surface().getByRole('button', { name: 'Open model picker', exact: true })).toHaveText('Choose model')
    const draft = `Read ${api.info.fixture_path} and verify it after relogin.`
    await surface().locator('[data-slot="composer-rich-input"]').fill(draft)
    await expect(surface().locator('[data-slot="composer-rich-input"]')).toHaveText(draft)

    stage = 'true-rpc-stage-before-binding'

    const stagedInfo = JSON.parse(
      execFileSync(python, ['-c', STAGE_MANAGED_SELECTION, sid], {
        cwd: path.resolve(import.meta.dirname, '../../..'),
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...fixtureEnvironment(), HOME: sandbox.root, HERMES_HOME: accountSandbox.hermesHome }
      })
    )

    expect(stagedInfo).toMatchObject({
      model_source: 'aino',
      model_id: 'g9-glm-5.3-flash',
      model_status: 'awaiting_managed_credentials'
    })
    expect(stagedInfo.platform_owner).toBeUndefined()
    const durable = canonical(accountSandbox.hermesHome)!
    expect(durable.message_count).toBe(0)
    expect(JSON.parse(durable.model_config)).toMatchObject({ model_source: 'aino', model_id: 'g9-glm-5.3-flash' })
    expect(JSON.parse(durable.model_config).platform_owner).toBeUndefined()
    expect((await api.control<NativeState>('state')).model_calls).toBe(0)
    Object.assign(proof, { staged_info: stagedInfo, staged_messages: durable.message_count, canonical_session: sid })

    stage = 'native-logout'
    await page.getByRole('button', { name: /^My account/ }).click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    page = await replaceAccountWindow(launched, current =>
      current
        .getByRole('dialog', { name: 'Sign out', exact: true })
        .getByRole('button', { name: 'Sign out', exact: true })
        .click()
    )

    stage = 'same-account-relogin'
    const second = await login(first.codeAt)
    page = second.page
    const restoredHome = await activeAccountSandbox(sandbox, launched)
    const after = await accountSnapshot(page)
    expect(after.owner).toEqual(before.owner)
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(restoredHome.hermesHome).toBe(accountSandbox.hermesHome)
    const restoredWindow = await launched.app.browserWindow(page)
    expect(await restoredWindow.evaluate(window => window.webContents.session.getStoragePath())).toBe(partition)
    expect(await page.evaluate(() => localStorage.getItem('aino-bot-relogin-marker'))).toBe('original-account')

    if (!(await page.locator('[data-sidebar-mode-header]').innerText()).includes('Bot')) {
      await botMode(page)
    }

    await page.locator('[data-slot="bots-roster"] [data-roster-key="local::default"]').click()
    await expect(surface()).toBeVisible()
    expect(canonical(accountSandbox.hermesHome)!.id).toBe(sid)
    const editor = surface().locator('[data-slot="composer-rich-input"]')
    await page.screenshot({ path: info.outputPath('same-account-staged-bot.png') })
    Object.assign(proof, {
      same_home: true,
      same_partition: true,
      same_account: true,
      same_canonical: true,
      revision_advanced: true,
      before_recovery_state: await api.control<NativeState>('state')
    })
    expect(await collectErrorBanners(page)).toEqual([])
    await expect(surface().getByText(/This chat belongs to another account/)).toHaveCount(0)
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(editor).toHaveText(draft)

    stage = 'explicit-session-model-recovery'
    await surface()
      .getByRole('button', { name: /^Choose (?:a )?model$/ })
      .click()
    const picker = page.getByRole('dialog', { name: 'Choose an available model', exact: true })
    await expect(picker).toBeVisible()
    await picker.getByRole('option', { name: /GLM-5\.3-Flash/ }).click()
    await picker.getByRole('button', { name: 'Apply to this chat', exact: true }).click()
    await expect(picker).toBeHidden()
    await expect(editor).toBeEditable()
    await expect(editor).toHaveText(draft)
    expect((await api.control<NativeState>('state')).model_calls).toBe(0)
    await editor.press('Enter')
    await expect(
      surface()
        .locator('[data-slot="aui_assistant-message-root"]')
        .getByText(`Verified ${api.info.fixture_content}`, { exact: true })
    ).toBeVisible({ timeout: 60_000 })
    await expect(surface().getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect.poll(async () => (await api.control<NativeState>('state')).usage_calls).toBe(2)
    const recovered = JSON.parse(canonical(accountSandbox.hermesHome)!.model_config)
    expect(recovered.platform_owner).toEqual(after.owner)
    expect(canonical(accountSandbox.hermesHome)!.id).toBe(sid)
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter(key => key.startsWith('aino.desktop.platform-default.'))
      )
    ).toEqual([])
    expect(await collectErrorBanners(page)).toEqual([])
    await page.screenshot({ path: info.outputPath('same-account-bot-recovered.png') })
    Object.assign(proof, {
      recovered_owner: recovered.platform_owner,
      recovered_state: await api.control<NativeState>('state')
    })

    stage = 'bound-session-same-account-relogin'
    await page.getByRole('button', { name: /^My account/ }).click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    page = await replaceAccountWindow(launched, current =>
      current
        .getByRole('dialog', { name: 'Sign out', exact: true })
        .getByRole('button', { name: 'Sign out', exact: true })
        .click()
    )
    page = (await login(second.codeAt)).page
    expect((await accountSnapshot(page)).owner).toEqual(after.owner)
    expect((await activeAccountSandbox(sandbox, launched)).hermesHome).toBe(accountSandbox.hermesHome)
    const boundWindow = await launched.app.browserWindow(page)
    expect(await boundWindow.evaluate(window => window.webContents.session.getStoragePath())).toBe(partition)

    if (!(await page.locator('[data-sidebar-mode-header]').innerText()).includes('Bot')) {
      await botMode(page)
    }

    await page.locator('[data-slot="bots-roster"] [data-roster-key="local::default"]').click()
    await expect(surface()).toBeVisible()
    await expect(surface().getByText(/This chat belongs to another account/)).toHaveCount(0)
    await expect(surface().getByRole('button', { name: /^Choose (?:a )?model$/ })).toHaveCount(0)
    const boundEditor = surface().locator('[data-slot="composer-rich-input"]')
    await expect(boundEditor).toBeEditable()
    await boundEditor.fill(`Read ${api.info.fixture_path} again from the bound Bot after another login.`)
    await boundEditor.press('Enter')
    await expect.poll(async () => (await api.control<NativeState>('state')).usage_calls).toBe(4)
    await expect(surface().getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(
      surface()
        .locator('[data-slot="aui_assistant-message-root"]')
        .getByText(`Verified ${api.info.fixture_content}`, { exact: true })
        .last()
    ).toBeVisible()
    expect(canonical(accountSandbox.hermesHome)!.id).toBe(sid)
    expect(JSON.parse(canonical(accountSandbox.hermesHome)!.model_config).platform_owner).toEqual(after.owner)
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter(key => key.startsWith('aino.desktop.platform-default.'))
      )
    ).toEqual([])
    expect(await collectErrorBanners(page)).toEqual([])
    await page.screenshot({ path: info.outputPath('bound-bot-after-same-account-login.png') })
    Object.assign(proof, {
      bound_relogin_without_manual_authorization: true,
      final_state: await api.control<NativeState>('state')
    })
    stage = 'passed'
  } finally {
    const receipt = info.outputPath('same-account-relogin-receipt.json')
    fs.writeFileSync(
      receipt,
      JSON.stringify(
        { stage, ...proof, bindings: launched ? await nativeBindingObservations(launched.app) : [] },
        null,
        2
      )
    )
    await info.attach('same-account-relogin-receipt', { path: receipt, contentType: 'application/json' })

    if (launched && !launched.page.isClosed()) {
      await launched.page.screenshot({ path: info.outputPath('last-window.png') })
      await info.attach('last-alerts', {
        body: JSON.stringify(await collectErrorBanners(launched.page)),
        contentType: 'application/json'
      })
    }

    await launched?.app.close()
    stopFixtureGateway(accountSandbox)
    await api.close()
    fs.copyFileSync(api.logPath, info.outputPath('fixture-api.log'))
    sandbox.cleanup()
  }
})
