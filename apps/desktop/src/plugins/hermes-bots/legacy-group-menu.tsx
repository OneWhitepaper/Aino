import {
  Button, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@hermes/plugin-sdk'

import { useBots } from './i18n'

interface LegacyGroupMenuProps {
  onDisband: () => void
  onMembers: () => void
  onSettings: () => void
}

/** One named entrance to the retained room's existing management dialogs. */
export function LegacyGroupMenu({ onDisband, onMembers, onSettings }: LegacyGroupMenuProps) {
  const b = useBots()

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button className="aino-group-info-toggle" variant="ghost">
        <Codicon name="organization" />
        <span>{b.canonical.groupInfo}</span>
        <Codicon name="chevron-down" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={onSettings}><Codicon name="gear" />{b.group.settingsTitle}</DropdownMenuItem>
      <DropdownMenuItem onSelect={onMembers}><Codicon name="organization" />{b.canonical.manageMembers}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onDisband} variant="destructive"><Codicon name="trash" />{b.group.disbandAction}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
