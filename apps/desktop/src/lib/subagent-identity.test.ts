import { describe, expect, it } from 'vitest'

import { subagentAvatarSeed, subagentDisplayName } from './subagent-identity'

describe('subagent presentation identity', () => {
  it('uses a supplied friendly name and keeps long task instructions out of its fallback label', () => {
    const goal = '查询 GitHub Trending 上最近的开源项目。重点抓取周榜和月榜，每个项目都要给出链接及分析。'
    expect(subagentDisplayName({ id: 'internal-id', displayName: '开源调研', goal }, 'Assistant')).toBe('开源调研')
    const label = subagentDisplayName({ id: 'internal-id', goal }, 'Assistant')
    expect(Array.from(label).length).toBeLessThanOrEqual(24)
    expect(label).not.toContain('重点抓取')
    expect(label).not.toContain('internal-id')
    expect(subagentDisplayName({ id: 'internal-id', goal: '' }, 'Assistant')).toBe('Assistant')
  })

  it('keeps the same avatar across renaming and distinguishes same-named children and parent scopes', () => {
    const first = { id: 'worker-a', displayName: 'Research', goal: 'Research sources' }
    expect(subagentAvatarSeed(first, 'parent')).toBe(subagentAvatarSeed({ ...first, displayName: 'Review' }, 'parent'))
    expect(subagentAvatarSeed(first, 'parent')).not.toBe(subagentAvatarSeed({ ...first, id: 'worker-b' }, 'parent'))
    expect(subagentAvatarSeed(first, 'parent')).not.toBe(subagentAvatarSeed(first, 'another-parent'))
    expect(subagentAvatarSeed({ ...first, id: 'fallback', subagentId: 'worker-a' }, 'parent')).toBe(
      subagentAvatarSeed(first, 'parent')
    )
  })
})
