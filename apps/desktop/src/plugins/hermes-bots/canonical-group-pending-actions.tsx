import { ConfirmDialog } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { CanonicalPendingCard } from './canonical-group-details'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { CanonicalMemberAvatar } from './canonical-group-members'
import { useCanonicalMembers } from './canonical-group-members'
import type { CanonicalGroupSurfaceProps } from './canonical-group-surface'
import type { CanonicalPendingAction } from './canonical-groups'

export function CanonicalGroupPendingActions({
  binding,
  busy,
  state,
  onAction,
  visible,
  methods,
  onRefresh
}: Pick<CanonicalGroupSurfaceProps, 'binding' | 'busy' | 'state' | 'onAction' | 'visible' | 'methods' | 'onRefresh'>) {
  const labels = useCanonicalGroupLabels()
  const { nameFor } = useCanonicalMembers(binding)
  const members = state?.room.members ?? []
  const [discard, setDiscard] = useState<CanonicalPendingAction | null>(null)

  return (
    <>
      {(state?.driver_status?.pending_actions ?? []).map(action => {
        const member = members.find(item => item.member_id === action.member_id)

        return (
          <CanonicalPendingCard
            action={action}
            avatar={member && <CanonicalMemberAvatar binding={binding} member={member} size={24} />}
            busy={busy}
            key={`${action.kind}:${action.member_id}:${action.task_id}:${action.execution_generation}:${action.request_id ?? ''}`}
            labels={labels}
            methods={methods}
            name={member ? nameFor(member) : labels.memberGeneric}
            onAct={(action, choice) => onAction(action, choice).catch(() => undefined)}
            onDiscard={() => setDiscard({ ...action })}
            onRefresh={onRefresh}
          />
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
