import { cn } from '@/lib/utils'

// Shared class names for the composer's control row, in a module of their own
// so both the row (`controls.tsx`) and the menus it renders can wear them
// without importing each other in a cycle.

export const ICON_BTN = 'size-(--composer-control-size) shrink-0 rounded-md'

export const GHOST_ICON_BTN = cn(
  ICON_BTN,
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
)

// Use the shared action palette so send and voice follow the same light/dark
// treatment as the rest of the application.
export const PRIMARY_ICON_BTN = cn(
  'size-(--composer-control-primary-size,var(--composer-control-size)) shrink-0 rounded-full p-0',
  'bg-(--aino-action-bg) text-(--aino-action-fg) hover:bg-(--aino-action-hover)',
  'disabled:bg-(--ui-bg-tertiary) disabled:text-(--ui-text-tertiary) disabled:opacity-100'
)

/** A toggle that is currently ON — dictation, spoken replies, the wake word. */
export const ACTIVE_ICON_BTN = 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
