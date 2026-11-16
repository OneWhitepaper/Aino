import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { useDeepLinkHighlight } from './use-deep-link-highlight'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function SettingsTarget() {
  useDeepLinkHighlight({
    elementId: field => `setting-field-${field}`,
    param: 'field',
    ready: () => true
  })

  return (
    <>
      <details aria-label="Advanced model settings">
        <summary>Default parameters</summary>
        <details aria-label="Model parameters">
          <summary>Context</summary>
          <div id="setting-field-model_context_length">
            <label>
              Context length
              <input defaultValue="32000" />
            </label>
          </div>
        </details>
      </details>
      <output data-testid="route">{useLocation().search}</output>
    </>
  )
}

it('reveals collapsed settings before focusing a deep link and retains its profile route', async () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll

  const view = render(
    <MemoryRouter initialEntries={['/settings?field=model_context_length&profile=research&owner=remote-a']}>
      <SettingsTarget />
    </MemoryRouter>
  )

  expect(Array.from(view.container.querySelectorAll('details')).every(details => !details.open)).toBe(true)

  await waitFor(() => {
    expect(Array.from(view.container.querySelectorAll('details')).every(details => details.open)).toBe(true)
    expect(new URLSearchParams(screen.getByTestId('route').textContent ?? '').has('field')).toBe(false)
  })

  expect(screen.getByRole('textbox', { name: 'Context length' })).toBeTruthy()
  expect(view.container.ownerDocument.activeElement?.id).toBe('setting-field-model_context_length')
  expect(scroll).toHaveBeenCalledOnce()
  const route = new URLSearchParams(screen.getByTestId('route').textContent ?? '')
  expect(route.has('field')).toBe(false)
  expect(route.get('profile')).toBe('research')
  expect(route.get('owner')).toBe('remote-a')
})
