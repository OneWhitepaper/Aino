import { useStore } from '@nanostores/react'
import { useId, useState } from 'react'

import { ProfileRail } from '@/app/chat/sidebar/profile-switcher'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { $profileScope, ALL_PROFILES, setShowAllProfiles } from '@/store/profile'

export function WorkspaceControls() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const scope = useStore($profileScope)
  const id = useId()

  return (
    <div className="min-w-0" data-workspace-profile-controls="">
      <Button
        aria-controls={id}
        aria-expanded={open}
        className="w-full justify-start"
        onClick={() => setOpen(!open)}
        size="sm"
        variant="ghost"
      >
        <Codicon name="layers" size="0.875rem" />
        <span className="min-w-0 flex-1 truncate text-left">{t.profiles.advanced}</span>
        <Codicon name={open ? 'chevron-up' : 'chevron-down'} size="0.75rem" />
      </Button>
      {open && (
        <div className="flex flex-col gap-2 px-1 py-2" id={id}>
          <ProfileRail />
          <label className="flex items-center justify-between gap-2 text-xs text-(--ui-text-secondary)">
            {t.profiles.allProfiles}
            <Switch
              aria-label={t.profiles.allProfiles}
              checked={scope === ALL_PROFILES}
              onCheckedChange={setShowAllProfiles}
            />
          </label>
        </div>
      )}
    </div>
  )
}
