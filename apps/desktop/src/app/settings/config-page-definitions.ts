import { configSubpageForField } from './config-subpages'
import { settingsSubpageForTarget } from './subpages'
import type { SettingsView } from './types'

export const CONFIG_PAGE_CATEGORIES = {
  chat: [
    { id: 'behavior', label: 'chatReply' },
    { id: 'attachments', label: 'chatAttachments' }
  ],
  safety: [
    { id: 'approvals', label: 'safetyApprovals' },
    { id: 'privacy', label: 'safetyPrivacy' },
    { id: 'checkpoints', label: 'safetyCheckpoints' },
    { id: 'vault', label: 'safetyVault' }
  ],
  browser: [
    { id: 'profile', label: 'browserProfile' },
    { id: 'network', label: 'browserNetwork' }
  ],
  memory: [
    { id: 'persistent', label: 'memoryPersistent' },
    { id: 'context', label: 'memoryContext' }
  ],
  voice: [
    { id: 'conversation', label: 'voiceConversation' },
    { id: 'transcription', label: 'voiceTranscription' },
    { id: 'speech', label: 'voiceSpeech' }
  ],
  advanced: [
    { id: 'desktop', label: 'advancedDesktop' },
    { id: 'runtime', label: 'advancedRuntime' },
    { id: 'output', label: 'advancedOutput' },
    { id: 'keys', label: 'advancedKeys' }
  ]
} as const

export type ConfigPageSection = keyof typeof CONFIG_PAGE_CATEGORIES

export function isConfigPageSection(section: string): section is ConfigPageSection {
  return Object.hasOwn(CONFIG_PAGE_CATEGORIES, section)
}

export function configPageCategory(section: ConfigPageSection, category: string | undefined): string | undefined {
  if (section === 'advanced' && (category === 'tools' || category === 'terminal')) {
    return 'runtime'
  }

  return category
}

/** Existing field and credential links select their category before a highlighter consumes them. */
export function configPageTarget(section: ConfigPageSection, params: URLSearchParams): string {
  const field = params.get('field')
  const setting = params.get('setting')

  let requested = field
    ? configSubpageForField(section, field)
    : setting
      ? settingsSubpageForTarget(`config:${section}` as SettingsView, undefined, setting)
      : undefined

  if (section === 'safety' && ['vault', 'kind', 'label', 'origin'].some(key => params.has(key))) {
    requested = 'vault'
  }

  if (section === 'advanced' && params.has('key')) {
    requested = 'keys'
  }

  requested = configPageCategory(section, requested ?? params.get('page') ?? undefined)

  return (
    CONFIG_PAGE_CATEGORIES[section].find(page => page.id === requested)?.id ?? CONFIG_PAGE_CATEGORIES[section][0].id
  )
}
