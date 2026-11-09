import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { en } = await import('@/i18n/en')

  return { ...sdk, usePluginI18n: () => translateBots, useI18n: () => ({ locale: 'en', t: en }) }
})

import { GroupRow } from './bot-row'
import { $botMeta } from './data'
import { $groupChats } from './group-chat'

afterEach(() => {
  cleanup()
  $botMeta.set({})
  $groupChats.set({})
})

it('uses the speaker’s own source name and readable mentions while preserving the stored message', () => {
  const text = 'Please ask @u6d4b-u8bd5 for a review'
  $botMeta.set({
    builder: { title: 'Wrong local builder' },
    'studio::builder': { title: '设计师' },
    'studio::u6d4b-u8bd5': { title: '审阅助手' }
  })
  $groupChats.set({ Team: { log: [{ at: 1, from: { kind: 'member', name: 'builder', source: '工作室' }, text }], watermarks: {} } })
  render(<GroupRow active={false} group="Team" members={[
    { name: 'builder', connectionId: 'studio', connectionLabel: '工作室', remoteSource: true, sourceScoped: true },
    { name: 'u6d4b-u8bd5', handle: 'u6d4b-u8bd5', connectionId: 'studio', connectionLabel: '工作室', remoteSource: true, sourceScoped: true }
  ]} needsYou={false} onDisband={vi.fn()} onNewSection={vi.fn()} onOpen={vi.fn()} />)

  expect(screen.getByText('设计师: Please ask @审阅助手 for a review')).toBeTruthy()
  expect(screen.queryByText(/Wrong local builder/)).toBeNull()
  expect($groupChats.get().Team.log[0].text).toBe(text)
})
