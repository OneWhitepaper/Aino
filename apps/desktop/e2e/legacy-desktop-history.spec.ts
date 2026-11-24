import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config'
import { startMockServer } from '../../../tests-js/scripts/mock-server'

import { buildAppEnv, createSandbox, launchDesktop, type Sandbox } from './fixtures'
import { type ElectronApplication, expect, type Page, test } from './test'

// Pre-cutover Desktop rows as main writes them (source='desktop', profile stamped, optional
// Nous user_id), on an install with a second profile that has history of its own. A native
// HTTP grant covers one profile, so every cross-profile session list must still list them.
const ROWS = [
  { id: 'legacy-desktop-anon', source: 'desktop', userId: null },
  { id: 'legacy-desktop-nous', source: 'desktop', userId: 'nous:e2e-user' },
  { id: 'legacy-tui-control', source: 'tui', userId: null }
]

const NAMED_ROW = 'legacy-developer-desktop'

interface HistoryWindow {
  hermesDesktop: {
    openWindow(options: { connectionId: string; profile: string }): Promise<unknown>
    api(input: { path: string }): Promise<{ profiles: Array<{ name: string }> }>
  }
}

async function openProfileWindow(app: ElectronApplication, page: Page, profile: string) {
  // Preserve Aino's Bot manager. Its native profile-window action opens the
  // real renderer on an exact owner, without reviving the upstream rail.
  const nextWindow = app.waitForEvent('window')
  await page.evaluate(
    name => (window as unknown as HistoryWindow).hermesDesktop.openWindow({ connectionId: 'local', profile: name }),
    profile
  )
  const peer = await nextWindow
  await expect(peer.locator('[data-aino-sidebar]')).toBeVisible({ timeout: 120_000 })
  expect(new URL(peer.url()).searchParams.get('profile')).toBe(profile)

  return peer
}

async function selectWorkspace(page: Page, profile: string) {
  const composer = page.locator('[data-slot="composer-root"] [contenteditable="true"]').first()
  await composer.fill(`/profile ${profile}`)
  await composer.press('Enter')
  await expect(page.getByText(`New chats will use bot ${profile}.`, { exact: true }).first()).toBeVisible({
    timeout: 60_000
  })
}

async function setAllProfilesView(app: ElectronApplication, page: Page, value: boolean) {
  // Restore the existing persisted browse preference, then let the real
  // renderer mount and perform its cross-profile reads and session opens.
  await page.evaluate(showAll => {
    localStorage.setItem('hermes.desktop.showAllProfiles', JSON.stringify(showAll))
  }, value)

  return openProfileWindow(app, page, 'default')
}

async function backToChat(page: Page) {
  await page.evaluate(() => {
    window.location.hash = '/'
  })
  await expect(page.locator('[data-aino-sidebar]')).toBeVisible()
}

function seedLegacyHistory(sandbox: Sandbox, python: string, env: Record<string, string>, mockUrl: string) {
  const root = path.resolve(import.meta.dirname, '../../..')
  const multiplex = process.env.E2E_MULTIPLEX === '1'
  // This journey exercises pre-account local rows. Real account isolation has
  // its own guarded native journey; the source-only adapter keeps these fixtures
  // out of the production sign-in service and the user's system keychain.
  const fixtureConfig = `account:\n  dev_mode: true\ndesktop:\n  repo_scan_enabled: false\nupdates:\n  check: false\ngateway:\n  multiplex_profiles: ${multiplex}\n`
  writeMockProviderConfig(sandbox.hermesHome, mockUrl, '  language: en', fixtureConfig)
  writeEnvFile(sandbox.hermesHome, 'e2e-mock-key', mockUrl)
  const named = path.join(sandbox.hermesHome, 'profiles', 'developer')
  fs.mkdirSync(named, { recursive: true })
  writeMockProviderConfig(named, mockUrl, '  language: en', fixtureConfig)
  writeEnvFile(named, 'e2e-mock-key', mockUrl)

  const seed = spawnSync(
    python,
    [
      '-c',
      `
import json, os, sys
from pathlib import Path
from persistence.conversation.messages import NewMessage
from persistence.conversation.sessions import NewSession
from persistence_assembly import open_persistence, profile_scope

def seed(home, rows, profile):
    with open_persistence(profile_scope(home=home)) as store:
        for r in rows:
            store.sessions.create(NewSession(r['id'], source=r['source'], model='e2e-mock', cwd=os.environ['HOME'], user_id=r['userId'], profile_name=profile))
            store.sessions.set_title(r['id'], 'Retained ' + r['id'])
            store.messages.append(r['id'], NewMessage(role='user', content='Historical question ' + r['id']))
            store.messages.append(r['id'], NewMessage(role='assistant', content='Historical answer ' + r['id']))

home = Path(os.environ['HERMES_HOME'])
seed(home, json.loads(sys.argv[1]), 'default')
seed(home / 'profiles' / 'developer', [{'id': sys.argv[2], 'source': 'desktop', 'userId': None}], 'developer')
`,
      JSON.stringify(ROWS),
      NAMED_ROW
    ],
    { cwd: root, env: { ...env, PYTHONPATH: root }, encoding: 'utf8' }
  )

  expect(seed.status, seed.stderr).toBe(0)

  // One cron job in each profile's own store, for the all-profiles cron list.
  for (const [home, name] of [
    [sandbox.hermesHome, 'default-job'],
    [named, 'developer-job']
  ]) {
    const job = spawnSync(
      python,
      ['-c', 'import sys\nfrom cron.jobs import create_job\ncreate_job("e2e", "every 1h", name=sys.argv[1])', name],
      {
        cwd: root,
        env: { ...env, HERMES_HOME: home, PYTHONPATH: root },
        encoding: 'utf8'
      }
    )

    expect(job.status, job.stderr).toBe(0)
  }

  // An existing install has a startup profile; without one the first-launch migration guesses
  // from the newest state.db, which here is the named profile's.
  fs.writeFileSync(path.join(sandbox.userDataDir, 'active-profile.json'), JSON.stringify({ profile: 'default' }))
}

