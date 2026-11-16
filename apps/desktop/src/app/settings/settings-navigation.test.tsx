import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { settingsNavigationCopy } from '@/i18n/settings-navigation'
import { Globe } from '@/lib/icons'

import { settingsNavigationGroups } from './settings-navigation'

afterEach(cleanup)

const destinations = [
  'account',
  'config:appearance',
  'notifications',
  'keybinds',
  'config:model',
  'config:chat',
  'config:memory',
  'config:voice',
  'sessions',
  'config:workspace',
  'config:browser',
  'providers',
  'gateway',
  'plugins',
  'config:safety',
  'config:advanced',
  'about'
]

const groups = () =>
  settingsNavigationGroups(
    destinations.map(id => ({ active: false, icon: Globe, id, label: id, onSelect: vi.fn() })),
    settingsNavigationCopy('en'),
    ''
  )

it('renders every built-in settings destination with a visible inherited icon stroke', () => {
  const navigation = groups()

  const view = render(
    <div>
      {navigation.map(({ icon: Icon, id }) => (
        <Icon key={id} />
      ))}
    </div>
  )

  const icons = view.container.querySelectorAll('svg')

  expect(icons).toHaveLength(navigation.length)

  for (const icon of icons) {
    expect(icon.getAttribute('stroke')).toBe('currentColor')
    expect(icon.getAttribute('stroke-width')).toBe('1.65')
  }
})

it('keeps numeric stroke as line width and a string stroke as an explicit color', () => {
  const Icon = groups()[0].icon

  const view = render(
    <div>
      <Icon stroke={1.25} />
      <Icon stroke="#2468ac" />
    </div>
  )

  const [numeric, colored] = view.container.querySelectorAll('svg')

  expect(numeric.getAttribute('stroke')).toBe('currentColor')
  expect(numeric.getAttribute('stroke-width')).toBe('1.25')
  expect(colored.getAttribute('stroke')).toBe('#2468ac')
  expect(colored.getAttribute('stroke-width')).toBe('1.65')
})
