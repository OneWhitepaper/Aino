import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'

import { expect, test } from 'vitest'

import { stageAppInstallerFile } from '../app-installer-file'
import { type ExecFileImpl, runAppInstallerChecker } from '../appinstaller-checker'

import { AppInstallerStrategy, type AppInstallerStrategyDeps } from './app-installer'

test('apply reads the registered source through the actual runner before a real staging 404, without teardown', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appinstaller-source-flow-'))
  const calls: string[] = []
  const argv: string[][] = []
  const requests: string[] = []
  const marker = path.join(directory, 'pending-update-relaunch.json')

  const server = http.createServer((request, response) => {
    requests.push(request.url || '')
    response.writeHead(404).end('not found')
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('missing loopback address')
  }

  const sourceUri = `http://127.0.0.1:${address.port}/update.appinstaller`

  const exec: ExecFileImpl = (_file, args, _options, callback) => {
    argv.push([...args])

    if (!args.includes('--source-only')) {
      callback(
        Object.assign(new Error('exited'), { code: 1 }),
        JSON.stringify({
          available: null,
          error: 'checker timed out after 20000ms'
        }),
        ''
      )
    } else {
      calls.push('source-read')
      callback(null, JSON.stringify({ source_resolution: 'registered', source_uri: sourceUri }), '')
    }

    return undefined
  }

  const deps: AppInstallerStrategyDeps = {
    python: 'payload-python.exe',
    module: 'hermes_cli.windows_appinstaller_update',
    run: (python, module, args?: readonly string[]) =>
      runAppInstallerChecker(python, module, { args, execFileImpl: exec }),
    feedBaseUrl: '',
    channel: 'stable',
    light: false,
    appVersion: '0.1.6',
    installer: {
      prepare: async url => {
        calls.push('prepare')

        return stageAppInstallerFile(url, directory)
      },
      open: async () => {
        calls.push('open')

        return ''
      }
    },
    registerPendingRelaunch: async () => {
      calls.push('marker')
      await fs.writeFile(marker, '{}')

      return { automatic: true, cancel: async () => {} }
    },
    teardownBundledBackend: () => {
      calls.push('teardown')
    },
    restoreBundledBackend: async () => {
      calls.push('restore')
    },
    emitUpdateProgress: () => {},
    quit: () => {
      calls.push('quit')
    }
  }

  try {
    await expect(new AppInstallerStrategy(deps).apply()).rejects.toThrow(
      'App Installer descriptor download failed: HTTP 404'
    )
    expect(argv).toEqual([['-P', '-m', 'hermes_cli.windows_appinstaller_update', '--source-only']])
    expect(calls).toEqual(['source-read', 'prepare'])
    expect(requests).toEqual(['/update.appinstaller'])
    expect(await fs.readdir(directory)).toEqual([])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
