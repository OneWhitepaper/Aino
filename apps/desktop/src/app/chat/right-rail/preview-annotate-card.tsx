import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { CARD_SURFACE_CLASS } from '@/components/ui/card-surface'
import { Codicon } from '@/components/ui/codicon'
import { ANNOTATE_CARD_HEIGHT, ANNOTATE_CARD_WIDTH, ANNOTATE_MARKER_SIZE } from '@/lib/preview-annotate'
import { cn } from '@/lib/utils'

const PAD = 12
const GAP = 8

interface AnnotateCardPlacement {
  left: number
  top: number
}

interface PlaceAnnotateCardInput {
  paneHeight: number
  paneWidth: number
  rect: { height: number; width: number; x: number; y: number }
}

interface PreviewAnnotateCardProps extends AnnotateCardPlacement {
  note: string
  number: number
  onCancel: () => void
  onChange: (note: string) => void
  onSave: () => void
  placeholder: string
  saveLabel: string
  title: string
}

export function placeAnnotateCard({ paneHeight, paneWidth, rect }: PlaceAnnotateCardInput): AnnotateCardPlacement {
  const width = Math.min(ANNOTATE_CARD_WIDTH, Math.max(0, paneWidth - PAD * 2))
  const maxLeft = Math.max(PAD, paneWidth - width - PAD)
  const maxTop = Math.max(PAD, paneHeight - ANNOTATE_CARD_HEIGHT - PAD)
  const pinRight = rect.x + ANNOTATE_MARKER_SIZE / 2
  const preferRight = pinRight + GAP
  const preferLeft = rect.x - ANNOTATE_MARKER_SIZE / 2 - GAP - width

  const left =
    preferRight + width + PAD <= paneWidth || preferLeft < PAD
      ? Math.min(Math.max(PAD, preferRight), maxLeft)
      : Math.min(Math.max(PAD, preferLeft), maxLeft)

  const top = Math.min(Math.max(PAD, rect.y - ANNOTATE_CARD_HEIGHT / 2), maxTop)

  return { left, top }
}

export function PreviewAnnotateCard({
  left,
  note,
  number,
  onCancel,
  onChange,
  onSave,
  placeholder,
  saveLabel,
  title,
  top
}: PreviewAnnotateCardProps) {
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [number])

  return (
    <form
      aria-label={title}
      className={cn(
        CARD_SURFACE_CLASS,
        'absolute z-20 flex h-11 w-[min(17.5rem,calc(100%-1.5rem))] items-center gap-1 pl-4 pr-1'
      )}
      data-annotate-card="true"
      data-annotate-number={number}
      onSubmit={event => {
        event.preventDefault()
        onSave()
      }}
      style={{
        left,
        top
      }}
    >
      <input
        aria-label={placeholder}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[length:var(--aino-text-ui)] leading-5 outline-none placeholder:text-(--ui-text-tertiary)"
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        placeholder={placeholder}
        ref={field}
        spellCheck
        value={note}
      />
      <Button aria-label={saveLabel} className="rounded-full" size="icon-sm" type="submit">
        <Codicon name="arrow-up" size="0.875rem" />
      </Button>
    </form>
  )
}
