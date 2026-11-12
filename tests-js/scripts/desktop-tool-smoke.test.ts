import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { desktopToolMarker } from './desktop-tool-smoke.ts'

test('native file smoke writes inside the verified authenticated home rather than the legacy installation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tool-home-'))
  const legacy = path.join(root, '.hermes')
  const account = path.join(root, 'account-workspaces', 'native-member', 'home')
  fs.mkdirSync(legacy, { recursive: true })
  fs.mkdirSync(account, { recursive: true })

  try {
    const marker = desktopToolMarker({ hermesHome: account }, legacy, account)
    expect(path.dirname(marker)).toBe(fs.realpathSync(account))
    expect(path.basename(marker)).toMatch(/^native-tool-[a-f0-9-]+\.txt$/)
    expect(path.dirname(marker)).not.toBe(legacy)
    expect(() => desktopToolMarker({ hermesHome: account }, legacy)).toThrow('verified workspace home')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('historical desktops without a home identity retain the already verified launch home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tool-legacy-'))

  try {
    expect(path.dirname(desktopToolMarker({}, home))).toBe(fs.realpathSync(home))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
