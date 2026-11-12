import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'
import { I18nProvider } from '@/i18n'
import * as gateway from '@/store/gateway'
import { _resetSessionOwnerHintsForTests, setSessionOwnerHint } from '@/store/session'
import type { SessionOwnerScope } from '@/store/session-request-router'

import { SubagentTranscript } from './subagent-transcript'

const owner = { connectionId: 'remote-owner', profile: 'research', targetProfile: 'remote-research' }
const request = vi.fn()

function tree(explicitOwner: SessionOwnerScope, child = 'worker', visible = true) {
  return (
    <I18nProvider configClient={null} initialLocale="en">
      <PaneVisibleContext.Provider value={visible}>
        <SubagentTranscript owner={explicitOwner} sessionId="parent" subagentId={child} />
      </PaneVisibleContext.Provider>
    </I18nProvider>
  )
}

beforeEach(() => {
  request.mockReset().mockResolvedValue({ available: true, text: 'Owned transcript', truncated: false })
  vi.spyOn(gateway, 'requestGatewayForAgent').mockImplementation(request)
  setSessionOwnerHint('parent', { connectionId: 'other-source', profile: 'other' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  _resetSessionOwnerHintsForTests()
})

it('routes an explicit transcript owner without borrowing the foreground runtime owner', async () => {
  render(tree(owner))
  await screen.findByText('Owned transcript')
  expect(request).toHaveBeenCalledWith('remote-owner', 'research', 'subagent.tail', {
    session_id: 'parent',
    subagent_id: 'worker'
  })
})

it('does not read through a different known owner when the supplied owner is unresolved', async () => {
  render(tree(null))
  await screen.findByText('Live transcript unavailable')
  expect(request).not.toHaveBeenCalled()
})

it('withholds the previous child while a new transcript is pending and ignores a late old response', async () => {
  let settleOld!: (value: { available: boolean; text: string; truncated: boolean }) => void
  request.mockReturnValueOnce(new Promise(resolve => (settleOld = resolve)))
  const view = render(tree(owner, 'old'))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  view.rerender(tree(owner, 'new'))
  await screen.findByText('Owned transcript')
  await act(async () => settleOld({ available: true, text: 'Wrong old child', truncated: false }))
  expect(screen.queryByText('Wrong old child')).toBeNull()
  request.mockReturnValueOnce(new Promise(() => undefined))
  view.rerender(tree({ connectionId: 'third-source', profile: 'research' }, 'new'))
  expect(screen.queryByText('Owned transcript')).toBeNull()
})

it('keeps explicit-owner reads dormant while its tool tab is hidden', async () => {
  const view = render(tree(owner, 'worker', false))
  await act(async () => undefined)
  expect(request).not.toHaveBeenCalled()
  view.rerender(tree(owner))
  await screen.findByText('Owned transcript')
  expect(request).toHaveBeenCalledTimes(1)
})
