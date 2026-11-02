import { cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaneTab, PaneTabStrip } from '@/components/ui/pane-tab'

import { useActiveTabVisible } from './tab-strip-scroll'

interface TabFixtureProps {
  activeId: string
  legacy: boolean
  tabs: string[]
}

function TabFixture({ activeId, legacy, tabs }: TabFixtureProps) {
  const listRef = useRef<HTMLDivElement>(null)
  useActiveTabVisible(listRef, activeId, {
    enabled: true,
    last: tabs.at(-1) === activeId,
    tabCount: tabs.length
  })

  return (
    <PaneTabStrip listRef={listRef}>
      {tabs.map((id, index) =>
        legacy ? (
          <button data-test-start={index * 200} data-tree-tab={id} key={id} role="tab" type="button">
            {id}
          </button>
        ) : (
          <PaneTab active={activeId === id} data-test-start={index * 200} key={id} role="tab">
            {id}
          </PaneTab>
        )
      )}
    </PaneTabStrip>
  )
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const start = this.dataset.testStart

    if (start !== undefined) {
      const scroller = this.closest<HTMLElement>('[role="tablist"]')!

      return new DOMRect(20 + Number(start) - scroller.scrollLeft, 0, 120, 32)
    }

    return new DOMRect(20, 0, 300, 45)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useActiveTabVisible', () => {
  it.each([false, true])('reveals newly appended and earlier tabs (legacy selector: %s)', legacy => {
    const tabs = ['files', 'review', 'terminal', 'new-tab']
    const { rerender } = render(<TabFixture activeId="files" legacy={legacy} tabs={tabs} />)
    const scroller = screen.getByRole('tablist')
    expect(scroller.scrollLeft).toBe(0)

    rerender(<TabFixture activeId="deep-file" legacy={legacy} tabs={[...tabs, 'deep-file']} />)
    expect(scroller.scrollLeft).toBe(600)

    rerender(<TabFixture activeId="review" legacy={legacy} tabs={[...tabs, 'deep-file']} />)
    expect(scroller.scrollLeft).toBe(200)

    rerender(<TabFixture activeId="files" legacy={legacy} tabs={[...tabs, 'deep-file']} />)
    expect(scroller.scrollLeft).toBe(0)
  })
})
