import assert from 'node:assert/strict'

import { test } from 'vitest'

import brand from '../brand.json'
import desktopPackage from '../package.json'

import {
  APP_ID,
  COMPANY_NAME,
  defaultAgentHomePath,
  defaultUserDataPath,
  HOME_DIR_NAME,
  LEGACY_PROTOCOL,
  legacyAgentHomePath,
  LEGAL_COPYRIGHT,
  PRIMARY_PROTOCOL,
  PRODUCT_NAME,
  REPOSITORY_SSH_URL,
  REPOSITORY_URL,
  resolveAgentHomePath
} from './product-identity'

test('Aino product identity is stable across desktop entry points', () => {
  assert.equal(PRODUCT_NAME, 'Aino')
  assert.equal(APP_ID, 'com.ablankpaper.aino')
  assert.equal(HOME_DIR_NAME, 'aino')
  assert.equal(COMPANY_NAME, 'Ablankpaper')
  assert.equal(LEGAL_COPYRIGHT, 'Copyright (c) 2026 Ablankpaper')
  assert.equal(PRIMARY_PROTOCOL, 'aino')
  assert.equal(REPOSITORY_URL, brand.repositoryUrl)
  assert.equal(desktopPackage.repository.url, `git+${REPOSITORY_URL}.git`)
  assert.equal(REPOSITORY_SSH_URL, `git@github.com:${new URL(brand.repositoryUrl).pathname.slice(1)}.git`)
})

test('default agent home is isolated from the Hermes home on POSIX', () => {
  assert.equal(defaultAgentHomePath({ platform: 'darwin', homeDir: '/Users/demo' }), '/Users/demo/.aino')
  assert.equal(defaultAgentHomePath({ platform: 'linux', homeDir: '/home/demo' }), '/home/demo/.aino')
})

test('Aino defaults stay isolated while the Hermes compatibility protocol remains explicit', () => {
  assert.equal(LEGACY_PROTOCOL, 'hermes')
  assert.notEqual(PRIMARY_PROTOCOL, LEGACY_PROTOCOL)
})

test('default agent home is isolated under LOCALAPPDATA on Windows', () => {
  assert.equal(
    defaultAgentHomePath({
      platform: 'win32',
      homeDir: 'C:\\Users\\demo',
      localAppData: 'C:\\Users\\demo\\AppData\\Local'
    }),
    'C:\\Users\\demo\\AppData\\Local\\aino'
  )
})

test('default Electron userData is product-scoped', () => {
  assert.equal(
    defaultUserDataPath('/Users/demo/Library/Application Support'),
    '/Users/demo/Library/Application Support/Aino'
  )
})

test('home resolver keeps Aino isolated when only legacy CLI config exists', () => {
  assert.equal(
    resolveAgentHomePath({
      platform: 'darwin',
      homeDir: '/Users/demo',
      primaryExists: false,
      legacyRuntimeExists: false
    }),
    '/Users/demo/.aino'
  )
})

test('home resolver adopts a legacy runtime only before Aino is created', () => {
  const options = {
    platform: 'darwin',
    homeDir: '/Users/demo',
    primaryExists: false,
    legacyRuntimeExists: true
  }

  assert.equal(resolveAgentHomePath(options), '/Users/demo/.hermes')
  assert.equal(resolveAgentHomePath({ ...options, primaryExists: true }), '/Users/demo/.aino')
})

test('legacy home resolver uses the Windows LOCALAPPDATA layout', () => {
  assert.equal(
    legacyAgentHomePath({
      platform: 'win32',
      homeDir: 'C:\\Users\\demo',
      localAppData: 'C:\\Users\\demo\\AppData\\Local'
    }),
    'C:\\Users\\demo\\AppData\\Local\\hermes'
  )
  assert.equal(
    resolveAgentHomePath({
      platform: 'win32',
      homeDir: 'C:\\Users\\demo',
      localAppData: 'C:\\Users\\demo\\AppData\\Local',
      primaryExists: false,
      legacyRuntimeExists: true
    }),
    'C:\\Users\\demo\\AppData\\Local\\hermes'
  )
})