test('pre-cutover Desktop conversations remain visible and open across profiles', async () => {
  test.setTimeout(300_000)
  const sandbox = createSandbox('legacy-desktop-history')
  const mock = await startMockServer()
  const python = process.env.HERMES_DESKTOP_PYTHON!
  const env = buildAppEnv(sandbox, { HERMES_DESKTOP_PYTHON: python, TIRITH_ENABLED: 'false' })
  seedLegacyHistory(sandbox, python, env, mock.url)
  let app: Awaited<ReturnType<typeof launchDesktop>>['app'] | undefined
  const evidence = process.env.HERMES_E2E_EVIDENCE || path.join(sandbox.root, 'evidence')
  fs.mkdirSync(evidence, { recursive: true })
  const results: Record<string, { listed: boolean; opened: boolean; error?: string }> = {}
  let probes: Record<string, unknown> = {}
  const views: Record<string, string[]> = {}
  let resumeFailures = -1

  try {
    const launched = await launchDesktop(env)
    app = launched.app
    let page = launched.page
    const primary = page
    let sidebar = page.locator('[data-aino-sidebar]')

    try {
      expect(
        await page.evaluate(
          () => (window as Window & { hermesDesktop?: { accountAdapter?: string } }).hermesDesktop?.accountAdapter
        )
      ).toBe('legacy-development')
      await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible({ timeout: 120_000 })
      await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+8613800138000')
      await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
      await page.getByRole('button', { name: 'Send code', exact: true }).click()
      await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(page.locator('[data-account-login-card]')).toHaveCount(0)

      const initialProfiles = await page.evaluate(() =>
        (window as unknown as HistoryWindow).hermesDesktop.api({ path: '/api/profiles' })
      )

      expect(initialProfiles.profiles.map(profile => profile.name)).toContain('developer')
      await backToChat(page)

      // The cross-profile lists the sidebar and Sessions view read, through main's transport.
      probes = await page.evaluate(async () => {
        const api = (window as any).hermesDesktop.api
        const out: Record<string, unknown> = {}
        const q = 'limit=40&offset=0&min_messages=1&archived=exclude&order=recent'
        // The same all-profiles read as the renderer sends it on its registry route.
        const registry = { profile: 'default', connectionId: 'local' }

        // One probe: its result, or the error text, under `name`.
        const probe = async (name: string, read: () => Promise<unknown>) => {
          try {
            out[name] = await read()
          } catch (e) {
            out[name] = 'ERR ' + String((e as Error)?.message ?? e).slice(0, 200)
          }
        }

        const sessionIds = (r: any) => {
          const rows = r?.recents ? r.recents.sessions : r?.sessions

          return { ids: (rows ?? []).map((x: any) => `${x.profile}:${x.id}`).sort(), errors: r?.errors ?? [] }
        }

        const previewProfiles = (r: any) => {
          const profiles = new Set<string>()

          for (const project of r?.projects ?? []) {
            for (const session of project.previewSessions ?? []) {
              profiles.add(session.profile)
            }
          }

          return { profiles: [...profiles].sort(), errors: r?.errors ?? [] }
        }

        const cronNames = (r: any) => (Array.isArray(r) ? r : []).map((job: any) => `${job.profile}:${job.name}`).sort()

        // The cross-profile lists the sidebar and Sessions view read, through main's transport.
        const sidebarAll =
          '/api/profiles/sessions/sidebar?recents_profile=all&recents_limit=40&cron_limit=5&messaging_limit=5'

        const reads: [string, Record<string, unknown>, (r: any) => unknown][] = [
          [
            'sidebar:default',
            {
              path: '/api/profiles/sessions/sidebar?recents_profile=default&recents_limit=40&cron_limit=5&messaging_limit=5'
            },
            sessionIds
          ],
          [
            'sidebar:developer',
            {
              path: '/api/profiles/sessions/sidebar?recents_profile=developer&recents_limit=40&cron_limit=5&messaging_limit=5'
            },
            sessionIds
          ],
          ['sidebar:all', { path: sidebarAll }, sessionIds],
          ['sessions:all', { path: `/api/profiles/sessions?${q}&profile=all` }, sessionIds],
          ['sidebar:all:registry', { path: sidebarAll, ...registry }, sessionIds],
          // The all-profiles Projects view and PR badges: which profiles' sessions each read covers.
          ['projects:all', { path: '/api/profiles/projects/tree?preview_limit=10' }, previewProfiles],
          [
            'projects:all:registry',
            { path: '/api/profiles/projects/tree?preview_limit=10', ...registry },
            previewProfiles
          ],
          // The all-profiles cron list, on both routes.
          ['cron:all', { path: '/api/cron/jobs?profile=all' }, cronNames],
          ['cron:all:registry', { path: '/api/cron/jobs?profile=all', ...registry }, cronNames],
          [
            'prs:all',
            { path: '/api/profiles/sessions/pull-requests', method: 'POST', body: { ids: ['legacy-desktop-anon'] } },
            (r: any) => ({ scanned: r?.scanned ?? null })
          ]
        ]

        for (const [name, request, shape] of reads) {
          await probe(name, async () => shape(await api(request)))
        }

        return out
      })
      console.log('API_PROBES: ' + JSON.stringify(probes))

      await expect(sidebar.getByText(/Retained legacy-/).first())
        .toBeVisible({ timeout: 30_000 })
        .catch(() => undefined)
      await page.screenshot({ path: path.join(evidence, 'sidebar.png') })

      for (const row of [...ROWS, { id: NAMED_ROW }]) {
        if (row.id === NAMED_ROW) {
          await selectWorkspace(page, 'developer')
          await backToChat(page)
        }

        const entry = sidebar.getByText('Retained ' + row.id, { exact: true })
        await entry.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
        const listed = await entry.isVisible()
        results[row.id] = { listed, opened: false }

        if (!listed) {
          continue
        }

        await entry.click()
        const answer = page.locator('[data-slot="aui_thread-viewport"]').getByText('Historical answer ' + row.id)
        const failure = page.getByText("Couldn't open this session")
        await expect(answer.or(failure).first())
          .toBeVisible({ timeout: 45_000 })
          .catch(() => undefined)
        results[row.id].opened = await answer.isVisible()

        if (!results[row.id].opened) {
          results[row.id].error =
            (await page.locator('body').innerText()).match(/Couldn't open this session\s*\n?\s*(\S+)/)?.[1] ??
            'no transcript'
        }

        await page.screenshot({ path: path.join(evidence, `open-${row.id}.png`) })
      }

      // Back to default, then its retained all-profiles view, then default again.
      // Every profile's history is listed, and leaving the all view keeps default's own.
      const listedIn = async (ids: string[]) => {
        const seen: string[] = []

        for (const id of ids) {
          const entry = sidebar.getByText('Retained ' + id, { exact: true }).first()
          await entry.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)

          if (await entry.isVisible()) {
            seen.push(id)
          }
        }

        return seen
      }

      page = await setAllProfilesView(app, primary, true)
      sidebar = page.locator('[data-aino-sidebar]')
      await backToChat(page)
      views.all = await listedIn([...ROWS.map(r => r.id), NAMED_ROW])
      await page.screenshot({ path: path.join(evidence, 'view-all.png') })
      page = await setAllProfilesView(app, primary, false)
      sidebar = page.locator('[data-aino-sidebar]')
      await backToChat(page)
      views.default = await listedIn(ROWS.map(r => r.id))
      await page.screenshot({ path: path.join(evidence, 'view-default.png') })

      // The Bots plugin's hide write as the SDK sends it: the owner named only in the body, from
      // the window, now back on default. An unopened pre-upgrade row is not editable over HTTP at all
      // (only its first resume adopts it), so this runs on the developer row opened above.
      probes['bots:hide'] = await page.evaluate(async () => {
        const api = (window as any).hermesDesktop.api
        const path = '/api/sessions/legacy-developer-desktop'

        try {
          const snapshot = await api({ path: `${path}/mutation-snapshot?profile=developer` })

          const identity = {
            expected_generation: snapshot?.runtime_generation,
            expected_revision: snapshot?.runtime_revision,
            request_id: crypto.randomUUID()
          }

          const r = await api({ path, method: 'PATCH', body: { hidden: false, profile: 'developer', ...identity } })

          return { ok: r?.ok ?? null }
        } catch (e) {
          return 'ERR ' + String((e as Error)?.message ?? e).slice(0, 200)
        }
      })
      console.log('BOTS_HIDE: ' + JSON.stringify(probes['bots:hide']))
    } finally {
      console.log('LEGACY_DESKTOP_RESULTS: ' + JSON.stringify(results))
      console.log('LEGACY_DESKTOP_VIEWS: ' + JSON.stringify(views))
      fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ results, views, probes }, null, 2))

      for (const name of ['gateway.log', 'errors.log', 'desktop.log']) {
        const log = path.join(sandbox.hermesHome, 'logs', name)

        if (fs.existsSync(log)) {
          fs.copyFileSync(log, path.join(evidence, name))
        }
      }

      // Opening a row resumes it; every one, Nous-stamped included, must be continuable.
      const desktopLog = path.join(sandbox.hermesHome, 'logs', 'desktop.log')
      resumeFailures = fs.existsSync(desktopLog)
        ? (fs.readFileSync(desktopLog, 'utf8').match(/Resume failed/g) ?? []).length
        : -1
      console.log('LEGACY_DESKTOP_RESUME_FAILURES: ' + resumeFailures)
    }
  } finally {
    await app?.close().catch(() => undefined)
    await mock.close()
    spawnSync(
      python,
      [
        '-c',
        `
import psutil,sys,os
home=os.path.realpath(sys.argv[1])
owned=[]
for p in psutil.process_iter():
    if p.pid==os.getpid(): continue
    try:
        if os.path.realpath(p.environ().get('HERMES_HOME') or os.sep)==home:
            owned.append(p);p.terminate()
    except (psutil.NoSuchProcess,psutil.AccessDenied): pass
_,alive=psutil.wait_procs(owned,timeout=5)
for p in alive:
    try:p.kill()
    except psutil.NoSuchProcess:pass
`,
        sandbox.hermesHome
      ],
      { encoding: 'utf8', env: process.env }
    )
    sandbox.cleanup()
  }

  const everyRow = [...ROWS.map(r => `default:${r.id}`), `developer:${NAMED_ROW}`].sort()
  expect.soft(probes['sidebar:all'], 'sidebar:all').toEqual({ ids: everyRow, errors: [] })
  expect.soft(probes['sidebar:all:registry'], 'sidebar:all:registry').toEqual({ ids: everyRow, errors: [] })
  const everyProfile = { profiles: ['default', 'developer'], errors: [] }
  expect.soft(probes['projects:all'], 'projects:all').toEqual(everyProfile)
  expect.soft(probes['projects:all:registry'], 'projects:all:registry').toEqual(everyProfile)
  expect.soft(probes['prs:all'], 'prs:all').toEqual({ scanned: ['legacy-desktop-anon'] })
  const everyJob = ['default:default-job', 'developer:developer-job']
  expect.soft(probes['cron:all'], 'cron:all').toEqual(everyJob)
  expect.soft(probes['cron:all:registry'], 'cron:all:registry').toEqual(everyJob)
  expect.soft(probes['bots:hide'], 'bots:hide').toEqual({ ok: true })
  expect.soft(probes['sessions:all'], 'sessions:all').toEqual({ ids: everyRow, errors: [] })
  expect
    .soft(probes['sidebar:default'], 'sidebar:default')
    .toEqual({ ids: ROWS.map(r => `default:${r.id}`).sort(), errors: [] })
  expect.soft(probes['sidebar:developer'], 'sidebar:developer').toEqual({ ids: [`developer:${NAMED_ROW}`], errors: [] })

  for (const row of [...ROWS, { id: NAMED_ROW }]) {
    expect.soft(results[row.id], row.id).toEqual({ listed: true, opened: true })
  }

  expect.soft(views.all, 'all-profiles view').toEqual([...ROWS.map(r => r.id), NAMED_ROW])
  expect.soft(views.default, 'default after all-profiles view').toEqual(ROWS.map(r => r.id))
  expect.soft(resumeFailures, 'resume failures').toBe(0)
})
