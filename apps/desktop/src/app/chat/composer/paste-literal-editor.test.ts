import { afterEach, describe, expect, it } from 'vitest'

import { pathifyRefs } from './path-refs'
import {
  composerPlainText,
  insertComposerContentsAtCaret,
  normalizeComposerEditorDom,
  renderComposerContents,
  RICH_INPUT_SLOT
} from './rich-editor'
import { placeCaretAtEnd } from './test-utils'
import { linkifyUrls } from './url-refs'

afterEach(() => document.body.replaceChildren())

describe('editable literal source', () => {
  it.each([
    '```sh\n@src/main.ts\n@file:src/main.ts\n/some-skill\nhttps://example.com\n```\n',
    '| task | source |\n| --- | --- |\n| /some-skill | https://example.com/page|\n| ref | @file:src/main.ts |\n',
    '    @src/main.ts\n\thttps://example.com\n',
    'name | source\n--- | ---\none | @src/a.ts\ntwo | @file:src/b.ts\nthree | https://example.com/a\n',
    'name\turl\nskill\thttps://example.com\nfile\t@src/main.ts\n',
    '`@src/main.ts` and `@file:src/main.ts`'
  ])('keeps code and table source as editable text: %s', source => {
    const editor = document.createElement('div')
    editor.dataset.slot = RICH_INPUT_SLOT
    const text = pathifyRefs(linkifyUrls(source))
    expect(text).toBe(source)
    renderComposerContents(editor, text, { trailingCommitted: true })
    normalizeComposerEditorDom(editor)
    expect(composerPlainText(editor)).toBe(source)
    expect(editor.querySelector('[data-ref-text]')).toBeNull()
  })

  it('does not paste the empty editor scaffolding into the source', () => {
    const editor = document.createElement('div')
    editor.dataset.slot = RICH_INPUT_SLOT
    document.body.append(editor)
    normalizeComposerEditorDom(editor)
    placeCaretAtEnd(editor)
    insertComposerContentsAtCaret(editor, 'hello\n')
    normalizeComposerEditorDom(editor)
    expect(composerPlainText(editor)).toBe('hello\n')
  })

  it.each(['\n', ' \t\n', '@url:`https://example.com`\n'])(
    'preserves intentional line breaks on repaint: %j',
    source => {
      const editor = document.createElement('div')
      editor.dataset.slot = RICH_INPUT_SLOT
      renderComposerContents(editor, source)
      normalizeComposerEditorDom(editor)
      expect(composerPlainText(editor)).toBe(source)
    }
  )
})
