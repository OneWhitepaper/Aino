import { WindowChromeIcon } from '@/components/ui/window-chrome-icon'
import { cn } from '@/lib/utils'

/** Titlebar-cluster glyph — sized by the shared titlebar contract. */
export function TitlebarIcon({
  className,
  name,
  size,
  spinning
}: {
  className?: string
  name: string
  size?: number | string
  spinning?: boolean
}) {
  return <WindowChromeIcon className={cn('leading-none', className)} name={name} size={size} spinning={spinning} />
}
