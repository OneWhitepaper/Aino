import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { BotWorkspaceAvatar } from './bot-workspace-avatar'
import { $botMeta, $lastRoster } from './data'
import type { RosterRow } from './types'

let restore: () => void

beforeEach(() => {
  const roster = $lastRoster.get()
  const meta = $botMeta.get()

  restore = () => {
    $lastRoster.set(roster)
    $botMeta.set(meta)
  }
})

afterEach(() => {
  cleanup()
  restore()
})

const photoA = 'data:image/png;base64,YQ=='
const photoB = 'data:image/png;base64,Yg=='
const photoUpdated = 'data:image/png;base64,Yw=='

it('uses each same-named bot’s own source portrait and follows live profile changes', () => {
  const bots: RosterRow[] = ['a', 'b'].map(connectionId => ({ name: 'default', connectionId, sourceScoped: true }))
  $lastRoster.set(bots)
  $botMeta.set({
    'a::default': { image: photoA, title: 'Research' },
    'b::default': { image: photoB, title: 'Writer' },
    default: { image: 'data:image/png;base64,d3Jvbmc=' }
  })

  const { container } = render(
    <>
      <BotWorkspaceAvatar ownerKey="bot:a::default" size={32} />
      <BotWorkspaceAvatar ownerKey="bot:b::default" size={32} />
    </>
  )

  const images = () => [...container.querySelectorAll('img')].map(image => image.getAttribute('src'))
  expect(images()).toEqual([photoA, photoB])

  act(() => $botMeta.set({ ...$botMeta.get(), 'a::default': { image: photoUpdated, title: 'New Research name' } }))
  expect(images()).toEqual([photoUpdated, photoB])
})

it('waits for the exact roster owner and returns to neutral when it disappears', () => {
  const bot: RosterRow = { name: 'default', connectionId: 'a', sourceScoped: true }
  $lastRoster.set([{ ...bot, connectionId: 'b' }])
  $botMeta.set({ 'a::default': { image: photoA }, 'b::default': { image: photoB } })
  const { container } = render(<BotWorkspaceAvatar ownerKey="bot:a::default" size={32} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('.codicon-hubot')).toBeTruthy()

  act(() => $lastRoster.set([bot]))
  expect(container.querySelector('img')?.getAttribute('src')).toBe(photoA)
  act(() => $lastRoster.set([]))
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('.codicon-hubot')).toBeTruthy()
})
