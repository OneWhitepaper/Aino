import { useStore } from '@nanostores/react'
/**
 * Narrow-viewport edge overlays — the tree's take on the app's hover-reveal
 * collapse. Collapsible panes leave the grid below the sidebar-collapse
 * breakpoint; an edge strip (hover) or PANE_TOGGLE_REVEAL_EVENT (⌘B / ⌘G /
 * titlebar toggles route here on narrow) slides the pane OVER the layout
 * instead of squeezing it. Event reveals pin; hover reveals follow the mouse.
 */
import { type Dispatch, type RefObject, type SetStateAction, useRef } from 'react'
import { type MouseEventHandler, useCallback, useEffect, useMemo, useState } from 'react'

import { openToolPanelChooser, TOOL_CHOOSER_PANE } from '@/app/right-sidebar/tool-panel-actions'
import { $workspaceIsPage, workspacePageKeepsPane } from '@/app/routes'
import { useTitlebarHeight } from '@/app/shell/use-touch-titlebar'
import { Codicon } from '@/components/ui/codicon'
import { PaneStripGlyph, PaneTab, PaneTabLabel, PaneTabStrip } from '@/components/ui/pane-tab'
import { usePaneTabKeyboard } from '@/components/ui/pane-tab-keyboard'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { Slot } from '@/contrib/react/slot'
import { useContributions } from '@/contrib/react/use-contributions'
import type { Contribution } from '@/contrib/types'
import { useI18n } from '@/i18n'
import { localizedPaneTitle } from '@/i18n/contributions'
import { ESCAPE_PRIORITY, isTopEscapeLayer } from '@/lib/escape-layers'
import { hostHas } from '@/lib/host-capabilities'
import { cn } from '@/lib/utils'
import { $chatOnboardingSolo } from '@/store/onboarding-intro'
import { $paneStates } from '@/store/panes'

import { $layoutEditMode } from '../../edit-mode'
import { useWindowControlsOverlap } from '../../geometry'
import { $narrowOverlayPaneIds } from '../../narrow-overlay-state'
import { NO_PANE_GROUP, SidebarBrandContext } from '../../pane-visibility'
import { $workspaceMode, $workspaceOwnerKey } from '../../workspace-scope'
import { allPaneIds, findGroup, findGroupOfPane, type GroupNode, type LayoutNode } from '../model'
import { $hiddenTreePanes, $layoutTree, $narrowViewport, activateTreePane, closeTabPane} from '../store'
import { clearTabSelection } from '../tab-selection'
import { isToolPanelGroup } from '../tool-panel-policy'
import { workspaceShownPaneIds } from '../workspace-presentation'

import { KeepAlivePaneSlot, useStablePaneHosts } from './keep-alive-panes'
import { type NarrowRevealState as RevealState, useNarrowRevealControls } from './narrow-reveal-controls'
import { SidebarModeHeader } from './sidebar-mode-header'
import { sidebarModePanes } from './sidebar-mode-presentation'
import { useActiveTabVisible } from './tab-strip-scroll'
import { ToolPanelControls } from './tool-panel-controls'
import { fixedTrackSize, narrowToolPaneIds, paneChrome, type TrackContext } from './track-model'

/** The width a revealed narrow overlay sizes itself to: the SAME resolution
 *  the pane's zone uses while docked — declared max() refined by the live
 *  widthOverride of the zone's shown panes (fixedTrackSize) — so the overlay
 *  and the docked zone can never disagree. Falls back to the pane's declared
 *  `data.width` (then 18rem) when no zone claims the pane. Pure, so the
 *  regression test asserts the resolution itself (jsdom's CSSOM drops the
 *  `min()` wrapper from style.width, hiding the rendered result). */
export function narrowOverlayWidth(ctx: TrackContext, tree: LayoutNode | null, revealed: Contribution): string {
  if (!tree) {
    return paneChrome(revealed).width ?? '18rem'
  }

  const zone = findGroupOfPane(tree, revealed.id)
  const track = zone ? fixedTrackSize(zone, 'row', ctx) : null

  return track ?? paneChrome(revealed).width ?? '18rem'
}

/** A removed plugin falls back within its existing group. Reconcile identity
 *  as well as paint, so re-enabling it cannot revive a stale Bot Mode. */
