import { expect, it } from 'vitest'

import { TRANSLATIONS } from '@/i18n'
import { collaborationCopy } from '@/i18n/collaboration-capsule'
import type { CollaborationTask } from '@/store/collaboration-capsule'

import { collaborationSummary, collaborationTaskMeta } from './collaboration-presentation'

it('uses elapsed wall time for live work even when a progress event supplies zero duration, and freezes terminal time', () => {
  const task = { status: 'running', startedAt: 1000, updatedAt: 5000, durationSeconds: 0 } as CollaborationTask
  expect(collaborationTaskMeta(task, 18000, TRANSLATIONS.zh.agents)).toBe('17 秒')
  const ended = { ...task, status: 'interrupted', durationSeconds: undefined } as CollaborationTask
  expect(collaborationTaskMeta(ended, 18000, TRANSLATIONS.zh.agents)).toBe('4 秒')
  expect(collaborationTaskMeta(ended, 30000, TRANSLATIONS.zh.agents)).toBe('4 秒')
})

it('distinguishes stopped work from a successful completion receipt', () => {
  const tasks = [{ key: 'task', sourceKey: 'source', status: 'interrupted' }] as CollaborationTask[]
  const summary = collaborationSummary([{ tasks } as never], collaborationCopy('zh'), TRANSLATIONS.zh.agents)
  expect(summary.title).toBe('协作已停止')
  expect(summary.subtitle).toBe('已停止的任务尚未完成')
  expect(summary.Indicator.displayName).toBe('Square')
})
