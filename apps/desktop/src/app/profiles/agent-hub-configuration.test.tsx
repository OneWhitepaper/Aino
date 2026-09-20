import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('./workspace-controls', () => ({ WorkspaceControls: () => null }))
vi.mock('@/contrib/react/use-contributions', () => ({ useContributions: () => [] }))
import { AgentHubConfiguration, ProfileConfigurationRedirect } from './agent-hub-configuration'

function Back() {
  const navigate = useNavigate()

  return <button onClick={() => navigate(-1)}>Back</button>
}

afterEach(cleanup)
it('replaces the old profile URL with configuration and returns to the preceding page; disabled Hub has a recovery link', () => {
  render(
    <MemoryRouter initialEntries={['/before', '/profiles']} initialIndex={1}>
      <Back />
      <Routes>
        <Route element={<div>Previous page</div>} path="/before" />
        <Route element={<ProfileConfigurationRedirect />} path="/profiles" />
        <Route element={<AgentHubConfiguration />} path="/agent-hub/configuration" />
      </Routes>
    </MemoryRouter>
  )
  expect(screen.getByRole('status').textContent).toContain('Enable the Agent Hub plugin')
  expect(screen.getByRole('link').getAttribute('href')).toContain('/settings')
  fireEvent.click(screen.getByText('Back'))
  expect(screen.getByText('Previous page')).toBeTruthy()
})