function useResolvedReveal(
  reveal: RevealState | null,
  setReveal: Dispatch<SetStateAction<RevealState | null>>,
  panes: readonly Contribution[],
  tree: LayoutNode | null
) {
  const ownerId = useRef<string | undefined>(undefined)
  const currentOwner = reveal && tree ? findGroupOfPane(tree, reveal.id) : null

  if (currentOwner) {
    ownerId.current = currentOwner.id
  }

  const owner = reveal && tree ? findGroup(tree, ownerId.current || '') : null
  const members = owner ? owner.panes.flatMap(id => panes.find(pane => pane.id === id) ?? []) : []

  const revealed = reveal
    ? (panes.find(p => p.id === reveal.id) ?? members.find(pane => pane.id === owner?.active) ?? members[0])
    : undefined

  useEffect(() => {
    if (!reveal || reveal.id === revealed?.id) {
      return
    }

    setReveal(current => current && (revealed ? { ...current, id: revealed.id } : null))
    const group = revealed && tree ? findGroupOfPane(tree, revealed.id) : null

    if (group?.active === reveal.id && revealed) {
      activateTreePane(group.id, revealed.id)
    }
  }, [reveal, revealed, setReveal, tree])

  return revealed
}

/** A collapsed zone retains every available sibling as a navigation target. */
function collapsedZonePanes(
  revealed: Contribution | undefined,
  tree: LayoutNode | null,
  collapsibles: readonly Contribution[]
) {
  if (!revealed || !tree) {
    return { group: null, panes: [revealed].filter((pane): pane is Contribution => Boolean(pane)) }
  }

  const zone = findGroupOfPane(tree, revealed.id)
  const mates = zone ? zone.panes.map(id => collapsibles.find(pane => pane.id === id)) : []
  const shown = mates.filter((pane): pane is Contribution => Boolean(pane))

  return { group: zone, panes: shown.length > 0 ? shown : [revealed] }
}

function overlayTabsNeedScroll(
  narrow: boolean,
  solo: boolean,
  revealed: boolean,
  compactSidebar: boolean,
  toolPanel: boolean,
  tabCount: number
): boolean {
  return narrow && !solo && revealed && !compactSidebar && (toolPanel || tabCount > 1)
}

