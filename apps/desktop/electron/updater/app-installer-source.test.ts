import { describe, expect, it } from 'vitest'

import { parseCheckOutput } from '../app-updater'

import { AppInstallerStrategy, type AppInstallerStrategyDeps } from './app-installer'
import { parseAppInstallerSourceOutput, readAppInstallerSource } from './app-installer-source'

const sourceUri = 'https://updates.example/update.appinstaller'

describe('App Installer source resolution protocol', () => {
  it('reads the current registered source through the existing runner in explicit source-only mode', async () => {
    expect(
      await readAppInstallerSource({
        python: 'payload/python.exe',
        module: 'hermes_cli.windows_appinstaller_update',
        run: async (python, module, args) => {
          expect([python, module, args]).toEqual([
            'payload/python.exe',
            'hermes_cli.windows_appinstaller_update',
            ['--source-only']
          ])

          return { code: 0, stdout: JSON.stringify({ source_resolution: 'registered', source_uri: sourceUri }) }
        }
      })
    ).toEqual({ kind: 'registered', sourceUri })
  })

  it('recognizes only the explicit unpackaged result as manual compatibility', () => {
    expect(parseAppInstallerSourceOutput(0, '{"source_resolution":"not-packaged"}')).toEqual({ kind: 'not-packaged' })
  })

  it.each([
    {},
    [],
    null,
    { available: false, reason: 'not-packaged' },
    { available: true, source_uri: sourceUri },
    { source_resolution: 'registered' },
    { source_resolution: 'registered', source_uri: '' },
    { source_resolution: 'registered', source_uri: ' ' },
    { source_resolution: 'registered', source_uri: 42 },
    { source_resolution: 'unknown', source_uri: sourceUri },
    { source_resolution: 'not-packaged', source_uri: sourceUri },
    { source_resolution: 'registered', source_uri: sourceUri, available: true },
    { source_resolution: 'registered', source_uri: sourceUri, availability: 'AVAILABLE' },
    { source_resolution: 'registered', source_uri: sourceUri, error: 'permission denied' }
  ])('rejects an invalid or overlapping source response: %j', payload => {
    expect(parseAppInstallerSourceOutput(0, JSON.stringify(payload))).toMatchObject({ kind: 'error' })
  })

  it.each([
    [0, 'not JSON', 'checker returned invalid source JSON'],
    [1, 'not JSON', 'checker exited 1'],
    [1, JSON.stringify({ source_resolution: 'error', error: 'source permission denied' }), 'source permission denied'],
    [0, JSON.stringify({ source_resolution: 'error', error: 'source read failed' }), 'source read failed'],
    [
      1,
      JSON.stringify({ available: null, error: 'checker timed out after 20000ms' }),
      'checker timed out after 20000ms'
    ],
    [1, JSON.stringify({ available: null, error: 'spawn payload failed' }), 'spawn payload failed'],
    [2, JSON.stringify({ source_resolution: 'registered', source_uri: sourceUri }), 'checker exited 2']
  ] as const)('retains source or transport failure (%s)', (code, stdout, error) => {
    expect(parseAppInstallerSourceOutput(code, stdout)).toEqual({ kind: 'error', error })
  })

  it.each([{ source_resolution: 'registered', source_uri: sourceUri }, { source_resolution: 'not-packaged' }])(
    'does not turn source-only output into UI availability: %j',
    payload => {
      expect(parseCheckOutput(0, JSON.stringify(payload))).toMatchObject({ available: null })
    }
  )
})

it.each([
  [0, '{}', 'checker returned no registered source resolution'],
  [0, '{"source_resolution":"registered"}', 'checker returned no registered source resolution'],
  [1, '{"source_resolution":"error","error":"source permission denied"}', 'source permission denied'],
  [1, '{"available":null,"error":"checker timed out after 20000ms"}', 'checker timed out after 20000ms'],
  [0, 'not JSON', 'checker returned invalid source JSON'],
  [0, '{"available":false,"reason":"not-packaged"}', 'checker returned an invalid source resolution response']
] as const)('source failure stops before all update side effects: %s %s', async (code, stdout, error) => {
  const calls: string[] = []

  const deps: AppInstallerStrategyDeps = {
    python: 'payload/python.exe',
    module: 'hermes_cli.windows_appinstaller_update',
    run: async () => ({ code, stdout }),
    channel: 'stable',
    light: false,
    appVersion: '1.0.0',
    feedBaseUrl: '',
    installer: {
      prepare: async () => {
        calls.push('prepare')

        return 'update.appinstaller'
      },
      open: async () => {
        calls.push('open')

        return ''
      }
    },
    teardownBundledBackend: () => {
      calls.push('teardown')
    },
    restoreBundledBackend: async () => {
      calls.push('restore')
    },
    emitUpdateProgress: () => {
      calls.push('progress')
    },
    quit: () => {
      calls.push('quit')
    },
    registerPendingRelaunch: async () => {
      calls.push('marker')

      return {
        automatic: true,
        cancel: async () => {
          calls.push('cancel')
        }
      }
    }
  }

  await expect(new AppInstallerStrategy(deps).apply()).rejects.toThrow(error)
  expect(calls).toEqual([])
})
