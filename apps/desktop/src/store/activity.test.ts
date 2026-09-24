import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import type { PreviewServerRestart } from '@/store/preview'
import type { ActionStatusResponse, SessionInfo } from '@/types/hermes'

import { buildRailTasks } from './activity'

const session = (overrides: Partial<SessionInfo> = {}): SessionInfo =>
  ({
    ended_at: null,
    id: 'session-1',
    input_tokens: 0,
    is_active: true,
    last_active: 100,
    message_count: 0,
    model: null,
    output_tokens: 0,
    title: null,
    ...overrides
  }) as SessionInfo

const action = (overrides: Partial<ActionStatusResponse> = {}): ActionStatusResponse => ({
  exit_code: null,
  lines: [],
  name: '同步模型',
  pid: 42,
  running: true,
  ...overrides
})

const preview: PreviewServerRestart = {
  status: 'running',
  taskId: 'preview-1',
  url: 'http://127.0.0.1:3000'
}

describe('activity rail copy', () => {
  beforeEach(() => {
    setRuntimeI18nLocale('zh')
  })

  afterEach(() => {
    setRuntimeI18nLocale('en')
  })

  it('localizes session, preview, and action status labels', () => {
    const tasks = buildRailTasks(['missing-session'], [], preview, {
      action: { status: action(), updatedAt: 200 }
    })

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: '智能体任务运行中', id: 'session:missing-session', label: '会话任务' }),
        expect.objectContaining({ detail: 'http://127.0.0.1:3000', id: 'preview:preview-1', label: '重启预览' }),
        expect.objectContaining({ detail: '运行中', id: 'action:同步模型', label: '同步模型' })
      ])
    )
  })

  it('localizes completed and failed action details while preserving exit codes', () => {
    const tasks = buildRailTasks([], [], null, {
      failed: {
        status: action({ exit_code: 7, name: '失败操作', pid: null, running: false }),
        updatedAt: 200
      },
      succeeded: {
        status: action({ exit_code: 0, name: '成功操作', pid: null, running: false }),
        updatedAt: 100
      }
    })

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: '失败（7）', id: 'action:失败操作' }),
        expect.objectContaining({ detail: '已完成', id: 'action:成功操作' })
      ])
    )
  })
})
