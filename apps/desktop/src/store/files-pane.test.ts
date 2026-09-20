import { afterEach, expect, it } from 'vitest'

import { $hiddenTreePanes, bindPaneVisibility } from '@/components/pane-shell/tree/store'

import { $foregroundConversationOwner } from './conversation-runtime'
import { $filesPaneAvailable } from './files-pane'

afterEach(() => {
  $foregroundConversationOwner.set(null)
})
it('unhides the real files pane for a managed conversation without a legacy workspace', () => {
  $foregroundConversationOwner.set(null)
  bindPaneVisibility('files', $filesPaneAvailable)
  expect($filesPaneAvailable.get()).toBe(false)
  expect($hiddenTreePanes.get()).toContain('files')
  $foregroundConversationOwner.set({ connectionId: 'connection', installId: 'install', conversationId: 'conversation' })
  expect($filesPaneAvailable.get()).toBe(true)
  expect($hiddenTreePanes.get()).not.toContain('files')
  $foregroundConversationOwner.set(null)
  expect($hiddenTreePanes.get()).toContain('files')
})
