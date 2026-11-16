import { describe, expect, it } from 'vitest'

import { type AppView, hidesFixedTitlebarClusters, isOverlayView } from './routes'

describe('hidesFixedTitlebarClusters', () => {
  it('hides clusters on contributed full pages and overlays', () => {
    expect(hidesFixedTitlebarClusters('extension')).toBe(true)
    expect(hidesFixedTitlebarClusters('settings')).toBe(true)
  })

  it('keeps the fixed chat controls on conversation routes', () => {
    expect(hidesFixedTitlebarClusters('chat')).toBe(false)
  })

  it.each<AppView>(['capabilities', 'messaging', 'artifacts', 'profiles', 'cron', 'session-import'])(
    'hides chat-specific controls while the %s page owns the workspace',
    view => expect(hidesFixedTitlebarClusters(view)).toBe(true)
  )

  it('does not treat extension as an overlay', () => {
    expect(isOverlayView('extension')).toBe(false)
    expect(isOverlayView('profiles')).toBe(false)
  })
})
