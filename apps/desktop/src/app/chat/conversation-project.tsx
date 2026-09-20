import type { ConversationProjectRef, ConversationRecord } from '@hermes/shared/gateway-events'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import type { ConversationOwner } from '@/store/conversation-owner'
import { projectSourceKey } from '@/store/shared-projects'

import { ConversationProjectSelector } from './composer/conversation-project-selector'
import { ProjectSelectorTrigger } from './composer/status-stack/project-selector'
import { changeConversationProject } from './conversation-project-actions'

interface ConversationProjectProps {
  owner: ConversationOwner
  record: ConversationRecord
  profiles: string[]
  disabled: boolean
  load: () => Promise<unknown>
}
export function ConversationProject({ owner, record, profiles, disabled, load }: ConversationProjectProps) {
  const copy = useI18n().t.sharedProjects
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<{ source: ConversationProjectRef | null; revision: number } | null>(null)
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <ProjectSelectorTrigger
            disabled={disabled}
            label={record.project?.cwd.split(/[\\/]/).filter(Boolean).pop()}
          />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.project}</DialogTitle>
          </DialogHeader>
          <ConversationProjectSelector
            connectionId={owner.connectionId}
            installId={owner.installId}
            value={record.project}
            profiles={profiles}
            disabled={disabled}
            onChange={source => {
              if ((source && projectSourceKey(source)) !== (record.project && projectSourceKey(record.project))) {
                setOpen(false)
                setPending({ source, revision: record.revision })
              }
            }}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={copy.confirm}
        description={
          <>
            {pending?.source?.cwd ?? copy.noProject}. {copy.generation}
          </>
        }
        confirmLabel={copy.apply}
        onConfirm={async () => {
          if (pending) await changeConversationProject(owner, pending.source, pending.revision, load)
        }}
      />
    </>
  )
}
