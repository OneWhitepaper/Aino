import { atom } from 'nanostores'

import type { LayoutNode } from './model'

/** Ephemeral view only: maximize never rewrites the saved tree or destroys hidden resources. */
export const $maximizedToolGroup = atom<string | null>(null)

export function toggleToolGroupMaximized(groupId: string): void {
  $maximizedToolGroup.set($maximizedToolGroup.get() === groupId ? null : groupId)
}

export function containsMaximizedToolGroup(node: LayoutNode, maximized: string | null): boolean {
  return node.type === 'group'
    ? node.id === maximized
    : node.children.some(child => containsMaximizedToolGroup(child, maximized))
}
