// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ConnectorRowCard } from '@/app/capabilities/connectors/connector-row-card'
import type { ConnectorCardModel } from '@/app/capabilities/connectors/types'
import { I18nProvider } from '@/i18n'

const catalogCard: ConnectorCardModel = {
  description: 'Jira issues and Confluence pages via Atlassian’s hosted MCP.',
  inCatalog: true,
  name: 'Atlassian',
  residency: 'local',
  slug: 'atlassian',
  state: 'available',
  stateWord: 'available',
  ways: { hosted: null, local: { state: 'available' } }
}

afterEach(cleanup)

describe('MCP catalog localization', () => {
  it('localizes a bundled description in the current connector row', () => {
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <ConnectorRowCard card={catalogCard} onOpen={() => {}} />
      </I18nProvider>
    )

    expect(screen.getByText('通过 Atlassian 托管的 MCP 访问 Jira 工单和 Confluence 页面。')).toBeTruthy()
    expect(screen.queryByText(catalogCard.description!)).toBeNull()
  })

  it('preserves backend-authored descriptions for the same catalog entry', () => {
    const description = 'Custom Atlassian server for this organisation'
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <ConnectorRowCard card={{ ...catalogCard, description }} onOpen={() => {}} />
      </I18nProvider>
    )

    expect(screen.getByText(description)).toBeTruthy()
  })
})
