import { Codicon, type PluginContext, useValue, WORKSPACE_AVATAR_AREA } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace, startFaceClock, stopFaceClock } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $botMeta, $lastRoster } from './data'
import { botRosterMeta, botWorkspaceOwnerKey } from './routing'

interface BotWorkspaceAvatarProps {
  ownerKey: string
  size: number
}

/** Disabling the plugin must stop its shared avatar clock as well as remove the portrait renderer. */
export function registerBotWorkspaceAvatar(ctx: PluginContext): void {
  startFaceClock()

  if (typeof ctx.onDispose === 'function') {
    ctx.onDispose(stopFaceClock)
  }

  ctx.register({
    id: 'workspace-avatar',
    area: WORKSPACE_AVATAR_AREA,
    data: {
      avatarFor: (ownerKey: string, size: number) => <BotWorkspaceAvatar ownerKey={ownerKey} size={size} />
    }
  })
}

/** Never borrow the foreground bot's face for a different session or source. */
export function BotWorkspaceAvatar({ ownerKey, size }: BotWorkspaceAvatarProps) {
  const roster = useValue($lastRoster)
  const meta = useValue($botMeta)
  const bot = roster.find(row => botWorkspaceOwnerKey(row) === ownerKey)

  if (!bot) {
    return <Codicon name="hubot" size={size * 0.75} />
  }

  const appearance = botAppearance(bot.name, botRosterMeta(bot, meta))
  const image = appearance.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null

  return (
    <BotFace
      color={avatarColor(appearance.color, bot.name)}
      image={image}
      name={bot.name}
      shape={appearance.shape}
      size={size}
    />
  )
}
