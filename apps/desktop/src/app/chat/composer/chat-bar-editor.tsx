import { ComposerPrimitive } from '@assistant-ui/react'
import type { ComponentProps, RefObject } from 'react'

import { cn } from '@/lib/utils'

import { composerInputWidthClass } from './composer-utils'
import { ComposerDirectiveActions } from './directive-actions'
import { RICH_INPUT_SLOT } from './rich-editor'
import { composerTextEntryProps } from './touch-text-entry'

interface ComposerEditorProps {
  editorProps: ComponentProps<'div'>
  editorRef: RefObject<HTMLDivElement | null>
  hudNativeDrag: boolean
  inputDisabled: boolean
  placeholder: string
  stacked: boolean
  touchPointer: boolean
}

export function ComposerEditor({
  editorProps,
  editorRef,
  hudNativeDrag,
  inputDisabled,
  placeholder,
  stacked,
  touchPointer
}: ComposerEditorProps) {
  const inputWidthClass = composerInputWidthClass(stacked)

  return (
    <div className={cn('relative', inputWidthClass)}>
      <div
        aria-disabled={inputDisabled ? true : undefined}
        {...composerTextEntryProps(touchPointer)}
        {...editorProps}
        className={cn(
          'min-h-[1.625rem] min-h-(--composer-input-min-height) max-h-(--composer-input-max-height) cursor-text overflow-y-auto whitespace-pre-wrap [tab-size:4] break-words [overflow-wrap:anywhere] bg-transparent pb-1 pr-1 pt-1 leading-normal text-foreground outline-none disabled:cursor-not-allowed',
          '**:data-ref-text:cursor-default',
          stacked && 'pl-3',
          inputWidthClass,
          // Inside the native Wayland HUD drag region: a drag region swallows
          // the page's mouse input whole, so the input must opt back out or it
          // becomes unclickable. Buttons use the global no-drag rule.
          hudNativeDrag && '[-webkit-app-region:no-drag]'
        )}
        contentEditable={!inputDisabled}
        data-placeholder={placeholder}
        data-slot={RICH_INPUT_SLOT}
        ref={editorRef}
        role="textbox"
        suppressContentEditableWarning
      />
      <ComposerDirectiveActions editorRef={editorRef} />
      {/* assistant-ui requires ComposerPrimitive.Input somewhere in the tree
        so the composer-state binding (text + IME + paste + form-submit hookup)
        wires up. We render the real input UI ourselves above via the
        contentEditable, so the primitive is invisible (sr-only).

        IMPORTANT: don't let it render its default <TextareaAutosize>. That
        component runs `useLayoutEffect(resizeTextarea)` on every value change
        and reads `node.scrollHeight` against a hidden measurement textarea,
        forcing two synchronous layouts per keystroke for an element the
        user can't see. Profiling 400-char synthetic typing showed >900ms
        cumulative cost in getHeight2/calculateNodeHeight alone (~2.3ms/key)
        on top of the per-keystroke React commit.

        `asChild` swaps TextareaAutosize for a Radix Slot wrapping our
        plain <textarea>, which carries the binding but skips autosize. */}
      <ComposerStateInput />
    </div>
  )
}

/** Bind assistant-ui state without mounting its hidden autosizing textarea. */
function ComposerStateInput() {
  return (
    <ComposerPrimitive.Input asChild submitMode="ctrlEnter" tabIndex={-1} unstable_focusOnScrollToBottom={false}>
      <textarea
        aria-hidden
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="sr-only"
        spellCheck={false}
        tabIndex={-1}
      />
    </ComposerPrimitive.Input>
  )
}
