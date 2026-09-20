import { cleanup, fireEvent, render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { ComposerInputSurface } from './input-surface'
import { ComposerSubmitButton } from './submit-button'

afterEach(cleanup)
it('preserves rich editor ref/event ownership and shares the native submit callback with the plain input controller', () => {
  const editor = createRef<HTMLDivElement>()
  const onInput = vi.fn()
  const onChange = vi.fn()
  const onSubmit = vi.fn()
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <ComposerInputSurface
        aria-label="Rich"
        contentEditable
        kind="rich"
        onInput={onInput}
        ref={editor}
        suppressContentEditableWarning
      />
      <form
        onSubmit={event => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <ComposerInputSurface aria-label="Plain" kind="plain" onChange={onChange} />
        <ComposerSubmitButton />
      </form>
    </I18nProvider>
  )
  const rich = screen.getByRole('textbox', { name: 'Rich' })
  expect(editor.current).toBe(rich)
  rich.textContent = 'Rich text'
  fireEvent.input(rich)
  expect(onInput).toHaveBeenCalledOnce()
  fireEvent.change(screen.getByRole('textbox', { name: 'Plain' }), { target: { value: 'Plain text' } })
  expect(onChange).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(onSubmit).toHaveBeenCalledOnce()
})
