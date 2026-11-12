import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { SubagentAvatar } from './subagent-avatar'

afterEach(cleanup)

it('keeps portraits identical across views and name changes, while separating same-name children', () => {
  const child = { id: 'worker', displayName: 'Sources' }
  const { container, rerender } = render(<SubagentAvatar parentSessionId="parent" task={child} />)
  const src = container.querySelector('img')!.src
  rerender(<SubagentAvatar parentSessionId="parent" task={{ ...child, displayName: 'Renamed' }} />)
  expect(container.querySelector('img')!.src).toBe(src)
  rerender(<SubagentAvatar parentSessionId="parent" task={{ id: 'placeholder', subagentId: child.id }} />)
  expect(container.querySelector('img')!.src).toBe(src)
  rerender(<SubagentAvatar parentSessionId="parent" task={{ ...child, id: 'another-worker' }} />)
  expect(container.querySelector('img')!.src).not.toBe(src)
})
