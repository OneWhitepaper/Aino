import { ToolIcon, type ToolIconProps } from '@/components/ui/tool-icon'
import { codiconForFilename, codiconForLanguage } from '@/lib/markdown-code'

export interface FileTypeIconProps extends Omit<ToolIconProps, 'name'> {
  /** A code-fence language tag (e.g. `ts`, `json`). Used when no `path`. */
  language?: string
  /** A file path or bare name; its extension selects the icon. Wins over `language`. */
  path?: string
}

/**
 * Icon for a file or code language, resolved through the one mapping shared
 * with code blocks (`codiconForFilename` / `codiconForLanguage`). Renders via
 * `ToolIcon`, sharing application glyphs while retaining specialized editor
 * and language names through the Codicon fallback. Pass a `path` for file rows
 * or a `language` for fenced code.
 */
export function FileTypeIcon({ language, path, ...props }: FileTypeIconProps) {
  const name = path ? codiconForFilename(path) : codiconForLanguage(language)

  return <ToolIcon name={name} {...props} />
}
