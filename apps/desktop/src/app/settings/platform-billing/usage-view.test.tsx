import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import type { PlatformUsageRow } from '../../../../shared/platform-contract'

import { UsageView } from './usage-view'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const receipt: PlatformUsageRow = {
  id: 'receipt',
  request_id: 'request-1',
  model: 'fixture-model',
  session_id: 'session-1',
  desktop_turn_id: 'turn-1',
  desktop_call_id: 'call-1',
  desktop_purpose: 'session_summary',
  actual_cost_decimal: '0.000000010',
  currency: 'USD',
  settlement_status: 'settled',
  created_at: '2026-09-22T08:09:10Z',
  input_tokens: 21,
  output_tokens: 0,
  cache_read_tokens: null
}

it('shows image output and server billing tier without equating provider quality with billing', () => {
  const imageReceipt = {
    ...receipt,
    desktop_purpose: 'image',
    model: 'Nano Banana 2',
    actual_cost_decimal: '0.201',
    image_count: 1,
    image_input_size: '1536x1024',
    image_output_size: '1264x848',
    image_size: '2K',
    image_size_source: 'output',
    image_size_breakdown: { '2K': 1 }
  }

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <UsageView rows={[imageReceipt]} variant="table" />
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
  expect(screen.getByText('实际输出尺寸', { selector: 'dt' }).parentElement?.textContent).toContain('1264 × 848 px')
  expect(screen.getByText('请求尺寸').parentElement?.textContent).toContain('1536 × 1024 px')
  expect(screen.getByText('图片尺寸档位').parentElement?.textContent).toContain('2K × 1')
  expect(screen.getByText('尺寸记录依据').parentElement?.textContent).toContain('实际输出尺寸')
  expect(screen.getByText(/画质名称不等同于图片尺寸档位/)).toBeTruthy()
  expect(screen.getByText('0.201 USD')).toBeTruthy()
})

it('shows actual image size, server tier and its source in the per-turn cost popover', () => {
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <UsageView
        rows={[
          {
            ...receipt,
            desktop_purpose: 'image',
            image_output_size: '1264x848',
            image_size: '2K',
            image_size_source: 'output'
          }
        ]}
      />
    </I18nProvider>
  )
  expect(screen.getByText(/实际输出尺寸: 1264 × 848 px · 图片尺寸档位: 2K/)).toBeTruthy()
  expect(screen.getByText('尺寸记录依据: 实际输出尺寸')).toBeTruthy()
})

it('keeps reserved image token counters out of the billing tier breakdown', () => {
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <UsageView
        rows={[
          {
            ...receipt,
            desktop_purpose: 'image',
            image_size: '4K',
            image_size_breakdown: { '4K': 1, image_cache_read_tokens: 40 }
          }
        ]}
      />
    </I18nProvider>
  )
  expect(screen.getByText(/图片尺寸档位: 4K × 1/)).toBeTruthy()
  expect(screen.queryByText(/image_cache_read_tokens/)).toBeNull()
})

it.each([undefined, '1536x1024'])(
  'does not invent output dimensions or a billing tier for historical image receipts (%s)',
  image_size => {
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <UsageView rows={[{ ...receipt, desktop_purpose: 'image', image_size }]} variant="table" />
      </I18nProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    expect(screen.getByText('实际输出尺寸').parentElement?.textContent).toContain('未记录')
    expect(screen.getByText('图片尺寸档位').parentElement?.textContent).toContain('未记录')
    expect(screen.queryByText('2K')).toBeNull()
  }
)

it('shows dated table records with precise purposes and expandable, copyable evidence without inventing missing tokens', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <UsageView rows={[receipt]} variant="table" />
    </I18nProvider>
  )
  const table = screen.getByRole('table')
  expect(within(table).getByRole('columnheader', { name: '调用时间' })).toBeTruthy()
  const timestamp = table.querySelector('time')!
  expect(timestamp.dateTime).toBe(receipt.created_at)
  const local = new Date(receipt.created_at)
  expect(timestamp.textContent).toContain(`${local.getFullYear()}`)
  expect(timestamp.textContent).toContain(
    [local.getHours(), local.getMinutes(), local.getSeconds()].map(value => String(value).padStart(2, '0')).join(':')
  )
  expect(within(table).getByText('会话摘要')).toBeTruthy()
  expect(within(table).getByText('0.00000001 USD')).toBeTruthy()
  expect(screen.queryByText('request-1')).toBeNull()
  fireEvent.click(within(table).getByRole('button', { name: '查看详情' }))
  expect(screen.getByText('request-1')).toBeTruthy()

  for (const [label, expected] of [
    ['输入 tokens', '21'],
    ['输出 tokens', '0'],
    ['缓存读取 tokens', '未记录'],
    ['缓存写入 tokens', '未记录']
  ]) {
    expect(screen.getByText(label).parentElement?.textContent).toContain(expected)
  }

  fireEvent.click(screen.getByRole('button', { name: '复制请求 ID' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('request-1'))
  fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
  expect(screen.queryByText('request-1')).toBeNull()
})

it('keeps compact receipts narrow and distinguishes legacy, unknown and pending records honestly', () => {
  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <UsageView
        rows={[
          { ...receipt, id: 'legacy', desktop_purpose: 'other_auxiliary', created_at: 'invalid' },
          {
            ...receipt,
            id: 'future',
            desktop_purpose: 'future_operation',
            settlement_status: 'pending',
            actual_cost_decimal: '9.00'
          },
          { ...receipt, id: 'missing', desktop_purpose: null }
        ]}
      />
    </I18nProvider>
  )
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByRole('list')).toBeTruthy()
  expect(screen.getByText('辅助调用（未细分）')).toBeTruthy()
  expect(screen.getByText(/历史记录未细分/)).toBeTruthy()
  expect(screen.getAllByText('用途未记录')).toHaveLength(2)
  expect(screen.getByText('future_operation')).toBeTruthy()
  expect(screen.getByText('费用尚未核实')).toBeTruthy()
  expect(screen.queryByText('9 USD')).toBeNull()
  expect(screen.queryByText(/Invalid Date/)).toBeNull()
})

it.each([
  ['zh', '生图'],
  ['en', 'Image generation']
] as const)('labels image receipts in %s', (locale, label) => {
  render(
    <I18nProvider configClient={null} initialLocale={locale}>
      <UsageView rows={[{ ...receipt, desktop_purpose: 'image' }]} />
    </I18nProvider>
  )
  expect(screen.getByText(label)).toBeTruthy()
})
