import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'

import { ReplyMetrics } from './reply-metrics'
import { ResponseProcess } from './response-group'

afterEach(cleanup)

it('keeps usage details accessible when the process header already shows the duration', () => {
  const view = render(
    <I18nProvider configClient={null} initialLocale="en">
      <ResponseProcess.Provider value={{ enabled: true, open: false, answerMessageId: 'answer' }}>
        <ReplyMetrics durationS={30} metrics={{ input_tokens: 42 }} />
      </ResponseProcess.Provider>
    </I18nProvider>
  )

  const details = view.container.querySelector('details')!
  expect(details.querySelector('summary')?.textContent?.trim()).toBeTruthy()
  expect(details.textContent).toContain('42')
  expect(view.container.textContent).not.toContain('0:30')
})

it('neutrally labels explicit non-Aino calls without claiming a local provider charged', () => {
  const view = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <ReplyMetrics metrics={{ duration_s: 2, non_aino_model_calls: true }} />
    </I18nProvider>
  )

  const label = screen.getByText('此回复使用了 Aino 以外的模型调用。')
  expect(label).toBeTruthy()
  expect(label.textContent).not.toMatch(/费用|收费|计费/)

  view.rerender(
    <I18nProvider configClient={null} initialLocale="zh">
      <ReplyMetrics metrics={{ duration_s: 2 }} />
    </I18nProvider>
  )

  expect(screen.queryByText('此回复使用了 Aino 以外的模型调用。')).toBeNull()
})

it('keeps the Aino cost surface alongside a mixed-turn non-Aino disclosure', () => {
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <ReplyMetrics
        metrics={{
          duration_s: 2,
          non_aino_model_calls: true,
          billing: {
            source: 'aino',
            user_id: '17',
            session_id: '6ccf86e3-f42c-4d1b-9fbe-9b7ea58a03ca',
            turn_id: 'b8664a58-472a-4ba6-b853-94aadee41bb1',
            status: 'pending',
            calls: [{ call_id: 'cbec3bce-4de2-4fbe-a6ee-5ab3e7d990cb', purpose: 'chat' }],
            calls_complete: true,
            revision: 2
          }
        }}
      />
    </I18nProvider>
  )

  expect(screen.getByText('此回复使用了 Aino 以外的模型调用。')).toBeTruthy()
  expect(screen.getByText('登录原账户后查看费用')).toBeTruthy()
})
