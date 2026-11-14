import { atom } from 'nanostores'

/** Window-local choice; panel transitions fold it, and a fresh draft starts quiet. */
export const $summaryOpen = atom(false)

export function toggleSummary(): void {
  $summaryOpen.set(!$summaryOpen.get())
}
