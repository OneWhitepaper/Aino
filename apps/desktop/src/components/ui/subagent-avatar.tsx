import { blobatar } from 'blobatar/blob'
import { useMemo } from 'react'

import { subagentAvatarSeed, type SubagentIdentity } from '@/lib/subagent-identity'

export interface SubagentAvatarProps {
  task: SubagentIdentity
  parentSessionId?: string | null
  className?: string
}

/** The same child portrait in chat, Summary, the capsule and the tool panel. */
export function SubagentAvatar({ task, parentSessionId, className }: SubagentAvatarProps) {
  const seed = subagentAvatarSeed(task, parentSessionId)
  const src = useMemo(() => `data:image/svg+xml,${encodeURIComponent(blobatar(seed, { size: 64 }))}`, [seed])

  return <img alt="" className={className} data-slot="subagent-avatar" draggable={false} src={src} />
}
