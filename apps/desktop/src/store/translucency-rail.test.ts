// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { glassSupported: true, translucencySupported: true }
  })
})

import { setTranslucency, setTranslucencyMode, setTranslucencyScope } from './translucency'

const root = document.documentElement

const bounds = () => ['--glass-rail-left', '--glass-rail-right'].map(property => root.style.getPropertyValue(property))

const expectRailBounds = (rail?: Element) => {
  const rect = rail?.getBoundingClientRect()
  expect(bounds()).toEqual(rect?.width ? [`${rect.left}px`, `${rect.right}px`] : ['0px', '0px'])
}

afterEach(() => {
  setTranslucencyMode('clear')
  document.body.replaceChildren()
  root.style.removeProperty('direction')
})

describe('glass follows the foreground navigation', () => {
  it.each(['ltr', 'rtl'])('tracks mounting, Settings, collapse and return in %s', async direction => {
    root.style.direction = direction
    setTranslucencyMode('glass')
    setTranslucency(50)
    setTranslucencyScope('sidebar')

    const rail = (width: number) => {
      const element = document.createElement('aside')
      const left = direction === 'rtl' ? window.innerWidth - width : 0
      element.getBoundingClientRect = () => new DOMRect(left, 0, width, 600)

      return element
    }

    const chat = rail(260)
    chat.dataset.slot = 'sidebar'
    document.body.append(chat)
    await vi.waitFor(() => expectRailBounds(chat))

    const settings = document.createElement('section')
    settings.dataset.settingsWorkspace = ''
    const navigation = rail(208)
    navigation.dataset.ainoOverlayNav = ''
    settings.append(navigation)
    document.body.append(settings)
    await vi.waitFor(() => expectRailBounds(navigation))

    // The wide navigation becomes display:none when Settings uses its dropdown.
    const expandedRect = navigation.getBoundingClientRect
    navigation.getBoundingClientRect = () => new DOMRect()
    window.dispatchEvent(new Event('resize'))
    expectRailBounds()
    navigation.getBoundingClientRect = expandedRect
    window.dispatchEvent(new Event('resize'))
    expectRailBounds(navigation)

    settings.remove()
    await vi.waitFor(() => expectRailBounds(chat))
    chat.remove()
    await vi.waitFor(() => expectRailBounds())

    setTranslucencyMode('clear')
    document.body.append(chat)
    await Promise.resolve()
    expect(bounds()).toEqual(['', ''])
  })

  it('moves the glass region with the same rail without tinting chat or a neighbouring summary', async () => {
    const layout = document.createElement('div')
    layout.dataset.treeSplit = 'root'
    const track = document.createElement('div')
    const chat = document.createElement('main')
    const navigation = document.createElement('aside')
    navigation.dataset.navigationRail = ''
    let rect = new DOMRect(0, 43, 220, 600)
    navigation.getBoundingClientRect = () => rect
    track.append(navigation)
    layout.append(track, chat)
    document.body.append(layout)
    setTranslucencyMode('glass')
    setTranslucency(50)
    setTranslucencyScope('sidebar')
    expectRailBounds(navigation)

    // Moving an existing track does not resize or remount the rail.
    rect = new DOMRect(window.innerWidth - 344 - 220, 43, 220, 600)
    layout.prepend(chat)
    await vi.waitFor(() => expectRailBounds(navigation))

    // A neighbouring track can move the rail through sizing alone.
    rect = new DOMRect(window.innerWidth - 344 - 260, 43, 220, 600)
    chat.style.flexBasis = '260px'
    await vi.waitFor(() => expectRailBounds(navigation))
  })
})
