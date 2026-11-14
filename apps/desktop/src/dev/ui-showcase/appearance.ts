import { ensureContrast } from '@hermes/shared/color'

import { DEFAULT_TYPOGRAPHY, monoTheme } from '@/themes/presets'

/** Paint only this preview document; desktop preferences and native windows remain untouched. */
export function applyShowcaseAppearance(dark: boolean): void {
  const root = document.documentElement
  const colors = dark ? (monoTheme.darkColors ?? monoTheme.colors) : monoTheme.colors

  const tokens: Record<string, string> = {
    '--theme-foreground': colors.foreground,
    '--theme-primary': colors.primary,
    '--theme-secondary': colors.secondary,
    '--theme-accent-soft': colors.accent,
    '--theme-midground': colors.midground ?? colors.ring,
    '--theme-warm': colors.primary,
    '--theme-background-seed': colors.background,
    '--theme-sidebar-seed': colors.sidebarBackground ?? colors.background,
    '--theme-card-seed': colors.card,
    '--theme-elevated-seed': colors.popover,
    '--theme-bubble-seed': colors.userBubble ?? colors.popover,
    '--theme-mix-chrome': dark ? '74%' : '92%',
    '--theme-mix-sidebar': '100%',
    '--theme-mix-card': dark ? '38%' : '22%',
    '--theme-mix-elevated': dark ? '46%' : '28%',
    '--theme-mix-bubble': dark ? '46%' : '0%',
    '--dt-primary-foreground': colors.primaryForeground,
    '--dt-primary-solid': ensureContrast(colors.primary, '#ffffff', 4.5),
    '--dt-primary-solid-foreground': '#ffffff',
    '--dt-secondary-foreground': colors.secondaryForeground,
    '--dt-accent-foreground': colors.accentForeground,
    '--dt-border': colors.border,
    '--dt-input': colors.input,
    '--dt-ring': colors.ring,
    '--dt-muted': colors.muted,
    '--dt-muted-foreground': colors.mutedForeground,
    '--dt-midground-foreground': colors.midgroundForeground ?? colors.primaryForeground,
    '--dt-composer-ring': colors.composerRing ?? colors.midground ?? colors.ring,
    '--dt-destructive': colors.destructive,
    '--dt-destructive-foreground': colors.destructiveForeground,
    '--dt-sidebar-border': colors.sidebarBorder ?? colors.border,
    '--dt-user-bubble-border': colors.userBubbleBorder ?? colors.border,
    '--dt-font-sans': DEFAULT_TYPOGRAPHY.fontSans,
    '--dt-font-mono': DEFAULT_TYPOGRAPHY.fontMono,
    '--noise-opacity-mul': dark ? 'calc(0.04 / 0.21)' : 'calc(0.34 / 0.21)'
  }

  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.style.backgroundColor = colors.background
  root.dataset.uiShowcaseMode = dark ? 'dark' : 'light'

  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value)
  }
}
