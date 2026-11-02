import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { DefaultMainModel, type DefaultMainModelSource } from './default-main-model'

afterEach(cleanup)

it('keeps source changes as a draft and commits only through the common apply action', () => {
  const apply = vi.fn()

  function Form() {
    const [source, setSource] = useState<DefaultMainModelSource>('provider')

    return (
      <DefaultMainModel
        appliedModelLabel="saved-third-party-model"
        appliedSourceLabel="Third-party service"
        applying={false}
        builtinControls={<input aria-label="Built-in choice" defaultValue="builtin-draft" />}
        canApply
        customControls={<input aria-label="Custom choice" defaultValue="custom-draft" />}
        dirty={source === 'aino'}
        onApply={apply}
        onSourceChange={setSource}
        providerControls={<input aria-label="Third-party choice" defaultValue="original-draft" />}
        source={source}
      />
    )
  }

  render(
    <I18nProvider configClient={null} initialLocale="en">
      <Form />
    </I18nProvider>
  )
  const thirdPartyInput = screen.getByRole('textbox', { name: 'Third-party choice' })
  fireEvent.change(thirdPartyInput, { target: { value: 'retained-draft' } })
  expect((screen.getByRole('button', { name: 'Apply as default' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Aino built-in models' }))
  expect(screen.getByRole('textbox', { name: 'Built-in choice' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'Third-party choice' })).toBeNull()
  expect(screen.getByText('saved-third-party-model')).toBeTruthy()
  expect(apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Apply as default' }))
  expect(apply).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Third-party service' }))
  expect((screen.getByRole('textbox', { name: 'Third-party choice' }) as HTMLInputElement).value).toBe('retained-draft')
  fireEvent.click(screen.getByRole('button', { name: 'Custom models' }))
  expect(screen.queryByRole('textbox', { name: 'Third-party choice' })).toBeNull()
  expect((screen.getByRole('textbox', { name: 'Custom choice' }) as HTMLInputElement).value).toBe('custom-draft')
})

it('does not claim an unconfigured model is applied and blocks changes during a save', () => {
  const apply = vi.fn()
  const change = vi.fn()
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <DefaultMainModel
        appliedModelLabel=""
        appliedSourceLabel=""
        applying
        builtinControls={<span>Sign in to choose a model</span>}
        canApply
        customControls={<span>Connect a provider</span>}
        dirty
        onApply={apply}
        onSourceChange={change}
        providerControls={<span>Configure an API provider</span>}
        source="aino"
      />
    </I18nProvider>
  )
  expect(screen.getByText('No default model selected')).toBeTruthy()
  expect(screen.queryByText('Applied')).toBeNull()
  expect(screen.getByText('Sign in to choose a model')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Third-party service' }))
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Applying...' }))
  expect(apply).not.toHaveBeenCalled()
})
