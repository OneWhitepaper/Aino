import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { $confirmRequest, type PendingConfirm, runConfirm, settleConfirm } from '@/store/confirm'

// The one mount point for `confirm()` from @/store/confirm. Mounted once at the
// shell, the way NotificationStack backs notify().
export function ConfirmHost() {
  const request = useStore($confirmRequest)
  // The atom clears the moment the question is answered, but Radix still has a
  // close animation to play — hold the copy so the dialog doesn't blank mid-fade.
  const [shown, setShown] = useState<null | PendingConfirm>(request)

  useEffect(() => {
    if (request) {
      setShown(request)
    }
  }, [request])

  if (!shown) {
    return null
  }

  return (
    <ConfirmDialog
      busyLabel={shown.busyLabel}
      cancelLabel={shown.cancelLabel}
      confirmLabel={shown.confirmLabel}
      description={shown.description}
      destructive={shown.destructive}
      dismissOnConfirm={!shown.onConfirm}
      doneLabel={shown.doneLabel}
      key={shown.id}
      onClose={() => settleConfirm(shown.phase === 'done', shown)}
      onConfirm={() => runConfirm(shown)}
      open={request !== null}
      title={shown.title}
    >
      {shown.details && (
        <dl className="min-w-0 space-y-3 text-[length:var(--aino-text-body)] leading-relaxed">
          {shown.details.map(({ label, value }) => (
            <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3" key={label}>
              <dt className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{label}</dt>
              <dd className="m-0 min-w-0 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </ConfirmDialog>
  )
}
