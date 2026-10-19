import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { $accentOverride, setAccentOverride } from './accent-override'
import { ThemeProvider, useTheme } from './context'
import { persistAccent } from './persist-accent'
import { $userThemes } from './user-themes'

let theme: ReturnType<typeof useTheme>

function Probe() { theme = useTheme();

 return null }

afterEach(cleanup)

it('keeps the neutral palette and stored assets when an older accent card submits a color', () => {
  render(<ThemeProvider><Probe /></ThemeProvider>)
  const colors = theme.theme.colors
  const assets = $userThemes.get()
  act(() => { setAccentOverride('#8a2be2'); persistAccent('#8a2be2') })
  expect(theme.themeName).toBe('mono')
  expect(theme.theme.colors).toEqual(colors)
  expect($userThemes.get()).toBe(assets)
  expect($accentOverride.get()).toBeNull()
})
