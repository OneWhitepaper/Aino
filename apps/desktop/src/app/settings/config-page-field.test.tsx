import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { stubMenuDomApis } from '@/test/jsdom'

import { ConfigField } from './config-field'
import { ConfigPageField, type ConfigPageFieldProps } from './config-page-field'

beforeAll(stubMenuDomApis)
afterEach(cleanup)

it('lets a page override field copy and add a unit without changing numeric values or persistence', () => {
  const onChange = vi.fn()
  render(
    <ConfigField
      descriptionOverride="中文说明"
      labelOverride="中文标签"
      onChange={onChange}
      schema={{ type: 'number' }}
      schemaKey="custom.value"
      unit="秒"
      value={1.25}
    />
  )
  expect(screen.getByText('中文标签')).toBeTruthy()
  expect(screen.getByText('中文说明')).toBeTruthy()
  expect(screen.getByText('秒')).toBeTruthy()
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2.75' } })
  expect(onChange).toHaveBeenCalledExactlyOnceWith(2.75)
})

function field(props: ConfigPageFieldProps) {
  return (
    <I18nProvider configClient={null} initialLocale="zh">
      <ConfigPageField {...props} />
    </I18nProvider>
  )
}

describe('approved mode cards', () => {
  it.each([
    ['approvals.mode', ['manual', 'smart', 'off']],
    ['agent.image_input_mode', ['auto', 'native', 'text']],
    ['voice.voice_chat_mode', ['chained', 'gpt-live']]
  ])('presents %s as the existing choices and saves only a user selection', (schemaKey, options) => {
    const onChange = vi.fn()
    render(field({ schemaKey, schema: { type: 'select', options }, value: options[0], onChange }))

    expect(screen.getByRole('radiogroup')).toBeTruthy()
    const choices = screen.getAllByRole('radio')
    expect(choices).toHaveLength(options.length)
    expect((choices[0] as HTMLInputElement).checked).toBe(true)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(choices[1])
    expect(onChange).toHaveBeenCalledExactlyOnceWith(options[1])
  })

  it('retains and edits an unknown configured mode through the original control', async () => {
    const onChange = vi.fn()
    render(
      field({
        schemaKey: 'approvals.mode',
        schema: { type: 'select', options: ['manual', 'smart', 'off', 'future-mode'] },
        value: 'future-mode',
        onChange
      })
    )

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('combobox').textContent).toContain('Future-Mode')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Manual' }))
    expect(onChange).toHaveBeenCalledWith('manual')
  })

  it('keeps a newly discovered mode editable instead of dropping it from cards', () => {
    render(
      field({
        schemaKey: 'voice.voice_chat_mode',
        schema: { type: 'select', options: ['chained', 'gpt-live', 'plugin-engine'] },
        value: 'chained',
        onChange: vi.fn()
      })
    )
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('keeps the saved mode visible when an older schema omits it from its options', () => {
    const onChange = vi.fn()
    render(
      field({
        schemaKey: 'approvals.mode',
        schema: { type: 'select', options: ['manual', 'smart', 'off'] },
        value: 'legacy-policy',
        onChange
      })
    )

    expect(screen.getByRole('combobox').textContent).toContain('Legacy-Policy')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('percentage presentation', () => {
  it.each(['compression.threshold', 'compression.target_ratio'])(
    'preserves arbitrary existing %s precision and saves a percentage edit as the original ratio',
    schemaKey => {
      const onChange = vi.fn()
      render(field({ schemaKey, schema: { type: 'number' }, value: 0.5555, onChange }))

      const number = screen.getByRole('spinbutton') as HTMLInputElement
      const slider = screen.getByRole('slider') as HTMLInputElement
      expect(number.value).toBe('55.55')
      expect(slider.value).toBe('55.55')
      fireEvent.focus(number)
      fireEvent.blur(number)
      expect(onChange).not.toHaveBeenCalled()
      fireEvent.change(number, { target: { value: '37.125' } })
      fireEvent.blur(number)
      expect(onChange).toHaveBeenCalledExactlyOnceWith(0.37125)
    }
  )

  it('lets the shared slider reach both original ratio boundaries without saving on render', () => {
    const onChange = vi.fn()
    render(field({ schemaKey: 'compression.threshold', schema: { type: 'number' }, value: 0.5, onChange }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith(0)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '100' } })
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it('does not clamp an existing out-of-range value or an exact numeric edit', () => {
    const onChange = vi.fn()
    render(field({ schemaKey: 'compression.target_ratio', schema: { type: 'number' }, value: 1.2, onChange }))
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('120')
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('120')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-2.5' } })
    fireEvent.blur(screen.getByRole('spinbutton'))
    expect(onChange).toHaveBeenCalledWith(-0.025)
  })

  it('keeps an incomplete percentage draft local and shows a validation message', () => {
    const onChange = vi.fn()
    render(field({ schemaKey: 'compression.threshold', schema: { type: 'number' }, value: 0.5, onChange }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    fireEvent.blur(screen.getByRole('spinbutton'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})

describe('multiline list presentation', () => {
  it.each(['command_allowlist', 'toolsets'])(
    'keeps the %s draft local until blur and returns the original list shape',
    schemaKey => {
      const onChange = vi.fn()
      render(field({ schemaKey, schema: { type: 'list' }, value: ['first'], onChange }))

      const input = screen.getByRole('textbox')
      expect(input.tagName).toBe('TEXTAREA')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'first\n second, third\n' } })
      expect(onChange).not.toHaveBeenCalled()
      fireEvent.blur(input)
      expect(onChange).toHaveBeenCalledExactlyOnceWith(['first', 'second', 'third'])
    }
  )

  it('does not rewrite structured or malformed list values into strings', () => {
    const onChange = vi.fn()
    render(
      field({
        schemaKey: 'toolsets',
        schema: { type: 'list' },
        value: [{ plugin: 'unrecognized' }],
        onChange
      })
    )
    expect(screen.queryByRole('textbox')?.tagName).toBe('INPUT')
    expect(onChange).not.toHaveBeenCalled()
  })
})
