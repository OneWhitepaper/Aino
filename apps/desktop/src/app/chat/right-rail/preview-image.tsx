import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { FIT_MIN_SCALE, useZoomPan } from '@/components/ui/use-zoom-pan'
import { useI18n } from '@/i18n'
import { Maximize, ZoomIn, ZoomOut } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface PreviewImageProps {
  alt: string
  src: string
}

/** A file preview keeps its original pixels; fitting is a view transform so
 * zooming reveals detail instead of enlarging an already reduced thumbnail. */
export function PreviewImage({ alt, src }: PreviewImageProps) {
  const { t } = useI18n()

  const { actualSize, panning, ref, reset, scale, setContentEl, stageProps, style, zoomIn, zoomOut } =
    useZoomPan<HTMLDivElement>({ minScale: FIT_MIN_SCALE })

  useEffect(() => {
    reset()
  }, [src, reset])

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" data-slot="preview-image">
      <div
        className={cn(
          'absolute inset-0 touch-none select-none overflow-hidden',
          panning ? 'cursor-grabbing' : 'cursor-grab'
        )}
        ref={ref}
        {...stageProps}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-1 grid-rows-1 place-items-center">
          <div className="w-max max-w-none origin-center" ref={setContentEl} style={style}>
            <img
              alt={alt}
              className="block h-auto w-auto max-h-none max-w-none rounded-lg shadow-sm"
              draggable={false}
              onLoad={reset}
              src={src}
            />
          </div>
        </div>
      </div>
      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/70 bg-background/85 p-1 shadow-sm backdrop-blur">
        <Tip label={t.desktop.zoomOut}>
          <Button
            aria-label={t.desktop.zoomOut}
            disabled={scale <= FIT_MIN_SCALE}
            onClick={zoomOut}
            size="icon-sm"
            variant="ghost"
          >
            <ZoomOut />
          </Button>
        </Tip>
        <Tip label={t.preview.imageActualSize}>
          <Button
            aria-label={t.preview.imageActualSize}
            className="min-w-14 tabular-nums"
            onClick={actualSize}
            size="xs"
            variant="ghost"
          >
            {Math.round(scale * 100)}%
          </Button>
        </Tip>
        <Tip label={t.desktop.zoomIn}>
          <Button aria-label={t.desktop.zoomIn} disabled={scale >= 8} onClick={zoomIn} size="icon-sm" variant="ghost">
            <ZoomIn />
          </Button>
        </Tip>
        <Tip label={t.preview.imageFit}>
          <Button aria-label={t.preview.imageFit} onClick={reset} size="icon-sm" variant="ghost">
            <Maximize />
          </Button>
        </Tip>
      </div>
    </div>
  )
}
