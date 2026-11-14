import { localizedPluginMetadata } from '@/contrib/plugin-metadata'
import { $pluginRecords } from '@/contrib/plugins-store'
import type { ContributionSource } from '@/contrib/types'

import type { Locale, Translations } from './types'

type CoreSource = ContributionSource | undefined

const isCoreContribution = (source: CoreSource): boolean => source === undefined || source === 'core'

const PANE_TITLE_KEYS = {
  files: 'files',
  logs: 'logs',
  review: 'review',
  sessions: 'sessions',
  terminal: 'terminal'
} as const

const PALETTE_LABELS: Record<string, (t: Translations) => string> = {
  'keybinds.panel': t => t.commandCenter.contributedActions.keyboardShortcuts,
  'layout.reset': t => t.commandCenter.contributedActions.resetLayout,
  'logs.toggle': t => t.commandCenter.contributedActions.toggleLogs,
  'plugins.reload': t => t.commandCenter.contributedActions.reloadPlugins,
  'profile.export': t => t.commandCenter.contributedActions.exportProfile,
  'profile.import': t => t.commandCenter.contributedActions.importProfile,
  'session.yolo': t => t.commandCenter.contributedActions.toggleYolo,
  'view.showTerminal': t => t.commandCenter.contributedActions.toggleTerminal,
  'view.toggleTabStrip': t => t.commandCenter.contributedActions.toggleTabs,
  'strip-tab.files': t => t.zones.toggleStripTab(t.zones.paneTitles.files),
  'strip-tab.logs': t => t.zones.toggleStripTab(t.zones.paneTitles.logs),
  'strip-tab.review': t => t.zones.toggleStripTab(t.zones.paneTitles.review),
  'strip-tab.sessions': t => t.zones.toggleStripTab(t.zones.paneTitles.sessions),
  'strip-tab.terminal': t => t.zones.toggleStripTab(t.zones.paneTitles.terminal)
}

// Hide-only panes are registered dynamically by the core controller. Their
// labels carry the pane title in the stable `Toggle <title> tab` shape, while
// the contribution id includes the pane's runtime id. Resolve that generated
// core copy through the locale without maintaining a hardcoded entry for each
// plugin-provided hide-only pane.
const DYNAMIC_STRIP_TAB_LABEL = /^Toggle (.+) tab$/

/**
 * Resolve a pane's visible title without translating plugin or user-provided
 * names. Core pane ids are stable protocol values; their registered English
 * titles are only fallbacks for non-core locales or older callers.
 */
export function localizedPaneTitle(
  translations: Translations,
  paneId: string,
  fallback: string,
  source: CoreSource,
  locale?: Locale
): string {
  if (isCoreContribution(source)) {
    const key = PANE_TITLE_KEYS[paneId as keyof typeof PANE_TITLE_KEYS]

    return key ? translations.zones.paneTitles[key] : fallback
  }

  // Plugin panes are author-owned by default. A plugin that explicitly ships
  // locale metadata has opted into translating its public name, so use that
  // metadata for the pane chrome as well as the settings inventory. Unknown
  // plugins (and callers that predate the locale argument) keep their title.
  if (locale && source?.startsWith('plugin:')) {
    const pluginId = source.slice('plugin:'.length)
    const record = $pluginRecords.get()[pluginId]

    if (record) {
      return localizedPluginMetadata(record, locale).name
    }
  }

  return fallback
}

/** Resolve a core command-palette contribution against the current locale.
 * Unknown/plugin contributions intentionally keep their registered label. */
export function localizedPaletteLabel(
  translations: Translations,
  contributionId: string,
  fallback: string,
  source: CoreSource
): string {
  if (!isCoreContribution(source)) {
    return fallback
  }

  const known = PALETTE_LABELS[contributionId]

  if (known) {
    return known(translations)
  }

  if (contributionId.startsWith('strip-tab.')) {
    const match = DYNAMIC_STRIP_TAB_LABEL.exec(fallback)

    if (match?.[1]) {
      return translations.zones.toggleStripTab(match[1])
    }
  }

  return fallback
}

/** Translate the binary state note emitted by `paletteToggle`. Other detail
 * strings are owned by their contribution and pass through untouched. */
export function localizedPaletteDetail(translations: Translations, detail: string | undefined): string | undefined {
  if (detail === 'on') {
    return translations.common.on
  }

  if (detail === 'off') {
    return translations.common.off
  }

  return detail
}