export function NarrowOverlays() {
  const titlebarHeight = useTitlebarHeight()
  const narrow = useStore($narrowViewport)
  const solo = useStore($chatOnboardingSolo)
  const tree = useStore($layoutTree)
  const panes = useContributions('panes')
  const paneStates = useStore($paneStates)
  const stableHosts = useStablePaneHosts()
  const hiddenPanes = useStore($hiddenTreePanes)
  const workspacePage = useStore($workspaceIsPage)
  const editMode = useStore($layoutEditMode)
  const workspaceMode = useStore($workspaceMode)
  const workspaceOwnerKey = useStore($workspaceOwnerKey)
  const [reveal, setReveal] = useState<RevealState | null>(null)

  // The revealed overlay spans the full viewport height (inset-y-0 below), so
  // its tab strip starts at the top edge — under the native window controls
  // (macOS traffic lights) when the sidebar is on the left. Reserve their rect
  // the same way a docked zone does (TreeGroup's wcOverlap -> paddingTop plus
  // an absolute drag-region spacer so the band stays a window-drag target).
  const overlayRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const outsidePress = useRef<{ id: number; x: number; y: number } | null>(null)
  const wcOverlap = useWindowControlsOverlap(overlayRef, reveal !== null)

  const onMouseLeave = useCallback<MouseEventHandler<HTMLDivElement>>(event => {
    // The overlay's chrome and its stable guest are DOM siblings, but one
    // hover boundary. Crossing between them must not dismiss an unpinned pane.
    const next = event.relatedTarget

    if (next instanceof Element && next.closest('[data-narrow-overlay], [data-pane-overlay]')) {
      return
    }

    setReveal(current => (current?.pinned ? current : null))
  }, [])

  const inTree = useMemo(() => new Set(tree ? allPaneIds(tree) : []), [tree])

  const narrowTools = useMemo(
    () => (tree ? narrowToolPaneIds(tree, id => panes.find(pane => pane.id === id)) : new Set<string>()),
    [tree, panes]
  )

  const scopePanes = useMemo(
    () => new Set(workspaceShownPaneIds(panes.map(pane => pane.id))),
    // Scope atoms trigger reevaluation of the shared imperative resolver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panes, workspaceMode, workspaceOwnerKey]
  )

  const collapsibles = useMemo(
    // Solo adopts sidebar panes without their surrounding sidebar chrome.
    // Suppress every reveal path while those panes are intentionally hidden.
    () =>
      solo
        ? []
        : panes.filter(
            p =>
              (paneChrome(p).collapsible || narrowTools.has(p.id)) &&
              inTree.has(p.id) &&
              !hiddenPanes.has(p.id) &&
              (editMode || scopePanes.has(p.id)) &&
              (!workspacePage || workspacePageKeepsPane(p.id))
          ),
    [solo, panes, inTree, hiddenPanes, workspacePage, narrowTools, editMode, scopePanes]
  )

  useNarrowRevealControls(narrow, solo, reveal, setReveal)

  const revealed = useResolvedReveal(reveal, setReveal, collapsibles, tree)

  // Mirror the collapsed zone's tabs and keep explicit activations in view.
  const { group: revealedGroup, panes: zonePanes } = collapsedZonePanes(revealed, tree, collapsibles)
  const toolPanel = Boolean(revealedGroup && isToolPanelGroup(revealedGroup, id => panes.find(pane => pane.id === id)))
  const modePanes = sidebarModePanes(revealedGroup?.panes ?? [], zonePanes, !editMode)
  const compactSidebar = modePanes.length > 0
  useActiveTabVisible(tabsRef, revealed?.id ?? '', {
    enabled: overlayTabsNeedScroll(narrow, solo, Boolean(revealed), compactSidebar, toolPanel, zonePanes.length),
    last: zonePanes.at(-1)?.id === revealed?.id,
    tabCount: zonePanes.length
  })
  useEffect(() => {
    const active = narrow && !solo && reveal ? collapsibles.find(p => p.id === reveal.id) : undefined
    const zone = active && tree ? findGroupOfPane(tree, active.id) : null
    const visible = active ? collapsibles.filter(p => (zone ? zone.panes.includes(p.id) : p.id === active.id)) : []
    $narrowOverlayPaneIds.set(new Set(visible.flatMap(p => [p.id, ...(paneChrome(p).revealAliases ?? [])])))

    return () => $narrowOverlayPaneIds.set(new Set())
  }, [narrow, solo, reveal, collapsibles, tree])

  if (!narrow || solo || collapsibles.length === 0) {
    return null
  }

  const sideOf = (c: Contribution) => (paneChrome(c).placement === 'left' ? 'left' : 'right')
  const sides = [...new Set(collapsibles.map(sideOf))]

  // Size the overlay the way the pane's zone is sized while docked: declared
  // width refined by the user's drag override (fixedTrackSize), so a pane the
  // user narrowed stays narrowed here too — reading only data.width would
  // reset the overlay to the declared size on every reveal.
  const overlayWidth = revealed
    ? narrowOverlayWidth(
        { paneFor: id => panes.find(p => p.id === id), paneGone: () => false, overrides: paneStates },
        tree,
        revealed
      )
    : null

  return (
    <>
      {/* A touch screen has no hover to leave the overlay by, so the browser
          host closes it on a tap outside. Native Desktop lets that click reach
          the app and keeps the overlay until Escape, the toggle or hover-out. */}
      {revealed && hostHas('tapOutsideDismiss') && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-30"
          data-narrow-overlay-backdrop=""
          onPointerCancel={() => {
            outsidePress.current = null
          }}
          onPointerDown={event => {
            if (event.button === 0 && isTopEscapeLayer(ESCAPE_PRIORITY.narrowOverlay)) {
              // Dismissal must not focus the transcript or input underneath.
              event.preventDefault()
              outsidePress.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
            }
          }}
          onPointerLeave={() => {
            outsidePress.current = null
          }}
          onPointerMove={event => {
            const press = outsidePress.current

            if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
              outsidePress.current = null
            }
          }}
          onPointerUp={event => {
            const press = outsidePress.current
            outsidePress.current = null

            if (press?.id === event.pointerId && isTopEscapeLayer(ESCAPE_PRIORITY.narrowOverlay)) {
              event.preventDefault()
              setReveal(null)
            }
          }}
        />
      )}
      {/* Hover-intent strips on each edge that has a collapsed pane. */}
      {sides.map(side => (
        <div
          className={cn('absolute inset-y-0 z-30 w-1.5', side === 'left' ? 'left-0' : 'right-0')}
          key={side}
          onMouseEnter={() => {
            const first = collapsibles.find(p => sideOf(p) === side)

            if (first) {
              setReveal(current => (current?.pinned ? current : { id: first.id, pinned: false }))
            }
          }}
        />
      ))}

      {revealed && (
        <div
          className={cn(
            'absolute inset-y-0 z-40 flex flex-col overflow-hidden bg-(--ui-sidebar-surface-background) shadow-nous',
            sideOf(revealed) === 'left'
              ? 'left-0 border-r border-(--stroke-nous)'
              : 'right-0 border-l border-(--stroke-nous)'
          )}
          // Floats OVER the layout, so under glass its surface must mask the
          // panes beneath it — a see-through overlay reads as text bleeding
          // through text. Contract: `[data-glass-opaque]` in styles.css.
          data-glass-opaque=""
          data-narrow-overlay={revealed.id}
          data-tool-panel={toolPanel || undefined}
          data-tree-group={toolPanel ? revealedGroup?.id : undefined}
          onMouseLeave={onMouseLeave}
          ref={overlayRef}
          // Match the pane's docked width (sessions ~237px, files its rail
          // width) instead of a fat fixed 20rem — capped for tiny screens.
          // paddingTop keeps the tab strip below the native window controls
          // (macOS traffic lights); the spacer above keeps that band
          // draggable, mirroring TreeGroup's reservation.
          style={{
            paddingTop: hostHas('narrowOverlayChrome')
              ? titlebarHeight
              : wcOverlap
                ? wcOverlap.y + wcOverlap.height
                : undefined,
            width: `min(${overlayWidth}, 85vw)`
          }}
        >
          {wcOverlap && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-10 [-webkit-app-region:drag]"
              style={{ height: wcOverlap.height, left: wcOverlap.x, top: wcOverlap.y, width: wcOverlap.width }}
            />
          )}
          <NarrowOverlayTabs
            compactSidebar={compactSidebar}
            modePanes={modePanes}
            panes={panes}
            revealed={revealed}
            revealedGroup={revealedGroup}
            setReveal={setReveal}
            tabsRef={tabsRef}
            toolPanel={toolPanel}
            zonePanes={zonePanes}
          />
          <NarrowOverlayContent
            compactSidebar={compactSidebar}
            onMouseLeave={onMouseLeave}
            revealed={revealed}
            stableHosts={stableHosts}
            toolPanel={toolPanel}
            tree={tree}
            zonePanes={zonePanes}
          />
        </div>
      )}
    </>
  )
}

