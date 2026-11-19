import { randomUuid } from '@hermes/shared'
import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ErrorBanner } from '@/components/ui/error-state'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { handoffCopy } from '@/i18n/handoff'

import {
  createReviewedHandoff,
  type HandoffLink,
  openHandoffLink,
  prepareHandoffReturn,
  reviewedHandoff
} from './actions'
import type { HandoffContext } from './context'

export interface HandoffReview {
  context: HandoffContext
  sourceMode: 'work' | 'code'
  summary: string
  files: string[]
  returnTarget?: HandoffLink
}

interface HandoffDialogProps {
  review: HandoffReview
  onClose: () => void
  onCreated: (context: HandoffContext) => void
}

export function HandoffDialog({ review, onClose, onCreated }: HandoffDialogProps) {
  const { t, locale } = useI18n()
  const copy = handoffCopy(locale)
  const navigate = useNavigate()
  const id = useId()
  const [summary, setSummary] = useState(review.summary)
  const [paths, setPaths] = useState(review.files.join('\n'))
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const flight = useRef(false)
  const intent = useRef({ key: '', id: randomUuid() })

  const submit = async () => {
    if (flight.current) {
      return
    }

    flight.current = true
    setPending(true)
    setError('')

    try {
      const handoff = reviewedHandoff(review.context.sourceId, summary, paths)
      const key = JSON.stringify(handoff)

      if (intent.current.key && intent.current.key !== key) {
        intent.current.id = randomUuid()
      }

      intent.current.key = key

      const link = review.returnTarget
        ? await prepareHandoffReturn(review.context, review.returnTarget, handoff)
        : await createReviewedHandoff(review.context, review.sourceMode, handoff, intent.current.id)

      if (!review.returnTarget) {
        // Opening primary leaves a split source mounted; re-read its links on the captured owner.
        onCreated(review.context)
      }

      openHandoffLink(review.context, link, navigate)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      flight.current = false
      setPending(false)
    }
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          onClose()
        }
      }}
      open
    >
      <DialogContent dismissDisabled={pending}>
        <DialogHeader>
          <DialogTitle>{review.returnTarget ? copy.returnResult : copy.review}</DialogTitle>
          <DialogDescription>{copy.hint}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <label htmlFor={`${id}-summary`}>{copy.summary}</label>
          <Textarea
            autoFocus
            disabled={pending}
            id={`${id}-summary`}
            maxLength={32000}
            onChange={event => setSummary(event.target.value)}
            rows={6}
            value={summary}
          />
          <label htmlFor={`${id}-files`}>{copy.files}</label>
          <Textarea
            aria-describedby={`${id}-paths-hint`}
            disabled={pending}
            id={`${id}-files`}
            onChange={event => setPaths(event.target.value)}
            rows={3}
            value={paths}
          />
          <p className="text-sm text-muted-foreground" id={`${id}-paths-hint`}>
            {copy.pathsOnly}
          </p>
          {!review.returnTarget && (
            <p className="text-sm text-muted-foreground">
              {copy.model}: {review.context.selection.model}
            </p>
          )}
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <DialogFooter>
          <Button disabled={pending} onClick={onClose} variant="outline">
            {t.common.cancel}
          </Button>
          <Button disabled={pending || !summary.trim()} onClick={() => void submit()}>
            {review.returnTarget ? copy.prepareReturn : copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
