import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { isImeComposing } from '@/lib/ime'
import type { ConversationOwner } from '@/store/conversation-owner'

import { acceptsTriggerCompletion, implicitSlashAcceptIndex } from './composer-utils'
import { triggerKeyUpHandler, useComposerTrigger } from './hooks/use-composer-trigger'
import { useComposerUndo } from './hooks/use-composer-undo'
import { useConversationSlashCompletions } from './hooks/use-conversation-slash-completions'
import {
  caretOffsetInEditor,
  composerPlainText,
  deleteChipBeforeCaret,
  deleteSelectionInEditor,
  insertComposerContentsAtCaret,
  normalizeComposerEditorDom,
  placeCaretAtOffset,
  renderComposerContents
} from './rich-editor'
import { ComposerTriggerPopover } from './trigger-popover'
import { isRedoShortcut, isUndoShortcut } from './undo-history'

interface ConversationSlashSuggestionsProps {
  owner: ConversationOwner
  profile: string
  generation: number
  text: string
  input: RefObject<HTMLDivElement | null>
  onChange: (text: string) => void
}

/** Owned draft adapter for the original rich editor, trigger engine and undo history. */
export function ConversationSlashSuggestions({
  owner,
  profile,
  generation,
  text,
  input,
  onChange
}: ConversationSlashSuggestionsProps) {
  const draftRef = useRef(text)
  const composing = useRef<{ base: string } | null>(null)
  const [focused, setFocused] = useState(false)
  const slash = useConversationSlashCompletions(owner, profile, generation, text.includes('/'))

  const sync = useCallback(() => {
    const editor = input.current

    if (!editor) {
      return draftRef.current
    }

    normalizeComposerEditorDom(editor)
    const next = composerPlainText(editor)
    draftRef.current = next
    onChange(next)

    return next
  }, [input, onChange])

  const undo = useComposerUndo({ editorRef: input, syncDraftFromEditor: sync })
  const { resetUndoHistory } = undo

  const trigger = useComposerTrigger({
    at: { adapter: null, loading: false },
    draftRef,
    editorRef: input,
    recordUndoPoint: undo.recordUndoPoint,
    requestMainFocus: () => input.current?.focus(),
    setComposerText: next => {
      draftRef.current = next
      onChange(next)
    },
    slash: { adapter: slash.enabled ? slash.adapter : null, loading: slash.loading }
  })

  useLayoutEffect(() => {
    const editor = input.current

    if (!editor || composing.current || composerPlainText(editor) === text) {
      return
    }

    const caret = caretOffsetInEditor(editor)
    const active = document.activeElement === editor
    renderComposerContents(editor, text)
    draftRef.current = text

    if (active) {
      placeCaretAtOffset(editor, Math.min(caret, text.length))
    }

    resetUndoHistory()
  }, [input, text, resetUndoHistory])
  useEffect(() => {
    trigger.refreshTrigger()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-detect only when the captured discovery owner changes
  }, [owner.connectionId, owner.installId, profile, generation])
  const visible = focused && slash.enabled && trigger.trigger?.kind === '/' && !trigger.argStageEmpty
  // eslint-disable-next-line no-restricted-syntax -- event-owned composition/keyboard refs, never mirrored atom state
  useEffect(() => {
    const editor = input.current

    if (!editor) {
      return
    }

    const refresh = () => trigger.refreshTrigger()

    const focus = () => {
      setFocused(true)
      refresh()
    }

    const blur = () => setFocused(false)

    const start = () => {
      composing.current = { base: composerPlainText(editor) }
    }

    const end = () => {
      const base = composing.current?.base
      composing.current = null
      const composed = composerPlainText(editor)

      if (base !== undefined && text !== base && text !== composed) {
        // Voice appends to the preedit base. Preserve both edits; an unrelated
        // replacement stays separate instead of silently erasing either draft.
        const merged = text.startsWith(base)
          ? composed + text.slice(base.length)
          : composed.startsWith(base)
            ? text + composed.slice(base.length)
            : `${composed}\n${text}`

        renderComposerContents(editor, merged)
        placeCaretAtOffset(editor, merged.length)
      }

      sync()
      refresh()
    }

    const before = (event: Event) => {
      if (!(event as InputEvent).inputType?.startsWith('history')) {
        undo.recordUndoPoint({ coalesce: true })
      }
    }

    const change = () => {
      if (!composing.current) {
        sync()
        refresh()
      }
    }

    const paste = (event: ClipboardEvent) => {
      if (event.clipboardData?.files.length) {
        return
      }

      const value = event.clipboardData?.getData('text/plain')

      if (!value) {
        return
      }

      event.preventDefault()
      undo.recordUndoPoint()
      insertComposerContentsAtCaret(editor, value)
      sync()
      refresh()
    }

    const keydown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) {
        return
      }

      const consume = () => {
        event.preventDefault()
        event.stopPropagation()
        trigger.triggerKeyConsumedRef.current = true
      }

      if (isUndoShortcut(event) || isRedoShortcut(event)) {
        consume()
        isUndoShortcut(event) ? undo.undo() : undo.redo()

        return
      }

      if (
        (event.key === 'Backspace' &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          undo.withUndoPoint(() => deleteChipBeforeCaret(editor))) ||
        ((event.key === 'Backspace' || event.key === 'Delete') &&
          undo.withUndoPoint(() => deleteSelectionInEditor(editor)))
      ) {
        consume()
        sync()
        refresh()

        return
      }

      if (!visible || !trigger.trigger) {
        return
      }

      if (event.key === 'Escape') {
        consume()
        trigger.closeTrigger()

        return
      }

      if (!trigger.triggerItems.length || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        consume()
        trigger.moveTriggerActive(event.key === 'ArrowDown' ? 1 : -1)

        return
      }

      if (
        !acceptsTriggerCompletion({
          activeExplicit: trigger.triggerActiveExplicit,
          freeTextArgStage: trigger.slashFreeTextArgStage,
          key: event.key,
          kind: '/',
          query: trigger.trigger.query
        })
      ) {
        return
      }

      const index =
        event.key === 'Tab'
          ? trigger.triggerActive
          : implicitSlashAcceptIndex(
              trigger.trigger.query,
              trigger.triggerItems.map(item => String(item.metadata?.command || item.metadata?.rawText || item.label)),
              trigger.triggerActive,
              trigger.triggerActiveExplicit
            )

      const item = trigger.triggerItems[index ?? -1]

      if (item) {
        consume()
        trigger.replaceTriggerWithChip(item)
      }
    }

    const keyup = triggerKeyUpHandler(trigger.triggerKeyConsumedRef, refresh)
    editor.addEventListener('focus', focus)
    editor.addEventListener('blur', blur)
    editor.addEventListener('compositionstart', start)
    editor.addEventListener('compositionend', end)
    editor.addEventListener('beforeinput', before)
    editor.addEventListener('input', change)
    editor.addEventListener('paste', paste)
    editor.addEventListener('keydown', keydown, true)
    editor.addEventListener('keyup', keyup)
    editor.addEventListener('mouseup', refresh)
    setFocused(document.activeElement === editor)

    return () => {
      editor.removeEventListener('focus', focus)
      editor.removeEventListener('blur', blur)
      editor.removeEventListener('compositionstart', start)
      editor.removeEventListener('compositionend', end)
      editor.removeEventListener('beforeinput', before)
      editor.removeEventListener('input', change)
      editor.removeEventListener('paste', paste)
      editor.removeEventListener('keydown', keydown, true)
      editor.removeEventListener('keyup', keyup)
      editor.removeEventListener('mouseup', refresh)
    }
  }, [input, trigger, sync, undo, visible, text])

  return visible ? (
    <ComposerTriggerPopover
      activeIndex={trigger.triggerActive}
      items={trigger.triggerItems}
      kind="/"
      loading={trigger.triggerLoading}
      onHover={index => trigger.moveTriggerActive(index - trigger.triggerActive)}
      onPick={trigger.replaceTriggerWithChip}
    />
  ) : null
}