interface NarrowOverlayTabsProps {
  compactSidebar: boolean
  revealed: Contribution
  modePanes: readonly Contribution[]
  toolPanel: boolean
  revealedGroup: GroupNode | null | undefined
  tabsRef: RefObject<HTMLDivElement | null>
  zonePanes: readonly Contribution[]
  panes: readonly Contribution[]
  setReveal: Dispatch<SetStateAction<RevealState | null>>
}

function NarrowOverlayTabs({
  compactSidebar,
  revealed,
  modePanes,
  toolPanel,
  revealedGroup,
  tabsRef,
  zonePanes,
  panes,
  setReveal
}: NarrowOverlayTabsProps) {
  const { locale, t } = useI18n()
  const tabKeyboardProps = usePaneTabKeyboard(zonePanes.map(pane => pane.id), revealed.id, tabsRef)

  return (
    <>
      {/* Zone-mates share the overlay through the zone's own tab strip
              (SESSIONS | BOTS) — a lone pane keeps the stripless form. */}
      {compactSidebar ? (
        <SidebarModeHeader
          activeId={revealed.id}
          items={modePanes.map(pane => ({
            id: pane.id,
            title:
              pane.id === 'sessions'
                ? 'Aino'
                : localizedPaneTitle(t, pane.id, String(pane.title ?? pane.id), pane.source, locale),
            description: paneChrome(pane).sidebarDescription?.()
          }))}
          menuLabel={t.zones.sidebarModeMenu}
          onOpenChange={open => {
            // Clicking this hover-revealed menu is an explicit intent to
            // keep the rail open while its portal extends into the page.
            if (open) {
              setReveal(current => (current ? { ...current, pinned: true } : null))
            }
          }}
          onSelect={paneId => {
            clearTabSelection()

            if (revealedGroup) {
              activateTreePane(revealedGroup.id, paneId)
            }

            setReveal({ id: paneId, pinned: true })
          }}
        />
      ) : (
        (toolPanel || zonePanes.length > 1) && (
          <PaneTabStrip
            listRef={tabsRef}
            trailing={
              toolPanel && revealedGroup ? (
                <ToolPanelControls
                  activate={id => {
                    activateTreePane(revealedGroup.id, id)
                    setReveal({ id, pinned: true })
                  }}
                  canMaximize={false}
                  groupId={revealedGroup.id}
                  onHide={() => setReveal(null)}
                  panes={zonePanes.map(pane => pane.id)}
                  title={id => {
                    const pane = panes.find(item => item.id === id)

                    return localizedPaneTitle(t, id, String(pane?.title ?? id), pane?.source, locale)
                  }}
                />
              ) : undefined
            }
            variant={toolPanel ? 'tool' : 'default'}
          >
            {zonePanes.map(pane => (
              <PaneTab
                {...tabKeyboardProps(pane.id)}
                active={pane.id === revealed.id}
                aria-selected={pane.id === revealed.id}
                data-narrow-overlay-tab={pane.id}
                key={pane.id}
                onActivate={() => {
                  if (revealedGroup) {activateTreePane(revealedGroup.id, pane.id)}
                  setReveal(current => ({ id: pane.id, pinned: current?.pinned ?? false }))
                }}
                onClose={
                  toolPanel && !paneChrome(pane).hideOnly && !paneChrome(pane).uncloseable
                    ? () => closeTabPane(pane.id)
                    : undefined
                }
                onPointerDown={event => {
                  if (event.button === 0) {
                    event.preventDefault()

                    if (revealedGroup) {
                      activateTreePane(revealedGroup.id, pane.id)
                    }

                    setReveal(current => ({ id: pane.id, pinned: current?.pinned ?? false }))
                  }
                }}
                role="tab"
              >
                {toolPanel && paneChrome(pane).tabLead && (
                  <span className="ml-2 -mr-1 flex shrink-0 items-center">{paneChrome(pane).tabLead?.()}</span>
                )}
                <PaneTabLabel>
                  {localizedPaneTitle(t, pane.id, String(pane.title ?? pane.id), pane.source, locale)}
                </PaneTabLabel>
              </PaneTab>
            ))}
            {toolPanel && revealedGroup && (
              <PaneStripGlyph
                icon={<Codicon name="add" size="0.8125rem" />}
                label={t.zones.newTab}
                onSelect={() => {
                  openToolPanelChooser(revealedGroup.id)
                  setReveal({ id: TOOL_CHOOSER_PANE, pinned: true })
                }}
              />
            )}
          </PaneTabStrip>
        )
      )}
    </>
  )
}

