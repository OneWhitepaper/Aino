import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectInfo } from '@/types/hermes'

import { makeCwdSession } from '../test/session-info'

import { $projects } from './projects'
import { $sessions } from './session'
import { $sessionColorById, sessionColorFor } from './session-color'

function makeProject(id: string, folders: string[], color: null | string): ProjectInfo {
  return {
    archived: false,
    board_slug: null,
    color,
    created_at: 0,
    description: null,
    folders: folders.map((path, i) => ({ added_at: 0, is_primary: i === 0, label: null, path })),
    icon: null,
    id,
    name: id,
    primary_path: folders[0] ?? null,
    slug: id
  }
}

afterEach(() => {
  $sessions.set([])
  $projects.set([])
})

describe('$sessionColorById', () => {
  it('maps each session under a colored project to that color, keyed by live id', () => {
    const a = makeCwdSession('/www/app/src', { git_repo_root: '/www/app' })
    const b = makeCwdSession('/other/place')

    $projects.set([makeProject('p_app', ['/www/app'], '#4a9eff')])
    $sessions.set([a, b])

    const map = $sessionColorById.get()

    expect(map[a.id]).toBe('#4a9eff')
    // Sessions with no colored project are absent (a sparse map, not null-filled).
    expect(b.id in map).toBe(false)
  })

  it('recomputes when the projects list changes (color applied later)', () => {
    const a = makeCwdSession('/www/app', { git_repo_root: '/www/app' })

    $sessions.set([a])
    $projects.set([makeProject('p_app', ['/www/app'], null)])
    expect($sessionColorById.get()[a.id]).toBeUndefined()

    $projects.set([makeProject('p_app', ['/www/app'], '#7bc86c')])
    expect($sessionColorById.get()[a.id]).toBe('#7bc86c')
  })
})

describe('sessionColorFor', () => {
  it('reads a single session through the same shared map', () => {
    const a = makeCwdSession('/www/app', { git_repo_root: '/www/app' })

    $projects.set([makeProject('p_app', ['/www/app'], '#5865f2')])
    $sessions.set([a])

    expect(sessionColorFor(a)).toBe('#5865f2')
  })

  it('returns undefined for a null/absent session', () => {
    expect(sessionColorFor(null)).toBeUndefined()
    expect(sessionColorFor(undefined)).toBeUndefined()
  })
})
