import {
  type AppendMessage,
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  type ThreadMessage
} from '@assistant-ui/react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestComposerInsert } from '@/app/chat/composer/focus'
import { composerPlainText } from '@/app/chat/composer/rich-editor'
import { useIncrementalExternalStoreRuntime } from '@/lib/incremental-external-store-runtime'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, userMessage } from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()
stubThreadViewportSize()
afterEach(cleanup)

function Harness({ onEdit }: { onEdit: (message: AppendMessage) => Promise<void> }) {
  const runtime = useIncrementalExternalStoreRuntime<ThreadMessage>({
    messageRepository: ExportedMessageRepository.fromArray([userMessage(), assistantMessage()]),
    isRunning: false,
    setMessages: () => {},
    onNew: async () => {},
    onEdit,
    onCancel: async () => {},
    onReload: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  )
}

async function openEdit(onEdit = vi.fn(async (_message: AppendMessage) => {})) {
  render(<Harness onEdit={onEdit} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit message' }))
  const editor = await screen.findByRole('textbox', { name: 'Edit message' })

  editor.tabIndex = 0
  editor.focus()

  return { editor, onEdit }
}

describe('editable pasted source in a user message', () => {
  it('keeps the existing line break and pasted boundary whitespace through the insert bus', async () => {
    const { editor, onEdit } = await openEdit()
    editor.textContent = 'intro\n'
    fireEvent.input(editor)
    const pasted = '    code\tvalue  \n\n'

    await act(async () => {
      requestComposerInsert(pasted, { mode: 'verbatim', target: 'edit' })
      await new Promise(resolve => window.setTimeout(resolve, 10))
    })

    expect(composerPlainText(editor)).toBe(`intro\n${pasted}`)
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(onEdit).toHaveBeenCalledOnce())
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ text: `intro\n${pasted}`, type: 'text' }] })
    )
  })

  it('sends pasted code and table source without converting their references into chips', async () => {
    const { editor, onEdit } = await openEdit()
    editor.replaceChildren()
    fireEvent.input(editor)

    const pasted =
      '\n```txt\n\t@src/index.ts  \n```\n| Path | URL |\n| --- | --- |\n| @src/index.ts | https://example.com/a|\n\n'

    fireEvent.paste(editor, { clipboardData: { getData: () => pasted } })

    expect(composerPlainText(editor)).toBe(pasted)
    expect(editor.querySelector('[data-ref-text]')).toBeNull()
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(onEdit).toHaveBeenCalledOnce())
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ content: [{ text: pasted, type: 'text' }] }))
  })
})
