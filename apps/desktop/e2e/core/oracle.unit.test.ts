import { createRequire } from 'node:module'

import type { Page } from '@playwright/test'
import { expect, test } from 'vitest'

import { renderedView } from './oracle'

interface TestDom {
  window: Window & typeof globalThis
}

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { runScripts: string }) => TestDom
}

async function read(html: string, owner: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'outside-only' })

  // JSDOM has no layout engine. Both kept-alive and foreground viewports
  // deliberately retain a box, as PaneBody does; visibility is real CSS.
  dom.window.eval('HTMLElement.prototype.getClientRects = () => [{ width: 640, height: 480 }]')

  const page = {
    async evaluate(script: (...args: any[]) => unknown, arg: unknown) {
      return dom.window.eval(`(${script.toString()})`)(arg)
    }
  } as unknown as Page

  try {
    return await renderedView(page, owner)
  } finally {
    dom.window.close()
  }
}

test.each([
  {
    name: 'a hidden kept-alive Sessions viewport cannot replace the foreground Bot tile',
    html: `<div style="visibility: hidden"><div data-chat-surface data-stored-session-id="ordinary">
      <div data-slot="aui_thread-viewport"><div data-slot="aui_user-message-root">U1-old ordinary</div></div>
    </div></div><div data-chat-surface data-bot-chat data-session-anchor="session-tile:p2-chat" data-stored-session-id="p2-chat">
      <div data-slot="aui_thread-viewport"><div data-slot="aui_user-message-root">U9-p2 foreground</div></div>
    </div>`,
    want: { text: 'U9-p2 foreground', userBubbles: ['U9-p2 foreground'] }
  },
  {
    name: 'matching text in a hidden owner cannot authorize a different foreground owner',
    html: `<div style="visibility: hidden" data-chat-surface data-stored-session-id="p2-chat">
      <div data-slot="aui_thread-viewport"><div data-slot="aui_user-message-root">U9-p2 same words</div></div>
    </div><div data-chat-surface data-stored-session-id="foreign-chat">
      <div data-slot="aui_thread-viewport"><div data-slot="aui_user-message-root">U9-p2 same words</div></div>
    </div>`,
    want: { text: '', userBubbles: [] }
  },
  {
    name: 'an ambiguous visible owner cannot be chosen merely because its id matches',
    html: `<div data-chat-surface data-stored-session-id="p2-chat">
      <div data-slot="aui_thread-viewport">expected owner</div>
    </div><div data-chat-surface data-stored-session-id="other-chat">
      <div data-slot="aui_thread-viewport">another visible owner</div>
    </div>`,
    want: { text: '', userBubbles: [] }
  },
  {
    name: 'a hidden-only owner has no foreground transcript',
    html: `<div style="visibility: hidden" data-chat-surface data-stored-session-id="p2-chat">
      <div data-slot="aui_thread-viewport">retained but not on screen</div>
    </div>`,
    want: { text: '', userBubbles: [] }
  }
])('$name', async ({ html, want }) => {
  expect(await read(html, 'p2-chat')).toEqual(want)
})

test('foreground projection retains duplicate bubbles, their order, and folded process content for the full oracle', async () => {
  const view = await read(`<div data-chat-surface data-stored-session-id="p2-chat">
    <div data-slot="aui_thread-viewport">
      <div data-slot="aui_user-message-root">U13-p2 later</div>
      <div data-slot="aui_user-message-root">U9-p2 first</div>
      <div data-slot="aui_user-message-root">U9-p2 first</div>
      <div hidden>A9i-p2 folded narration</div>
      <div>A9-p2 repeated answer</div><div>A9-p2 repeated answer</div>
    </div>
  </div>`, 'p2-chat')

  expect(view).toEqual({
    text: ' U13-p2 later U9-p2 first U9-p2 first A9i-p2 folded narration A9-p2 repeated answerA9-p2 repeated answer ',
    userBubbles: ['U13-p2 later', 'U9-p2 first', 'U9-p2 first']
  })
})
