const HTML_DOC_RE = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i
const HTML_TAG_RE = /<[a-z][a-z0-9-]*(\s[^>]*)?>/i
const HTML_DOC_MIN_CHARS = 160
const HTML_FRAGMENT_MIN_CHARS = 1200

/** Documents and fragments have different minimum sizes; input is already trimmed. */
export function isArtifactHtml(trimmed: string): boolean {
  const isDocument = HTML_DOC_RE.test(trimmed)

  return (
    (isDocument && trimmed.length >= HTML_DOC_MIN_CHARS) ||
    (!isDocument && trimmed.length >= HTML_FRAGMENT_MIN_CHARS && HTML_TAG_RE.test(trimmed))
  )
}
