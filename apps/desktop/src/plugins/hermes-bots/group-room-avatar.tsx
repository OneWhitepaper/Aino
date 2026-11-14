import { useValue } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $botMeta } from './data'
import type { BotMeta } from './types'

interface RoomBotFaceProps {
  name: string
  meta: BotMeta | null | undefined
  size?: number
}

/** A bot's face from its Bot Mode appearance (custom image/pet, else its shape + color). */
export function RoomBotAvatar({ name, size = 24 }: { name: string; size?: number }) {
  const meta = useValue($botMeta) as Record<string, Parameters<typeof botAppearance>[1]>

  return <RoomBotFace meta={meta?.[name]} name={name} size={size} />
}

/** Transcript callers resolve metadata against the speaker's exact owner. */
export function RoomBotFace({ name, meta, size = 24 }: RoomBotFaceProps) {
  const appearance = botAppearance(name, meta)
  const photo = appearance.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null

  return (
    <BotFace
      color={avatarColor(appearance.color, name)}
      image={photo}
      name={name}
      shape={appearance.shape}
      size={size}
    />
  )
}
