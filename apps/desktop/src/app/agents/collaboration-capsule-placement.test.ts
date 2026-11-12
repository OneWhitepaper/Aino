import { expect, it } from 'vitest'

import { capsulePlacement } from './collaboration-capsule-placement'

const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0.5, bottom: 42.5 })

it('retains the full desktop width on the conversation axis, including a narrower file-panel layout', () => {
  const input = {
    anchor: rect(707, 286),
    viewportWidth: 1440,
    expanded: true,
    titlebarBottom: 43,
    rightControls: rect(1240, 184),
    leftControls: rect(65, 56)
  }
  expect(capsulePlacement(input)).toEqual({ left: 850, top: 0.5 })
  expect(capsulePlacement({ ...input, anchor: rect(547, 286) })).toEqual({ left: 690, top: 0.5 })
})

it('keeps a narrow closed capsule clear of native tools and places the full expanded head beneath them', () => {
  const input = {
    anchor: rect(397, 226),
    viewportWidth: 760,
    expanded: false,
    titlebarBottom: 43,
    rightControls: rect(551, 184),
    leftControls: rect(65, 56)
  }
  const closed = capsulePlacement(input)
  expect(closed.left + 113).toBeLessThan(input.rightControls.left)
  expect(closed.left - 113).toBeGreaterThan(input.leftControls.right)
  expect(closed.top).toBe(0.5)
  const expanded = capsulePlacement({ ...input, expanded: true })
  expect(expanded).toEqual({ left: 510, top: 51 })
  expect(expanded.left - 218).toBeGreaterThanOrEqual(10)
  expect(expanded.left + 218).toBeLessThanOrEqual(750)
})
