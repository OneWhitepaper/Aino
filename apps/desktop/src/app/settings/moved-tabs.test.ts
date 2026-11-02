import { describe, expect, it } from 'vitest'

import { movedSettingsTabRedirect } from './moved-tabs'

describe('movedSettingsTabRedirect', () => {
  it('sends retired resource bookmarks to About while retaining their connection scope', () => {
    expect(movedSettingsTabRedirect('?tab=resources&profile=research&owner=remote')).toBe(
      '/settings?tab=about&profile=research&owner=remote'
    )
  })

  it('moves legacy Vault routes into Safety and opens the Passwords & Logins section', () => {
    expect(movedSettingsTabRedirect('?tab=vault&kind=login&label=github&origin=https%3A%2F%2Fgithub.com')).toBe(
      '/settings?tab=config%3Asafety&kind=login&label=github&origin=https%3A%2F%2Fgithub.com&vault=open&page=vault'
    )
  })

  it('sends the merged Tools & Keys page to Advanced while keeping credential deep links', () => {
    expect(movedSettingsTabRedirect('?tab=keys&kview=settings&key=BRAVE_SEARCH')).toBe(
      '/settings?tab=config%3Aadvanced&key=BRAVE_SEARCH&page=keys'
    )
  })

  it.each([
    ['keys', 'config:advanced', 'keys'],
    ['vault', 'config:safety', 'vault']
  ])('opens a bare legacy %s bookmark on its own child page', (legacy, view, page) => {
    const redirected = movedSettingsTabRedirect(`?tab=${legacy}&page=desktop&profile=research&owner=remote`)
    expect(redirected).not.toBeNull()
    const params = new URL(redirected!, 'http://localhost').searchParams
    expect(params.get('tab')).toBe(view)
    expect(params.get('page')).toBe(page)
    expect(params.get('profile')).toBe('research')
    expect(params.get('owner')).toBe('remote')
  })

  it('sends the retired Nous billing tab to the Aino account and drops its subview', () => {
    expect(movedSettingsTabRedirect('?tab=billing&bview=plans&source=notice')).toBe(
      '/settings?tab=account&source=notice'
    )
  })

  it.each(['accounts', 'keys'])('sends retired model-service %s links to Model settings', view => {
    expect(movedSettingsTabRedirect(`?tab=providers&pview=${view}&key=OPENAI_API_KEY`)).toBe(
      '/settings?tab=config%3Amodel'
    )
  })

  it('sends the retired Settings MCP tab to Capabilities, keeping the row selector', () => {
    expect(movedSettingsTabRedirect('?tab=mcp&server=github')).toBe('/capabilities?tab=connectors&server=github')
  })

  it('leaves live Settings tabs alone', () => {
    // `tab=plugins` is live again: Settings ▸ Plugins hosts every plugin's
    // own settings pages (the inventory stays in Capabilities ▸ Plugins).
    expect(movedSettingsTabRedirect('?tab=plugins&plugin=agent%3Anotes')).toBeNull()
    expect(movedSettingsTabRedirect('?tab=providers&pview=local')).toBeNull()
    expect(movedSettingsTabRedirect('?tab=providers&pview=third-party&profile=research&owner=remote')).toBeNull()
    expect(movedSettingsTabRedirect('?tab=providers&pview=custom-endpoints')).toBeNull()
    expect(movedSettingsTabRedirect('')).toBeNull()
  })
})
