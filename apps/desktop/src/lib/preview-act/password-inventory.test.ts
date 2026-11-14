import { beforeEach, expect, it, vi } from 'vitest'

import { actEngineSource, type actInPage, type PreviewActHolder } from './act-in-page'

let run: typeof actInPage

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    bottom: 40,
    height: 40,
    left: 0,
    right: 160,
    top: 0,
    width: 160,
    x: 0,
    y: 0
  } as DOMRect)
  Element.prototype.scrollIntoView = vi.fn()
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
  run = new Function('return ' + actEngineSource())() as typeof actInPage
})

it('keeps password controls addressable without exposing their values in inventories or deltas', () => {
  const initialSecret = 'fixture-secret-341'
  const changedSecret = 'fixture-secret-902'
  document.body.innerHTML = `<input id="named" type="password" aria-label="Account password" value="${initialSecret}">
    <input id="unnamed" type="password" value="${initialSecret}">
    <input id="filter" aria-label="Filter" value="open issues">`
  const holder: PreviewActHolder = {}
  const before = run(document, holder, { kind: 'elements' })

  expect(before.elements).toHaveLength(3)
  expect(before.elements?.slice(0, 2)).toEqual([
    expect.objectContaining({ label: 'Account password', role: 'input:password' }),
    expect.objectContaining({ label: 'Password', role: 'input:password' })
  ])
  expect(before.elements?.[2].value).toBe('open issues')
  expect(JSON.stringify(before)).not.toContain(initialSecret)

  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
    input.value = changedSecret
  }

  document.querySelector<HTMLInputElement>('#filter')!.value = 'closed issues'
  const delta = run(document, holder, { kind: 'elements' })
  expect(delta.delta?.changed).toEqual([{ ref: before.elements![2].ref, value: 'closed issues' }])
  expect(JSON.stringify(delta)).not.toContain(changedSecret)
  const full = run(document, holder, { full: true, kind: 'elements' })
  expect(full.elements?.slice(0, 2).map(element => element.value)).toEqual([undefined, undefined])
  expect(JSON.stringify(full)).not.toContain(initialSecret)
  expect(JSON.stringify(full)).not.toContain(changedSecret)
})

it('can locate and fill a password field without copying its value into action receipts or errors', () => {
  const initialSecret = 'fixture-secret-341'
  const typedSecret = 'fixture-secret-902'
  document.body.innerHTML = `<input type="password" value="${initialSecret}">`
  const holder: PreviewActHolder = {}
  const input = document.querySelector('input')!
  const changed = vi.fn()
  input.addEventListener('input', changed)
  const ref = run(document, holder, { kind: 'elements' }).elements![0].ref
  const located = run(document, holder, { kind: 'locate', ref })
  const clicked = run(document, holder, { kind: 'click', ref })
  const typed = run(document, holder, { kind: 'type', ref, text: typedSecret })
  expect([located.success, clicked.success, typed.success]).toEqual([true, true, true])
  expect(input.value).toBe(typedSecret)
  expect(changed).toHaveBeenCalledOnce()

  input.disabled = true
  const refused = run(document, holder, { kind: 'click', ref })
  expect(refused.success).toBe(false)
  expect(JSON.stringify([located, clicked, typed, refused])).not.toContain(initialSecret)
  expect(JSON.stringify([located, clicked, typed, refused])).not.toContain(typedSecret)
})
