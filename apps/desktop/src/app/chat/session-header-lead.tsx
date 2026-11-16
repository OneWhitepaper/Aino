import { Folder, MessageSquare } from 'lucide-react'

import type { SessionInfo } from '@/types/hermes'

interface SessionHeaderLeadProps {
  session?: null | Pick<SessionInfo, 'cwd'>
}

export function SessionHeaderLead({ session }: SessionHeaderLeadProps) {
  const Icon = session?.cwd ? Folder : MessageSquare

  return (
    <span className="inline-flex size-4 items-center text-(--ui-text-secondary)">
      <Icon aria-hidden size={16} strokeWidth={1.65} />
    </span>
  )
}
