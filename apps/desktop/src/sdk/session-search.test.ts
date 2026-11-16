import { afterEach, expect, it } from 'vitest'

import { $workspaceIsPage } from '@/app/routes'
import { currentFindScope } from '@/lib/find-in-page-scope'
import { $findInPage, closeFindBar, setFindQuery } from '@/store/find-in-page'

import { searchSession } from './session-search'

afterEach(() => {
  closeFindBar()
  $workspaceIsPage.set(false)
  document.body.innerHTML = ''
})

it('searches the requested visible conversation even when another tile precedes it', async () => {
  document.body.innerHTML = `
    <div data-chat-surface data-stored-session-id="first">other text</div>
    <div data-chat-surface data-stored-session-id="target">needle</div>`
  expect(searchSession('target')).toBe(true)
  expect(currentFindScope()?.dataset.storedSessionId).toBe('target')
  await setFindQuery('needle')
  expect($findInPage.get().matchCount).toBe(1)
  expect(document.querySelector('[data-stored-session-id="first"] mark')).toBeNull()
})

it('never opens a search for a hidden chat or behind a full page', () => {
  document.body.innerHTML = `
    <div data-pane-hidden><div data-chat-surface data-stored-session-id="hidden">secret</div></div>
    <div data-chat-surface data-stored-session-id="visible">foreground</div>`
  expect(searchSession('hidden')).toBe(false)
  expect($findInPage.get().active).toBe(false)
  $workspaceIsPage.set(true)
  expect(searchSession('visible')).toBe(false)
  expect($findInPage.get().active).toBe(false)
})
