import { useSessionSlice } from '@/lib/use-session-slice'
import { collaborationGroupsFor } from '@/store/collaboration-capsule-model'
import { knownOwnerForSession } from '@/store/session-states'
import { $subagentsBySession } from '@/store/subagents'

import { CollaborationTaskRow } from './collaboration-task'

/** Exercise the real projection and row against owner-scoped delegation facts. */
export function ProjectedCollaborationTasks({ sessionId }: { sessionId: string }) {
  const items = useSessionSlice($subagentsBySession, sessionId)

  const groups = collaborationGroupsFor(
    [
      {
        parentRuntimeId: sessionId,
        storedSessionId: sessionId,
        owner: knownOwnerForSession(sessionId),
        title: 'Source conversation',
        workspaceMode: 'sessions',
        canControl: true
      }
    ],
    { [sessionId]: items },
    'Assistant'
  )

  return groups.map(group =>
    group.tasks.map(task => <CollaborationTaskRow group={group} key={task.key} now={Date.now()} task={task} />)
  )
}
