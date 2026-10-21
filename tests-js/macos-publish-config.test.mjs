import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import feedContract from '../apps/desktop/update-feed.cjs'
import fs from 'node:fs'
import yaml from 'js-yaml'

const root = fileURLToPath(new URL('../', import.meta.url))

it('native candidate embeds the official existing Mac updater endpoint without publication', () => {
  const workflow = yaml.load(fs.readFileSync(new URL('../.github/workflows/desktop-bundled-release.yml', import.meta.url), 'utf8'))
  const job = Object.values(workflow.jobs).find(job => job.if?.includes('inputs.unsigned_windows_zip == true'))
  const build = job.steps.find(step => step.env?.CSC_IDENTITY_AUTO_DISCOVERY === 'false')
  const result = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./apps/desktop/electron-builder.config.cjs").mac.publish))'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...build.env,
      HERMES_DESKTOP_VARIANT: 'bundled', HERMES_PAYLOAD_TAG: 'v0.1.0', HERMES_BUILD_COMMIT: '', _HERMES_CHANNEL_REQUEST_JSON: '' }
  })
  const feed = feedContract.darwinFeed('stable', false)
  expect(JSON.parse(result)).toEqual([{ provider: 'generic', url: `https://petoi.cn/${feed.directory}/`, channel: feed.channel }])
})

it.each([
  ['bundled', 'v0.28.0', 'stable', false],
  ['bundled', 'v0.29.0+canary.20260906T000000Z', 'canary', false],
  ['light', 'v0.28.0', 'stable', true],
  ['light', 'v0.29.0+canary.20260906T000000Z', 'canary', true]
])('packaging and runtime agree for %s %s', (variant, tag, channel, light) => {
  const result = execFileSync(process.execPath, ['-e', "const c=require('./apps/desktop/electron-builder.config.cjs'); console.log(JSON.stringify({publish:c.mac.publish,notarize:c.mac.notarize,targets:c.mac.target}))"], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HERMES_DESKTOP_VARIANT: variant, HERMES_PAYLOAD_TAG: tag, CLOUDFLARE_R2_PUBLIC_URL: 'https://updates.example' }
  })
  const config = JSON.parse(result)
  const feed = feedContract.darwinFeed(channel, light)
  expect(config.publish).toEqual([{ provider: 'generic', url: `https://updates.example/${feed.directory}/`, channel: feed.channel }])
  expect(config.targets).toContain('zip')
  expect(config.notarize).toBe(false)
})

it('bakes only a canonical https feed base into the updater config', () => {
  expect(feedContract.feedBaseUrl(undefined)).toBeUndefined()
  expect(feedContract.feedBaseUrl('https://updates.example/releases/')).toBe('https://updates.example/releases')
  for (const raw of ['http://updates.example', 'https://user:pw@updates.example', 'https://updates.example/?x=1',
    'https://updates.example/#frag', 'https://Updates.Example', 'updates.example', 'https://updates.example/a b']) {
    expect(() => feedContract.feedBaseUrl(raw)).toThrow(TypeError)
  }
  const build = (url) => execFileSync(process.execPath, ['-e', "const c=require('./apps/desktop/electron-builder.config.cjs'); console.log(JSON.stringify(c.publish))"], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HERMES_DESKTOP_VARIANT: 'bundled', HERMES_PAYLOAD_TAG: 'v0.28.0', CLOUDFLARE_R2_PUBLIC_URL: url }
  })
  expect(JSON.parse(build('https://updates.example/'))).toEqual([{ provider: 'generic', url: 'https://updates.example', channel: 'latest' }])
  expect(() => build('http://updates.example')).toThrow(/canonical https/)
})
