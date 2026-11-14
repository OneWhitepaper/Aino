import { beforeEach, describe, expect, it, vi } from 'vitest'

import { actEngineSource, actInPage, type PreviewActHolder } from './act-in-page'

function box(left: number, top: number, width = 80, height = 30): DOMRect {
  return { bottom: top + height, height, left, right: left + width, top, width, x: left, y: top } as DOMRect
}

beforeEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box(10, 20))
  Element.prototype.scrollIntoView = vi.fn()
})

describe('preview semantic DOM surfaces', () => {
  it('discovers and operates a late main control after a large decorative subtree', () => {
    document.body.innerHTML =
      '<nav>' +
      Array.from({ length: 21 }, (_, index) => `<a href="/nav/${index}">Navigation ${index}</a>`).join('') +
      '</nav><svg aria-hidden="true">' +
      '<path d="M0 0"/>'.repeat(20_000) +
      '</svg><main><input role="combobox" aria-label="Search issues"><button>Filter issues</button></main>'
    const injected = new Function('return ' + actEngineSource())() as typeof actInPage
    const holder: PreviewActHolder = {}
    const result = injected(document, holder, { kind: 'elements' })
    const search = result.elements?.find(element => element.label === 'Search issues')

    expect(result.elements?.map(element => element.label)).toEqual([
      ...Array.from({ length: 21 }, (_, index) => `Navigation ${index}`),
      'Search issues',
      'Filter issues'
    ])
    expect(injected(document, holder, { kind: 'type', ref: search!.ref, text: 'is:open' }).success).toBe(true)
    expect(document.querySelector('input')?.value).toBe('is:open')
  })

  it('keeps visible controls inside display-contents wrappers without admitting hidden branches', () => {
    document.body.innerHTML = `
      <div style="display:contents"><input role="combobox" aria-label="Search issues"></div>
      <div style="display:contents;opacity:0"><button>Transparent action</button></div>
      <div style="display:none"><button>Unpainted action</button></div>
      <div style="display:contents" inert><button>Inert action</button></div>
    `

    // Chromium returns false for the wrapper's missing box, while its painted child is visible.
    for (const wrapper of document.querySelectorAll('div')) {
      Object.defineProperty(wrapper, 'checkVisibility', { value: () => false })
    }

    const holder: PreviewActHolder = {}
    const result = actInPage(document, holder, { kind: 'elements' })

    expect(result.elements?.map(element => element.label)).toEqual(['Search issues'])
    expect(actInPage(document, holder, { kind: 'type', ref: result.elements![0].ref, text: 'label:bug' }).success).toBe(
      true
    )
    expect(document.querySelector('input')?.value).toBe('label:bug')
  })

  it('discovers open shadow controls and keeps their refs after a rescan', () => {
    const host = document.createElement('section')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<span id="name">Account email</span><input aria-labelledby="name"><button>Save</button>'
    const holder: PreviewActHolder = {}
    const injected = new Function('return ' + actEngineSource())() as typeof actInPage

    const first = injected(document, holder, { kind: 'elements' })
    expect(first.elements?.map(element => element.label)).toEqual(['Account email', 'Save'])
    const save = first.elements!.find(element => element.label === 'Save')!
    expect(injected(document, holder, { kind: 'elements' }).delta).toEqual({ same: 2 })
    const clicked = vi.fn()
    shadow.querySelector('button')!.addEventListener('click', clicked)
    expect(injected(document, holder, { kind: 'click', ref: save.ref }).success).toBe(true)
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('excludes a shadow control hidden by its host', () => {
    const host = document.createElement('section')
    host.setAttribute('inert', '')
    document.body.append(host)
    host.attachShadow({ mode: 'open' }).innerHTML = '<button>Hidden action</button>'
    document.body.insertAdjacentHTML('beforeend', '<button>Visible action</button>')

    expect(actInPage(document, {}, { kind: 'elements' }).elements?.map(element => element.label)).toEqual([
      'Visible action'
    ])
  })

  it('locates same-origin frame controls in the outer viewport and targets the child document', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(box(200, 100, 400, 300))
    const child = frame.contentDocument!
    child.body.innerHTML = '<button id="save">Save inside frame</button>'
    const button = child.querySelector('button')!
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(box(30, 40, 100, 40))
    Object.defineProperty(button, 'scrollIntoView', { value: vi.fn() })
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    const holder: PreviewActHolder = {}

    const save = actInPage(document, holder, { kind: 'elements' }).elements?.[0]
    expect(save?.label).toBe('Save inside frame')
    expect(actInPage(document, holder, { kind: 'locate', ref: save!.ref }).point).toEqual({ x: 280, y: 160 })
    expect(actInPage(document, holder, { kind: 'click', ref: save!.ref }).success).toBe(true)
    expect(clicked).toHaveBeenCalledOnce()
    frame.remove()
    expect(actInPage(document, holder, { kind: 'click', ref: save!.ref }).success).toBe(false)
  })

  it('aims at a non-empty visible fragment of a wrapped inline link', () => {
    document.body.innerHTML = '<a href="#issue" id="issue">A long inline issue title that wraps over several lines</a>'
    const link = document.getElementById('issue')!
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(box(20, 20, 120, 80))
    vi.spyOn(link, 'getClientRects').mockReturnValue([
      box(20, 20, 120, 20),
      box(20, 40, 0, 20),
      box(20, 60, 100, 20)
    ] as unknown as DOMRectList)
    const holder: PreviewActHolder = {}
    const entry = actInPage(document, holder, { kind: 'elements' }).elements![0]

    expect(actInPage(document, holder, { kind: 'locate', ref: entry.ref })).toMatchObject({
      point: { x: 80, y: 30 },
      success: true
    })
  })

  it('uses an uncovered fragment and excludes a link when every fragment is covered', () => {
    document.body.innerHTML = '<div id="overlay"></div><a href="#issue" id="issue">Wrapped issue title</a>'
    const link = document.getElementById('issue')!
    const overlay = document.getElementById('overlay')!
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(box(20, 10, 120, 80))
    vi.spyOn(link, 'getClientRects').mockReturnValue([
      box(20, 10, 120, 20),
      box(20, 70, 100, 20)
    ] as unknown as DOMRectList)
    let coverAll = false
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: (_x: number, y: number) => (coverAll || y < 35 ? overlay : link)
    })

    try {
      const holder: PreviewActHolder = {}
      const result = actInPage(document, holder, { kind: 'elements' })
      const entry = result.elements!.find(element => element.label === 'Wrapped issue title')!

      expect(actInPage(document, holder, { kind: 'locate', ref: entry.ref }).point).toEqual({ x: 70, y: 80 })
      coverAll = true
      expect(actInPage(document, {}, { kind: 'elements' }).elements).toEqual([])
    } finally {
      delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
    }
  })

  it('aims inside the visible intersection of a partly clipped inline fragment', () => {
    document.body.innerHTML = '<a href="#issue" id="issue">Partly clipped issue title</a>'
    const link = document.getElementById('issue')!
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(box(20, -20, 120, 30))
    vi.spyOn(link, 'getClientRects').mockReturnValue([box(20, -20, 120, 30)] as unknown as DOMRectList)
    const holder: PreviewActHolder = {}
    const entry = actInPage(document, holder, { kind: 'elements' }).elements![0]

    expect(actInPage(document, holder, { kind: 'locate', ref: entry.ref }).point).toEqual({ x: 80, y: 5 })
  })

  it('does not rebind a removed frame control to a matching control in another frame', () => {
    const first = document.createElement('iframe')
    const second = document.createElement('iframe')
    document.body.append(first, second)
    first.contentDocument!.body.innerHTML = '<button id="save">Save</button>'
    second.contentDocument!.body.innerHTML = '<button id="save">Save</button>'

    for (const frame of [first, second]) {
      const button = frame.contentDocument!.querySelector('button')!
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(box(10, 20))
    }

    const holder: PreviewActHolder = {}
    const original = actInPage(document, holder, { kind: 'elements' }).elements!
    expect(original).toHaveLength(2)
    first.remove()
    const next = actInPage(document, holder, { kind: 'elements', full: true }).elements!
    expect(next).toHaveLength(1)
    expect(next[0].ref).toBe(original[1].ref)
    expect(actInPage(document, holder, { kind: 'click', ref: original[0].ref }).success).toBe(false)
  })

  it('keeps a shadow ref on re-render and never moves it to a different root', () => {
    const left = document.createElement('section')
    const right = document.createElement('section')
    document.body.append(left, right)
    const first = left.attachShadow({ mode: 'open' })
    const second = right.attachShadow({ mode: 'open' })
    first.innerHTML = '<button id="save">Save</button>'
    second.innerHTML = '<button id="save">Save</button>'
    const holder: PreviewActHolder = {}
    const original = actInPage(document, holder, { kind: 'elements' }).elements!
    first.innerHTML = '<div><button id="save">Save</button></div>'

    const next = actInPage(document, holder, { kind: 'elements', full: true }).elements!
    expect(next.map(element => element.ref)).toEqual(original.map(element => element.ref))
    first.replaceChildren()
    const remaining = actInPage(document, holder, { kind: 'elements', full: true }).elements!
    expect(remaining[0].ref).toBe(original[1].ref)
    expect(actInPage(document, holder, { kind: 'click', ref: original[0].ref }).success).toBe(false)
  })

  it('reports opaque frames without pretending their controls were inspected', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    Object.defineProperty(frame, 'contentDocument', { get: () => null })

    const result = actInPage(document, {}, { kind: 'elements' })
    expect(result.success).toBe(true)
    expect(result.elements).toEqual([])
    expect(result.note).toContain('visual actions')
  })

  it('resolves :focus to the field inside a shadow root rather than its host', () => {
    const host = document.createElement('section')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<input aria-label="Search">'
    const field = shadow.querySelector('input')!
    field.focus()

    expect(document.activeElement).toBe(host)
    expect(actInPage(document, {}, { kind: 'locate', selector: ':focus' })).toMatchObject({
      success: true,
      tag: 'INPUT',
      typable: true
    })
  })
})
