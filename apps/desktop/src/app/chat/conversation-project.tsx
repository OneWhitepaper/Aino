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
      <Dialog onOpenChange={setOpen} open={open}>
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
            disabled={disabled}
            installId={owner.installId}
            onChange={source => {
              if ((source && projectSourceKey(source)) !== (record.project && projectSourceKey(record.project))) {
                setOpen(false)
                setPending({ source, revision: record.revision })
              }
            }}
            profiles={profiles}
            value={record.project}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        confirmLabel={copy.apply}
        description={
          <>
            {pending?.source?.cwd ?? copy.noProject}. {copy.generation}
          </>
        }
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (pending) {
            await changeConversationProject(owner, pending.source, pending.revision, load)
          }
        }}
        open={Boolean(pending)}
        title={copy.confirm}
      />
    </>
  )
}
