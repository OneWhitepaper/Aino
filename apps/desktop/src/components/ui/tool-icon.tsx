import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

export interface ToolIconProps {
  className?: string
  name: string
  size?: number | string
}

/** Tool rows share the app glyphs. Specialized editor/language names keep the
 * Codicon fallback, so file-type and Git identities survive the visual refresh. */
export function ToolIcon({ className, name, size = '0.875rem' }: ToolIconProps) {
  return <Codicon className={cn('shrink-0', className)} name={name} size={size} />
}
