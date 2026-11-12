import './session-recovery.css'

import type { ReactNode } from 'react'

import { Codicon } from '@/components/ui/codicon'

interface InlineRecoveryProps {
  title: ReactNode
  description: ReactNode
  actions: ReactNode
  children?: ReactNode
  icon?: string
}

/** Recovery stays in the failed conversation, with one quiet seam and readable actions. */
export function InlineRecovery({ title, description, actions, children, icon = 'error' }: InlineRecoveryProps) {
  return (
    <section className="aino-inline-recovery" role="alert">
      <Codicon className="aino-inline-recovery-icon" name={icon} />
      <div className="aino-inline-recovery-content">
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="aino-inline-recovery-actions">{actions}</div>
        {children}
      </div>
    </section>
  )
}
