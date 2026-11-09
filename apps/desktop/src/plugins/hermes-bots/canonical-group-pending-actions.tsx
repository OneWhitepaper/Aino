import { Button, Codicon, ConfirmDialog } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { useCanonicalGroupLabels } from './canonical-group-labels'
import { useCanonicalMembers } from './canonical-group-members'
import type { CanonicalGroupSurfaceProps } from './canonical-group-surface'
import type { CanonicalPendingAction } from './canonical-groups'

export function CanonicalGroupPendingActions({
  binding,
  busy,
  state,
  onAction,
  visible
}: Pick<CanonicalGroupSurfaceProps, 'binding' | 'busy' | 'state' | 'onAction' | 'visible'>) {
  const labels = useCanonicalGroupLabels()
  const { nameFor } = useCanonicalMembers(binding)
  const members = state?.room.members ?? []
  const [discard, setDiscard] = useState<CanonicalPendingAction | null>(null)

  return (
    <>
      {(state?.driver_status?.pending_actions ?? []).map(action => {
        const member = members.find(item => item.member_id === action.member_id)

        return (
          <div
            className="aino-group-pending-action"
            key={`${action.kind}:${action.member_id}:${action.task_id}:${action.execution_generation}:${action.request_id ?? ''}`}
          >
            <Codicon name={action.kind === 'approval' ? 'shield' : 'warning'} />
            <span>{member ? nameFor(member) : labels.memberGeneric}</span>
            {action.kind === 'discard' && (
              <Button disabled={busy} onClick={() => setDiscard({ ...action })} size="sm" variant="outline">
                {labels.discard}
              </Button>
            )}
            {action.kind === 'retry' && (
              <Button
                disabled={busy}
                onClick={() => void onAction({ ...action }).catch(() => undefined)}
                size="sm"
                variant="outline"
              >
                {labels.retry}
              </Button>
            )}
            {action.kind === 'approval' && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void onAction({ ...action }, 'deny').catch(() => undefined)}
                  size="sm"
                  variant="ghost"
                >
                  {labels.deny}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void onAction({ ...action }, 'once').catch(() => undefined)}
                  size="sm"
                >
                  {labels.allowOnce}
                </Button>
              </>
            )}
          </div>
        )
      })}
      {discard && (
        <ConfirmDialog
          confirmLabel={labels.confirmDiscard}
          description={labels.discardWarning}
          destructive
          onClose={() => setDiscard(null)}
          onConfirm={() => onAction(discard)}
          open={visible}
          title={labels.discardUnknown}
        />
      )}
    </>
  )
}
