import { Codicon } from '@/components/ui/codicon'
import { codiconForFilename, codiconForLanguage } from '@/lib/markdown-code'
import { cn } from '@/lib/utils'

export interface FileTypeIconProps {
  className?: string
  size?: number | string
  /** A code-fence language tag (e.g. `ts`, `json`). Used when no `path`. */
  language?: string
  /** A file path or bare name; its extension selects the icon. Wins over `language`. */
  path?: string
}

/**
 * Icon for a file or code language, resolved through the one mapping shared
 * with code blocks (`codiconForFilename` / `codiconForLanguage`). Renders via
 * `Codicon`, retaining specialized editor and language identities independently
 * of the transcript's action icons. Pass a `path` for file rows
 * or a `language` for fenced code.
 */
export function FileTypeIcon({ className, language, path, size = '0.875rem' }: FileTypeIconProps) {
  const name = path ? codiconForFilename(path) : codiconForLanguage(language)

  return <Codicon className={cn('shrink-0', className)} name={name} size={size} />
}
