import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { beginPreviewOperation, resumePreview } from './preview-agent-control'
import { PreviewAgentStatus } from './preview-agent-status'

afterEach(cleanup)

describe('browser toolbar operation status', () => {
  it('shows operation progress and lets the user take over and return control', () => {
    const operation = beginPreviewOperation('toolbar-control', 'observing')
    render(<PreviewAgentStatus tabId="toolbar-control" />)
    expect(screen.getByRole('status').textContent).toBe('AI observing')
    act(() => operation.setPhase('acting'))
    expect(screen.getByRole('status').textContent).toBe('AI operating')
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
    expect(operation.signal.aborted).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('You are in control')
    operation.release()
    fireEvent.click(screen.getByRole('button', { name: 'Return to AI' }))
    expect(screen.getByRole('status').textContent).toBe('AI ready')
    expect(screen.getByRole('button', { name: 'Take over' })).toBeTruthy()
    resumePreview('toolbar-control')
  })

  it('shows only the status of its own browser tab', () => {
    const operation = beginPreviewOperation('other-tab', 'acting')
    render(<PreviewAgentStatus tabId="idle-tab" />)
    expect(screen.getByRole('status').textContent).toBe('AI ready')
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
    expect(screen.getByRole('status').textContent).toBe('You are in control')
    operation.release()
    resumePreview('idle-tab')
  })
})
