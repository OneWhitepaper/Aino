// @vitest-environment jsdom
import { AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { mainComposerScope } from '@/store/composer'

import { composerPlainText, normalizeComposerEditorDom, renderComposerContents, RICH_INPUT_SLOT } from './rich-editor'
import { placeCaretAtEnd } from './test-utils'
import type { ChatBarProps, ChatBarState } from './types'

import { ChatBar } from './index'

const state: ChatBarState = {
  model: { canSwitch: false, model: '', provider: '' },
  tools: { enabled: false, label: '' },
  voice: { enabled: false, active: false }
}

function Harness({
  onSubmit,
  onAttachPastedText,
  sessionId
}: Pick<ChatBarProps, 'onSubmit' | 'onAttachPastedText' | 'sessionId'>) {
  const runtime = useExternalStoreRuntime({
    convertMessage: (message: ThreadMessageLike) => message,
    isRunning: false,
    messages: [] as ThreadMessageLike[],
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <ChatBar
            busy={false}
            disabled={false}
            gateway={null}
            onAttachPastedText={onAttachPastedText}
            onCancel={vi.fn()}
            onSubmit={onSubmit}
            sessionId={sessionId}
            state={state}
          />
        </I18nProvider>
      </MemoryRouter>
    </AssistantRuntimeProvider>
  )
}

let sessionCounter = 0

function setup(onAttachPastedText?: ChatBarProps['onAttachPastedText']) {
  const onSubmit = vi.fn(async (text: string) => text.length > 0)

  const view = render(
    <Harness
      onAttachPastedText={onAttachPastedText}
      onSubmit={onSubmit}
      sessionId={`paste-format-${++sessionCounter}`}
    />
  )

  const editor = view.container.querySelector<HTMLElement>(`[data-slot="${RICH_INPUT_SLOT}"]`)!
  Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
  editor.focus()
  placeCaretAtEnd(editor)

  return { ...view, editor, onSubmit }
}

function paste(editor: HTMLElement, text: string) {
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => (type === 'text' || type === 'text/plain' ? text : ''),
      files: [],
      items: []
    }
  })
}

afterEach(() => {
  cleanup()
  mainComposerScope.clear()
})

describe('clipboard source formatting', () => {
  it('preserves indentation, tabs, blank lines and trailing spaces through send', async () => {
    const { editor, onSubmit } = setup()
    const source = '\n    first  column\n\tsecond\tcolumn  \n\n'
    paste(editor, source)

    expect(composerPlainText(editor)).toBe(source)
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toBe(source)
  })

  it('keeps Markdown tables and code editable without converting their literals to chips', async () => {
    const { editor, onSubmit } = setup()

    const source =
      '| action | source |\n| --- | --- |\n| /some-skill | https://example.com/page|\n| ref | @file:src/main.ts |\n\n```sh\n    @src/main.ts\n/some-skill\n```\n'

    paste(editor, source)

    expect(composerPlainText(editor)).toBe(source)
    expect(editor.querySelector('[data-ref-text]')).toBeNull()
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toBe(source)
  })

  it('keeps source pasted into an existing code block editable', () => {
    const { editor } = setup()
    renderComposerContents(editor, '```sh\n')
    placeCaretAtEnd(editor)
    const source = '@src/main.ts https://example.com /some-skill'
    paste(editor, source)
    expect(composerPlainText(editor)).toBe('```sh\n' + source)
    expect(editor.querySelector('[data-ref-text]')).toBeNull()
  })

  it('replaces a table header cell while keeping its URL source editable', () => {
    const { editor } = setup()
    renderComposerContents(editor, 'name | old\n--- | ---\none | value\n')
    const selection = window.getSelection()!
    selection.setBaseAndExtent(editor.firstChild!, 7, editor.firstChild!, 10)
    paste(editor, 'https://example.com/a')
    expect(composerPlainText(editor)).toBe('name | https://example.com/a\n--- | ---\none | value\n')
    expect(editor.querySelector('[data-ref-text]')).toBeNull()
  })

  it('replaces the selection in place and restores it with undo and redo', () => {
    const { editor } = setup()
    renderComposerContents(editor, 'before old after')
    const selection = window.getSelection()!
    selection.setBaseAndExtent(editor.firstChild!, 7, editor.firstChild!, 10)
    paste(editor, '  new\n\trow  ')
    expect(composerPlainText(editor)).toBe('before   new\n\trow   after')

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })
    expect(composerPlainText(editor)).toBe('before old after')
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(composerPlainText(editor)).toBe('before   new\n\trow   after')
  })

  it('keeps the full source when large-paste attachment creation fails', async () => {
    const attach = vi.fn(async () => false)
    const { editor } = setup(attach)
    const source = `\n    ${'long  source\n'.repeat(300)}\n`
    paste(editor, source)

    await waitFor(() => expect(composerPlainText(editor)).toBe(source))
    expect(attach).toHaveBeenCalledWith(source)
  })

  it('retains deliberate newlines after a pasted URL through normalization and draft repaint', () => {
    const { editor } = setup()
    paste(editor, 'https://example.com\n')
    normalizeComposerEditorDom(editor)
    const text = composerPlainText(editor)
    expect(text).toBe('@url:`https://example.com`\n')
    renderComposerContents(editor, text)
    normalizeComposerEditorDom(editor)
    expect(composerPlainText(editor)).toBe(text)
  })
})
