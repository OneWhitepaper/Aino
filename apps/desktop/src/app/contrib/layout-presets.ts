import { group, mirrorTreeHorizontal, split } from '@/components/pane-shell/tree/model'
import { registerBundledPresets } from '@/components/pane-shell/tree/presets'

// ---------------------------------------------------------------------------
// Layout presets — CHAT (main) always dominates.
// ---------------------------------------------------------------------------

// Files and tools share one horizontal tab host. Dynamic preview/session IDs
// never belong in saved preset geometry; their existing owners restore them.
// applyLayoutPreset normalizes the legacy bundled shapes below through the
// same tool-panel policy used when restoring a persisted layout.
export const DEFAULT_TREE = split(
  'row',
  [
    group(['sessions'], { id: 'grp-sessions' }),
    group(['workspace'], { id: 'grp-main' }),
    group(['files', 'review', 'terminal'], { id: 'grp-files', tabStrip: 'always', toolPanel: true })
  ],
  [1, 3.4, 1.8],
  'spl-root'
)

// Keep this legacy preset ID and geometry readable by existing saved choices.
// Applying it extracts the core tools into the shared host beside the chat.
const FOCUS_TREE = split(
  'row',
  [group(['sessions']), split('column', [group(['workspace', 'files', 'review']), group(['terminal'])], [3, 1])],
  [1, 4.6]
)

// Resting tools remain part of Basic's geometry without occupying visible
// space. Explicit opens reveal their shared host through the normal action.
export const BASIC_TREE = split(
  'row',
  [
    group(['sessions']),
    group(['workspace']),
    group(['files', 'review', 'terminal'], { tabStrip: 'always', toolPanel: true })
  ],
  [1, 3.4, 1.8]
)

const BASIC_RESTING = ['terminal', 'files', 'review'] as const

const TERMINAL_TREE = split(
  'row',
  [
    group(['sessions']),
    split('column', [group(['workspace']), group(['terminal'])], [3, 1]),
    group(['files', 'review'])
  ],
  [1, 3.2, 1.2]
)

// The legacy Terminal deck keeps its resting intent. Normalization joins its
// tools without reopening them or reintroducing a separate bottom rail.
const TERMINAL_RESTING = ['terminal', 'files', 'review'] as const

// The first-run intro's borrowed layout: the chat alone, no tab strip. Unlisted,
// and applied while layout persistence is held (onboarding/first-run/assembly.ts).
export const DEMO_LAYOUT_ID = 'demo'

export const DEMO_TREE = group(['workspace'], { tabStrip: 'never' })

const QUAD_TREE = split(
  'column',
  [
    split('row', [group(['sessions', 'files']), group(['workspace'])], [1, 3]),
    split('row', [group(['terminal']), group(['review'])], [1.4, 1])
  ],
  [3, 1]
)

export function registerLayoutPresets() {
  // Simple is always the Basic arrangement; its one choice is which side the
  // sidebar sits. The decks are Advanced — arranging tooling is the point.
  return registerBundledPresets([
    { id: 'sidebar-left', title: 'Sidebar left', order: 0, tree: BASIC_TREE, resting: BASIC_RESTING, tier: 'simple' },
    {
      id: 'sidebar-right',
      title: 'Sidebar right',
      order: 1,
      tree: mirrorTreeHorizontal(BASIC_TREE),
      resting: BASIC_RESTING,
      tier: 'simple'
    },
    { id: 'default', title: 'Default', order: 0, tree: DEFAULT_TREE, tier: 'advanced' },
    { id: 'basic', title: 'Basic', order: 5, tree: BASIC_TREE, resting: BASIC_RESTING, tier: 'advanced' },
    { id: 'focus', title: 'Focus', order: 10, tree: FOCUS_TREE, resting: ['terminal'], tier: 'advanced' },
    {
      id: 'terminal-deck',
      title: 'Terminal deck',
      order: 20,
      tree: TERMINAL_TREE,
      resting: TERMINAL_RESTING,
      tier: 'advanced'
    },
    { id: 'quad', title: 'Quad', order: 30, tree: QUAD_TREE, tier: 'advanced' },
    { id: DEMO_LAYOUT_ID, listed: false, title: 'Demo', order: 40, tree: DEMO_TREE }
  ])
}
