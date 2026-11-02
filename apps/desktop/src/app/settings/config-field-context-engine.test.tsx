import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { stubMenuDomApis } from '@/test/jsdom'

import { ConfigField } from './config-field'
import { enumOptionsFor } from './helpers'

beforeAll(stubMenuDomApis)
afterEach(cleanup)

it('offers the engines discovered by the backend without adding phantom choices', async () => {
  const onChange = vi.fn()
  render(
    <ConfigField
      enumOptions={enumOptionsFor('context.engine', 'compressor', {}, ['compressor', 'installed-engine'])}
      onChange={onChange}
      schema={{ type: 'select', options: ['compressor', 'installed-engine'] }}
      schemaKey="context.engine"
      value="compressor"
    />
  )
  fireEvent.click(screen.getByRole('combobox'))
  expect(await screen.findByRole('option', { name: 'Compressor' })).toBeTruthy()
  const installed = screen.getByRole('option', { name: 'Installed-Engine' })
  expect(screen.queryByRole('option', { name: 'Default' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Custom' })).toBeNull()
  fireEvent.click(installed)
  expect(onChange).toHaveBeenCalledWith('installed-engine')
})

it('keeps a configured legacy engine visible without changing it on render', () => {
  const onChange = vi.fn()
  render(
    <ConfigField
      enumOptions={enumOptionsFor('context.engine', 'legacy-engine', {}, ['compressor'])}
      onChange={onChange}
      schema={{ type: 'select', options: ['compressor', 'legacy-engine'] }}
      schemaKey="context.engine"
      value="legacy-engine"
    />
  )
  expect(screen.getByRole('combobox').textContent).toContain('Legacy-Engine')
  expect(onChange).not.toHaveBeenCalled()
})

it('keeps the built-in engine visible with an older running backend schema', async () => {
  const onChange = vi.fn()
  render(
    <ConfigField
      enumOptions={enumOptionsFor('context.engine', 'compressor', {}, ['default', 'custom'])}
      onChange={onChange}
      schema={{ type: 'select', options: ['default', 'custom'] }}
      schemaKey="context.engine"
      value="compressor"
    />
  )
  expect(screen.getByRole('combobox').textContent).toContain('Compressor')
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('combobox'))
  expect(await screen.findByRole('option', { name: 'Compressor' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: 'Default' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Custom' })).toBeNull()
})

it('retains actual discovered engines named default or custom from the updated backend', () => {
  expect(enumOptionsFor('context.engine', 'compressor', {}, ['compressor', 'default', 'custom'])).toEqual([
    'compressor',
    'default',
    'custom'
  ])
  expect(enumOptionsFor('context.engine', 'custom', {}, ['default', 'custom'])).toEqual(['compressor', 'custom'])
})
