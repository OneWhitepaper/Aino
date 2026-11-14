import type { Contribution } from '@/contrib/types'

import {
  allPaneIds,
  type DropPosition,
  findGroupOfPane,
  groupLeafIds,
  type GroupNode,
  insertAtGroup,
  type LayoutNode,
  movePane,
  removePane
} from './model'

/** A closed standing Files tab returns to the persisted tool workspace after reload. */
export function unifiedToolGroup(node: LayoutNode): GroupNode | undefined {
  if (node.type === 'group') {
    return node.toolPanel ? node : undefined
  }

  return node.children.map(unifiedToolGroup).find(Boolean)
}

export const hostsPreviewToolTab = (group: GroupNode): boolean =>
  Boolean(group.toolPanel) || group.panes.some(id => id.startsWith('preview-tile:'))

/** Presentation follows the existing tree; a user-stacked chat never disappears with tools. */
export function isToolPanelGroup(group: GroupNode, paneFor: (id: string) => Contribution | undefined): boolean {
  return (
    group.panes.length > 0 &&
    group.panes.every(id => {
      const pane = paneFor(id)

      // Bot schedules unregister outside a bot chat but keep their saved tab
      // position. Their known tool identity must outlive that registration.
      if (!pane && id === 'hermes-bots:routines') {
        return true
      }

      const data = pane?.data as { toolPanel?: boolean; uncloseable?: boolean } | undefined

      return Boolean(data?.toolPanel) && !data?.uncloseable
    })
  )
}

/** Recognize safe tool groups before saved preview contributions finish registering. */
export function isRestoredToolPanelGroup(group: GroupNode, paneFor: (id: string) => Contribution | undefined): boolean {
  const restoredPane = (id: string) =>
    paneFor(id) ??
    (id.startsWith('preview-tile:') || id === 'tool-new-tab'
      ? { id, area: 'panes', data: { toolPanel: true } }
      : undefined)

  return isToolPanelGroup(group, restoredPane)
}

/** A tool dock survives closing Files by reusing the remaining safe tool tabs. */
export function fallbackToolDockGroup(
  node: LayoutNode,
  pane: Contribution,
  paneFor: (id: string) => Contribution | undefined
): GroupNode | undefined {
  const data = pane.data as { toolPanel?: boolean; dock?: { pane: string; pos: string } } | undefined

  if (
    !data?.toolPanel ||
    data.dock?.pane !== 'files' ||
    data.dock.pos !== 'center' ||
    allPaneIds(node).includes('files')
  ) {
    return undefined
  }

  return allPaneIds(node)
    .map(id => findGroupOfPane(node, id)!)
    .find(group => !group.panes.includes(pane.id) && isRestoredToolPanelGroup(group, paneFor))
}

/** With no tool host left, a tool opens beside the conversation rather than over it. */
export function toolDockPosition(
  pane: Contribution,
  anchor: Contribution | undefined,
  position: DropPosition = 'center'
): DropPosition {
  const data = pane.data as { toolPanel?: boolean; dock?: { pane: string } } | undefined
  const anchorData = anchor?.data as { placement?: string } | undefined

  return data?.toolPanel && data.dock?.pane === 'files' && position === 'center' && anchorData?.placement === 'main'
    ? 'right'
    : position
}

/** A passive contribution can recreate a tool host, but only explicit reveal may open it. */
export function foldNewToolPanelGroups(
  before: LayoutNode,
  after: LayoutNode,
  paneFor: (id: string) => Contribution | undefined
): LayoutNode {
  const existing = new Set(groupLeafIds(before))

  const fold = (node: LayoutNode): LayoutNode => {
    if (node.type === 'group') {
      return !existing.has(node.id) && !node.minimized && isRestoredToolPanelGroup(node, paneFor)
        ? { ...node, toolPanel: true, minimized: true }
        : node
    }

    const children = node.children.map(fold)

    return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node
  }

  return fold(after)
}

/** Restore tool chrome before saved preview contributions finish registering. */
export function upgradeToolPanelPresentation(
  node: LayoutNode,
  paneFor: (id: string) => Contribution | undefined
): LayoutNode {
  if (node.type === 'group') {
    if (node.toolPanel) {
      return node
    }

    return isRestoredToolPanelGroup(node, paneFor) ? { ...node, toolPanel: true } : node
  }

  const children = node.children.map(child => upgradeToolPanelPresentation(child, paneFor))

  return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node
}

/** Saved tool decks become one tab host; conversation and plugin groups stay owned by their surfaces. */
export function consolidateRestoredToolPanels(
  original: LayoutNode,
  paneFor: (id: string) => Contribution | undefined,
  extractBuiltInTools = false
): LayoutNode {
  const extracted = extractBuiltInTools ? extractLegacyCoreTools(original, paneFor) : original

  if (extracted !== original) {
    return consolidateRestoredToolPanels(extracted, paneFor, true)
  }

  const ids = allPaneIds(original)

  const safeGroups = ids
    .map(id => findGroupOfPane(original, id)!)
    .filter(
      (group, index, groups) =>
        groups.findIndex(other => other.id === group.id) === index && isRestoredToolPanelGroup(group, paneFor)
    )

  const target =
    safeGroups.find(group => group.panes.includes('files')) ??
    safeGroups.find(group => group.toolPanel) ??
    safeGroups[0]

  if (!target) {
    return original
  }

  let tree = original

  for (const group of safeGroups) {
    if (group.id !== target.id) {
      for (const id of group.panes) {
        tree = movePane(tree, id, { groupId: target.id, pos: 'center' })
      }
    }
  }

  const mark = (node: LayoutNode): LayoutNode => {
    if (node.type === 'group') {
      if (node.id !== target.id || (node.toolPanel && node.active === target.active)) {
        return node
      }

      return { ...node, toolPanel: true, active: target.active }
    }

    const children = node.children.map(mark)

    return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node
  }

  return upgradeToolPanelPresentation(mark(tree), paneFor)
}

function extractLegacyCoreTools(tree: LayoutNode, paneFor: (id: string) => Contribution | undefined): LayoutNode {
  const core = new Set(['files', 'review', 'terminal', 'logs'])
  const ids = allPaneIds(tree)

  const eligible = (group: GroupNode) =>
    group.panes.every(
      id =>
        core.has(id) ||
        ['sessions', 'workspace', 'hermes-bots:pane'].includes(id) ||
        id.startsWith('session-tile:') ||
        id.startsWith('route-tile:')
    )

  const mixed = ids
    .map(id => findGroupOfPane(tree, id)!)
    .find(group => eligible(group) && group.panes.some(id => core.has(id)) && !isRestoredToolPanelGroup(group, paneFor))

  if (!mixed) {
    return tree
  }

  const tools = mixed.panes.filter(
    id => core.has(id) && Boolean((paneFor(id)?.data as { toolPanel?: boolean } | undefined)?.toolPanel)
  )

  if (!tools.length) {
    return tree
  }

  const host = ids.map(id => findGroupOfPane(tree, id)!).find(group => isRestoredToolPanelGroup(group, paneFor))
  let next = tree
  let target = host?.id

  for (const id of tools) {
    if (target) {
      next = movePane(next, id, { groupId: target, pos: 'center' })
    } else {
      const without = removePane(next, id)

      if (!without) {
        continue
      }

      next = insertAtGroup(without, mixed.id, id, 'right') ?? next
      target = findGroupOfPane(next, id)?.id
    }
  }

  return next
}
