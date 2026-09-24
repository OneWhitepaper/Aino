import type { ReactNode } from 'react'

import { DisclosureRow } from '@/components/chat/disclosure-row'

/**
 * Transcript scaffolding: the quiet lines around the reply that say what the
 * agent did rather than what it said — a thinking header, a settled tool run,
 * the live activity ticker.
 *
 * They all render through here so they cannot drift apart. They used to each
 * pick their own grey — a thinking header painted `--ui-text-secondary`, a tool
 * summary `--ui-text-tertiary`, both under the same opacity — which read as two
 * different kinds of line for what is one kind of thing.
 *
 * Colour owns the hierarchy; keep rows at full opacity so links and expanded
 * details stay readable without hovering.
 */
export const SCAFFOLD_LABEL_CLASS =
  'text-[length:var(--conversation-tool-font-size)] leading-(--conversation-line-height) text-(--conversation-scaffold-text)'

/** Durations, counts and diff stats trailing a scaffold label. */
export const SCAFFOLD_META_CLASS = 'shrink-0 text-[0.625rem] tabular-nums text-(--conversation-scaffold-meta)'

/** The live pulse used by the thread status rows. Keep it in the same neutral
 * scaffold palette as thinking headers and tool activity, rather than the
 * theme accent reserved for interactive navigation. */
export const SCAFFOLD_ACTIVITY_GLYPH_CLASS =
  'mx-[calc((var(--conversation-glyph-cell)-var(--conversation-activity-size))/2)] inline-block size-(--conversation-activity-size) shrink-0 rounded-full bg-current text-(--conversation-scaffold-icon)'

/** The fixed cell a scaffold line's leading glyph sits in — status dot, tool
 *  icon, spinner. Same box on every line, so the labels share a left edge. */
export const SCAFFOLD_GLYPH_CLASS = 'grid size-(--conversation-glyph-cell) shrink-0 place-items-center'

/**
 * One scaffold line. `children` is the label and whatever trails it in flow
 * (meta, diff counts); `trailing` reserves a right-side slot for a live timer.
 */
export function ScaffoldRow({
  children,
  onToggle,
  open = false,
  trailing
}: {
  children: ReactNode
  onToggle?: () => void
  open?: boolean
  trailing?: ReactNode
}) {
  return (
    <DisclosureRow onToggle={onToggle} open={open} trailing={trailing}>
      <span className="flex min-w-0 items-center gap-(--conversation-glyph-gap)">{children}</span>
    </DisclosureRow>
  )
}
