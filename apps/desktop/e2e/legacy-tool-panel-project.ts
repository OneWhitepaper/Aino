import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import { expect } from './test'

export function prepareLegacyReviewProject(root: string, original: string, dirty: string) {
  const project = path.join(realpathSync(root), 'LegacyReviewProject')
  mkdirSync(project)
  mkdirSync(path.join(project, 'notes'))
  writeFileSync(path.join(project, 'notes', 'deep.txt'), 'Unified panel nested preview.\n')
  writeFileSync(path.join(project, 'README.md'), original)
  execFileSync('git', ['init', '--quiet', project])
  execFileSync('git', ['-C', project, 'add', '.'])
  execFileSync('git', [
    '-C',
    project,
    '-c',
    'user.name=Aino Test',
    '-c',
    'user.email=aino-test@example.com',
    'commit',
    '--quiet',
    '-m',
    'Legacy review isolated baseline'
  ])
  writeFileSync(path.join(project, 'README.md'), dirty)
  const baselineHead = execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

  return { project, baselineHead }
}

export function verifyLegacyReviewProject(project: string, baselineHead: string, dirty: string) {
  const gitDiff = execFileSync('git', ['-C', project, 'diff', '--', 'README.md'], { encoding: 'utf8' })

  expect(gitDiff).toContain('+Local working tree change.')
  expect(execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(baselineHead)
  expect(readFileSync(path.join(project, 'README.md'), 'utf8')).toBe(dirty)

  return gitDiff
}
