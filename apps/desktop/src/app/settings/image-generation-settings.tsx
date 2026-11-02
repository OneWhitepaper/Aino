import { useState } from 'react'

import type { ProfileScope } from '@/hermes'
import { useI18n } from '@/i18n'
import { ImageIcon } from '@/lib/icons'

import { SettingsDisclosure } from './primitives'
import { SETTING_IDS, settingElementId } from './settings-manifest'
import { ToolsetConfigPanel } from './toolset-config-panel'
import { useDeepLinkHighlight } from './use-deep-link-highlight'

export function ImageGenerationSettings({ profile }: { profile?: ProfileScope }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const copy = t.settings.model.imageGeneration
  useDeepLinkHighlight({
    param: 'setting',
    ready: target => target === SETTING_IDS.model.imageGeneration,
    elementId: settingElementId,
    onResolve: () => setExpanded(true)
  })

  return (
    <SettingsDisclosure
      expanded={expanded}
      icon={ImageIcon}
      label={copy.title}
      onToggle={() => setExpanded(value => !value)}
      sectionId={settingElementId(SETTING_IDS.model.imageGeneration)}
    >
      <p className="mb-3 text-xs text-muted-foreground">{copy.description}</p>
      <ToolsetConfigPanel profile={profile} toolset="image_gen" />
    </SettingsDisclosure>
  )
}
