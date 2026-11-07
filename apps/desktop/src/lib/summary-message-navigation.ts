import { triggerHaptic } from '@/lib/haptics'

export interface SummaryMessageTarget {
  messageId: number
  sessionId: string
}

export interface SummaryMessageNavigationOptions {
  target: SummaryMessageTarget
  /** The foreground session/profile guard. Checked before and after DOM work. */
  isCurrent: () => boolean
  root: ParentNode
  /** Called when the target is not in the current render window. */
  backfill?: () => Promise<boolean>
}

export type SummaryMessageNavigationResult = 'navigated' | 'not-found' | 'stale'

/** Locate a durable DB row in the active transcript and reveal it. */
export async function navigateToSummaryMessage(
  options: SummaryMessageNavigationOptions
): Promise<SummaryMessageNavigationResult> {
  if (!options.isCurrent()) {
    return 'stale'
  }

  const root = options.root
  const selector = `[data-durable-row-id="${String(options.target.messageId)}"], [data-source-row-ids~="${String(options.target.messageId)}"]`
  let node = root.querySelector<HTMLElement>(selector)

  if (!node && options.backfill) {
    await options.backfill()

    if (!options.isCurrent()) {
      return 'stale'
    }

    node = root.querySelector<HTMLElement>(selector)
  }

  if (!node || !options.isCurrent()) {
    return options.isCurrent() ? 'not-found' : 'stale'
  }

  if (!node.hasAttribute('tabindex')) {
    node.tabIndex = -1
  }
  node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  node.focus({ preventScroll: true })
  node.dataset.summaryTarget = ''
  window.setTimeout(() => delete node?.dataset.summaryTarget, 900)
  triggerHaptic('selection')

  return 'navigated'
}
