import { act, cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, expect, it } from 'vitest'

import { createPreviewConsoleState } from './preview-console-state'
import { PreviewBrowserHost } from './preview-pane'

afterEach(cleanup)

it('keeps the same live guest above an open, resizing console', () => {
  const state = createPreviewConsoleState()
  const host = createRef<HTMLDivElement>()
  render(<PreviewBrowserHost consoleState={state} hidden={false} hostRef={host} />)
  const node = host.current!
  const guest = document.createElement('iframe')
  node.append(guest)

  act(() => {
    state.setOpen(true)
    state.setHeight(260)
  })
  expect(node.style.bottom).toBe('260px')
  expect(host.current).toBe(node)
  expect(node.firstElementChild).toBe(guest)

  act(() => state.setHeight(300))
  expect(node.style.bottom).toBe('300px')
  expect(node.firstElementChild).toBe(guest)

  act(() => state.setOpen(false))
  expect(node.style.bottom).toBe('')
  expect(node.firstElementChild).toBe(guest)
})
