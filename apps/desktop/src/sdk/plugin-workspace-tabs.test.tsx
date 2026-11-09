import { useStore } from '@nanostores/react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { findGroupOfPane, group } from '@/components/pane-shell/tree/model'
import { paneChrome } from '@/components/pane-shell/tree/renderer/track-model'
import { $dismissedPanes, $hiddenTreePanes, $layoutTree, closeTreePane } from '@/components/pane-shell/tree/store'
import { resetRememberedActivePanes, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'

import { host } from './index'

const disposers: (() => void)[] = []

beforeEach(() => {
  $hiddenTreePanes.set(new Set())
  $dismissedPanes.set(new Set())
  setWorkspaceScope('sessions')
  disposers.push(registry.register({ area: 'panes', id: 'workspace', title: 'Workspace', render: () => null }))
  $layoutTree.set(group(['workspace'], { id: 'main', active: 'workspace' }))
})

afterEach(() => {
  cleanup()
  disposers
    .splice(0)
    .reverse()
    .forEach(dispose => dispose())
  $layoutTree.set(null)
  $hiddenTreePanes.set(new Set())
  $dismissedPanes.set(new Set())
  resetRememberedActivePanes()
})

it('keeps a plugin workspace icon, live title and plain-text caption at the pane boundary', () => {
  const $name = atom('Design team')

  function LiveTitle() {
    return <>{useStore($name)}</>
  }

  const tabLead = () => <span aria-label="Group conversation">Group</span>
  const tabTitle = () => <LiveTitle />
  const tabTitleText = () => $name.get()
  disposers.push(
    host.openWorkspace('group-tab', {
      title: 'Fallback title',
      tabLead,
      tabTitle,
      tabTitleText,
      tabPresentation: 'conversation',
      render: () => <div>Room body</div>
    })
  )

  const pane = registry.getArea('panes').find(item => item.id === 'plugin-workspace:group-tab')
  const chrome = paneChrome(pane)
  expect(chrome.tabPresentation).toBe('conversation')
  expect(chrome.tabLead).toBe(tabLead)
  expect(chrome.tabTitle).toBe(tabTitle)
  expect(chrome.tabTitleText).toBe(tabTitleText)
  render(
    <>
      {chrome.tabLead?.()}
      {chrome.tabTitle?.()}
    </>
  )
  expect(screen.getByLabelText('Group conversation')).toBeTruthy()
  expect(screen.getByText('Design team')).toBeTruthy()
  act(() => $name.set('Renamed team'))
  expect(screen.queryByText('Design team')).toBeNull()
  expect(screen.getByText('Renamed team')).toBeTruthy()
  expect(chrome.tabTitleText?.()).toBe('Renamed team')
})

it('routes closing a plugin tab to its exact workspace without closing its sibling', () => {
  const onClose = vi.fn()
  const siblingClose = vi.fn()
  disposers.push(host.openWorkspace('group-one', { title: 'One', onClose, render: () => null }))
  disposers.push(host.openWorkspace('group-two', { title: 'Two', onClose: siblingClose, render: () => null }))

  closeTreePane('plugin-workspace:group-one')

  const panes = registry.getArea('panes')
  expect(panes.some(item => item.id === 'plugin-workspace:group-one')).toBe(false)
  expect(panes.some(item => item.id === 'plugin-workspace:group-two')).toBe(true)
  expect(findGroupOfPane($layoutTree.get()!, 'plugin-workspace:group-one')).toBeNull()
  expect(onClose).toHaveBeenCalledOnce()
  expect(siblingClose).not.toHaveBeenCalled()
})