interface NarrowOverlayContentProps {
  compactSidebar: boolean
  stableHosts: boolean
  revealed: Contribution
  tree: LayoutNode | null
  toolPanel: boolean
  zonePanes: readonly Contribution[]
  onMouseLeave: MouseEventHandler<HTMLDivElement>
}

function NarrowOverlayContent({
  compactSidebar,
  stableHosts,
  revealed,
  tree,
  toolPanel,
  zonePanes,
  onMouseLeave
}: NarrowOverlayContentProps) {
  return (
    <>
      <SidebarBrandContext value={compactSidebar}>
        {stableHosts && paneChrome(revealed).lifecycleKeepAlive ? (
          <div className="relative min-h-0 min-w-0 flex-1">
            <KeepAlivePaneSlot
              groupId={(tree && findGroupOfPane(tree, revealed.id)?.id) || NO_PANE_GROUP}
              headerVisible={toolPanel || zonePanes.length > 1}
              onMouseLeave={onMouseLeave}
              overlay
              paneId={revealed.id}
              visible
            />
          </div>
        ) : (
          <ContribBoundary id={revealed.id}>
            {revealed.render && <ContribRender render={revealed.render} />}
          </ContribBoundary>
        )}
      </SidebarBrandContext>
      {tree && findGroupOfPane(tree, revealed.id)?.panes.includes('sessions') && <Slot area="navigation.footer" />}
    </>
  )
}
