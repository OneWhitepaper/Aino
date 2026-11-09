import { Badge, Checkbox, cn, Codicon, RowButton, Tip } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { botRosterKey } from './data'
import { useBots } from './i18n'
import { displayName, rosterConnectionLabel } from './labels'
import { botRosterMeta } from './routing'
import type { BotMeta, RosterRow } from './types'

interface GroupCreateMembersProps {
  allMeta: Record<string, BotMeta>
  atCap: boolean
  checked: Record<string, boolean>
  disabled?: boolean
  onToggle: (key: string, checked: boolean) => void
  query: string
  selected: RosterRow[]
  visible: RosterRow[]
}

/** Selection is source-qualified; names and descriptions are presentation only. */
export function GroupCreateMembers({ allMeta, atCap, checked, disabled = false, onToggle, query, selected, visible }: GroupCreateMembersProps) {
  const b = useBots()

  return <>
    {!!selected.length && <div className="aino-group-create-selected">
      {selected.map(bot => <Badge asChild key={botRosterKey(bot)} variant="muted">
        <Tip label={b.group.removeFromSelection}>
          <RowButton disabled={disabled} onClick={() => onToggle(botRosterKey(bot), false)}>
            {displayName(bot, botRosterMeta(bot, allMeta))}
            <Codicon name="close" />
          </RowButton>
        </Tip>
      </Badge>)}
    </div>}
    <div className="aino-group-create-members">
      {visible.length ? visible.map(bot => {
        const key = botRosterKey(bot)
        const meta = botRosterMeta(bot, allMeta)
        const { shape, color, image } = botAppearance(bot.name, meta)
        const isChecked = Boolean(checked[key])
        const unavailable = disabled || (!isChecked && atCap)
        const source = rosterConnectionLabel(bot) || (!bot.remoteSource ? b.bot.thisDevice : '')
        const detail = [meta?.description || bot.description, source].filter(Boolean).join(' · ')

        return <label className={cn('aino-group-create-member', unavailable && 'opacity-50')} key={key}>
          <BotFace color={avatarColor(color, bot.name)} image={image && !isBackfilledFacePng(image) ? image : null}
            name={bot.name} shape={shape} size={32} />
          <span className="aino-group-create-member-copy">
            <strong>{displayName(bot, meta)}</strong>
            {detail && <span>{detail}</span>}
          </span>
          <Checkbox checked={isChecked} disabled={unavailable} onCheckedChange={value => onToggle(key, Boolean(value))} />
        </label>
      }) : <p className="aino-group-create-empty">{query.trim() ? b.group.noBotsMatch(query.trim()) : b.group.noBotsYet}</p>}
    </div>
  </>
}
