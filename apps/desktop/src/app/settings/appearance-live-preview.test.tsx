// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $chatTextScale, setChatTextScale } from '@/store/chat-text-scale'
import { $fileBrowserOpen, setFileBrowserOpen } from '@/store/layout'
import { $reasoningCollapsedByDefault, setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $tabStripDefault, setTabStripDefault } from '@/store/tabstrip-prefs'
import { $hideCodeDiffs, $toolViewMode, setHideCodeDiffs, setToolViewMode } from '@/store/tool-view'
import { $zoomPercent } from '@/store/zoom'

import { AppearanceLivePreview } from './appearance-live-preview'

const initial = {
  files: $fileBrowserOpen.get(),
  reasoning: $reasoningCollapsedByDefault.get(),
  scale: $chatTextScale.get(),
  tabs: $tabStripDefault.get(),
  hideDiffs: $hideCodeDiffs.get(),
  tools: $toolViewMode.get(),
  zoom: $zoomPercent.get()
}

beforeEach(() => {
  act(() => {
    setChatTextScale(110)
    setFileBrowserOpen(false)
    setReasoningCollapsedByDefault(false)
    setTabStripDefault('auto')
    setHideCodeDiffs(false)
    setToolViewMode('product')
    $zoomPercent.set(100)
  })
})

afterEach(() => {
  cleanup()
  act(() => {
    setChatTextScale(initial.scale)
    setFileBrowserOpen(initial.files)
    setReasoningCollapsedByDefault(initial.reasoning)
    setTabStripDefault(initial.tabs)
    setHideCodeDiffs(initial.hideDiffs)
    setToolViewMode(initial.tools)
    $zoomPercent.set(initial.zoom)
  })
})

function preview(variant: 'theme' | 'layout' | 'chat') {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <AppearanceLivePreview variant={variant} />
    </I18nProvider>
  )
}

it('reflects chat scale independently of window zoom and never starts a real conversation', () => {
  const { container } = preview('theme')
  const surface = container.querySelector<HTMLElement>('[data-appearance-preview]')!

  act(() => setChatTextScale(150))

  expect(surface.style.getPropertyValue('--appearance-preview-text-scale')).toBe('1.5')
  expect($zoomPercent.get()).toBe(100)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('button', { name: /send/i })).toBeNull()
})

it('updates layout and display samples immediately from existing settings stores', () => {
  const { container } = preview('layout')
  expect(container.querySelector('[data-preview-tabs]')).not.toBeNull()
  expect(container.querySelector('[data-preview-files]')).toBeNull()

  act(() => {
    setFileBrowserOpen(true)
    setTabStripDefault('never')
    setToolViewMode('technical')
    setHideCodeDiffs(true)
    setReasoningCollapsedByDefault(true)
  })

  expect(container.querySelector('[data-preview-files]')).not.toBeNull()
  expect(container.querySelector('[data-preview-tabs]')).toBeNull()
  expect(container.querySelector('[data-preview-technical]')).not.toBeNull()
  expect(container.querySelector('[data-preview-diff]')).toBeNull()
  expect(container.querySelector<HTMLDetailsElement>('[data-preview-reasoning]')?.open).toBe(false)
})
