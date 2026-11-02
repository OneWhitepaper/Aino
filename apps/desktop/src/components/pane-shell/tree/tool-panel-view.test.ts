import { describe, expect, it } from 'vitest'

import { group, split } from './model'
import { $maximizedToolGroup, containsMaximizedToolGroup, toggleToolGroupMaximized } from './tool-panel-view'

describe('tool panel maximize view', () => {
  it('selects the exact nested branch and restores without replacing the tree', () => {
    const files = group(['files'], { id: 'files', toolPanel: true })
    const tree = split('row', [group(['workspace']), files])
    toggleToolGroupMaximized('files')
    expect(containsMaximizedToolGroup(tree, $maximizedToolGroup.get())).toBe(true)
    expect(containsMaximizedToolGroup(tree.children[0]!, $maximizedToolGroup.get())).toBe(false)
    expect(containsMaximizedToolGroup(files, $maximizedToolGroup.get())).toBe(true)
    toggleToolGroupMaximized('files')
    expect($maximizedToolGroup.get()).toBeNull()
    expect(tree.children[1]).toBe(files)
  })
})
