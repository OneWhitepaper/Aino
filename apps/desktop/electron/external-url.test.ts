import { ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from 'vitest'

import { createExternalUrlOpener } from './external-url'

test.each([
  { route: 'native', failure: false },
  { route: 'native', failure: true },
  { route: 'wsl-spawn-error', failure: false },
  { route: 'wsl-spawn-error', failure: true },
  { route: 'wsl-exit-error', failure: false },
  { route: 'wsl-exit-error', failure: true },
  { route: 'wsl', failure: false }
])('waits for the browser launch and propagates its outcome: $route / failure=$failure', async ({ route, failure }) => {
  const launchError = new Error('No browser is available')

  let completeLaunch = () => {}

  let rejectLaunch = (_error: Error) => {}
  const child = new ChildProcess()
  const opened: string[] = []
  const url = 'https://example.com/register?source=desktop'

  const openExternalUrl = createExternalUrlOpener({
    isWsl: route !== 'native',
    log: () => {},
    shell: {
      openExternal: async value => {
        opened.push(value)
        await new Promise<void>((resolve, reject) => {
          completeLaunch = resolve
          rejectLaunch = reject
        })
      },
      openPath: async () => {
        throw new Error('A web URL must not open a file')
      },
      showItemInFolder: () => {
        throw new Error('A web URL must not reveal a file')
      }
    },
    spawn: (command, args, options) => {
      expect(command).toBe('cmd.exe')
      expect(args).toEqual(['/c', 'start', '""', url])
      expect(options).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true })

      return child
    }
  })

  let settled = false

  const result = Promise.resolve(openExternalUrl(url)).then(
    value => {
      settled = true

      return { value }
    },
    error => {
      settled = true

      return { error }
    }
  )

  if (route === 'wsl-spawn-error') {
    child.emit('error', new Error('Windows interop is unavailable'))
  } else if (route === 'wsl-exit-error') {
    child.emit('exit', 1, null)
  }

  await new Promise(resolve => setImmediate(resolve))
  const settledBeforeLaunch = settled

  if (route === 'wsl') {
    child.emit('exit', 0, null)
  } else if (failure) {
    rejectLaunch(launchError)
  } else {
    completeLaunch()
  }

  const outcome = await result
  expect(settledBeforeLaunch).toBe(false)
  expect(outcome).toEqual(failure ? { error: launchError } : { value: true })
  expect(opened).toEqual(route === 'wsl' ? [] : [url])
})

test.each([
  'invalid',
  'unsafe-scheme',
  'http',
  'mailto',
  'file-open',
  'file-reveal',
  'file-open-reject',
  'file-reveal-reject',
  'file-denied'
])('keeps the URL and file boundaries while reporting the selected handler result: %s', async scenario => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aino-external-url-'))
  const file = path.join(directory, 'report.txt')
  const opened: string[] = []
  const revealed: string[] = []
  const external: string[] = []
  const handlerError = new Error('OS handler failed')

  const urls: Record<string, string> = {
    invalid: 'not a URL',
    'unsafe-scheme': 'javascript:alert(1)',
    'file-denied': 'file:///tmp/report%00.txt',
    http: 'http://example.com/',
    mailto: 'mailto:user@example.com'
  }

  const openExternalUrl = createExternalUrlOpener({
    isWsl: false,
    log: () => {},
    shell: {
      openExternal: async url => {
        external.push(url)
      },
      openPath: async value => {
        opened.push(value)

        if (scenario === 'file-open-reject') {
          throw handlerError
        }

        return scenario.startsWith('file-reveal') ? 'No associated application' : ''
      },
      showItemInFolder: value => {
        revealed.push(value)

        if (scenario === 'file-reveal-reject') {
          throw handlerError
        }
      }
    }
  })

  try {
    await writeFile(file, 'local artifact')
    const result = Promise.resolve(openExternalUrl(urls[scenario] ?? pathToFileURL(file).href))

    if (scenario.endsWith('-reject')) {
      await expect(result).rejects.toBe(handlerError)
    } else {
      await expect(result).resolves.toBe(!['invalid', 'unsafe-scheme', 'file-denied'].includes(scenario))
    }

    expect(opened).toEqual(scenario.startsWith('file-') && scenario !== 'file-denied' ? [file] : [])
    expect(revealed).toEqual(scenario.startsWith('file-reveal') ? [file] : [])
    expect(external).toEqual(['http', 'mailto'].includes(scenario) ? [urls[scenario]] : [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
