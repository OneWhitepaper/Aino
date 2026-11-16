import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearSessionDraft, mainComposerScope, stashSessionDraft } from '@/store/composer'

import { markActiveComposer, requestComposerInsert } from '../focus'
import { routeClipboardToComposer } from '../paste-to-focus'
import { composerPlainText, RICH_INPUT_SLOT } from '../rich-editor'

import { useComposerDraft } from './use-composer-draft'

const composer = { setText: vi.fn() }

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ composer: () => composer }),
  useAuiState: (selector: (state: { composer: { text: string } }) => unknown) => selector({ composer: { text: '' } }),
  useComposerRuntime: () => ({ getState: () => ({ text: '' }), subscribe: () => () => undefined })
}))

const SCOPE = 'paste-original-format'
let draft: ReturnType<typeof useComposerDraft>

function Harness() {
  draft = useComposerDraft({
    activeQueueSessionKey: SCOPE,
    focusKey: null,
    inputDisabled: false,
    queueEditRef: { current: null },
    sessionId: SCOPE
  })

  return <div contentEditable data-slot={RICH_INPUT_SLOT} ref={draft.editorRef} suppressContentEditableWarning />
}

afterEach(() => {
  cleanup()
  mainComposerScope.clear()
  clearSessionDraft(SCOPE)
  markActiveComposer('main')
  vi.clearAllMocks()
})

const settleBus = () => new Promise(resolve => window.setTimeout(resolve, 5))

describe('unfocused clipboard paste preserves the editable draft', () => {
  it('keeps the existing trailing newline and clipboard indentation through the actual insert bus', async () => {
    const before = 'Explain this:\n'
    const pasted = '    first line\n\tsecond line  \n\n'
    stashSessionDraft(SCOPE, before, [])
    render(<Harness />)

    const clipboard = {
      files: [],
      getData: (type: string) => (type === 'text' || type === 'text/plain' ? pasted : ''),
      items: []
    } as unknown as DataTransfer

    await act(async () => {
      expect(routeClipboardToComposer(clipboard)).toBe(true)
      await settleBus()
    })

    expect(draft.draftRef.current).toBe(before + pasted)
    expect(composerPlainText(draft.editorRef.current!)).toBe(before + pasted)
    expect(composer.setText).toHaveBeenLastCalledWith(before + pasted)
  })

  it.each([
    ['```sh\n', '@src/main.ts https://example.com /some-skill', '@src/main.ts https://example.com /some-skill'],
    ['See: ', 'https://example.com', '@url:`https://example.com`']
  ])('interprets clipboard contents in the destination draft context: %s', async (before, pasted, expected) => {
    stashSessionDraft(SCOPE, before, [])
    render(<Harness />)
    await act(async () => {
      routeClipboardToComposer({ files: [], items: [], getData: () => pasted } as unknown as DataTransfer)
      await settleBus()
    })
    expect(draft.draftRef.current).toBe(before + expected)
    expect(composerPlainText(draft.editorRef.current!)).toBe(before + expected)
  })

  it('keeps the existing inline insert spacing contract for menu and plugin callers', async () => {
    stashSessionDraft(SCOPE, 'Existing text\n', [])
    render(<Harness />)

    await act(async () => {
      requestComposerInsert('  snippet\n', { mode: 'inline' })
      await settleBus()
    })

    expect(draft.draftRef.current).toBe('Existing text snippet')
  })
})
