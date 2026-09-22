import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, userMessage } from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()
stubThreadViewportSize()
afterEach(cleanup)

function Harness({ running, onRestore }: { running: boolean; onRestore: () => void }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: [
      userMessage(),
      { ...assistantMessage(), status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' } }
    ],
    isRunning: running,
    onNew: async () => {},
    onEdit: async () => {},
    onCancel: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread onRestoreToMessage={onRestore} />
    </AssistantRuntimeProvider>
  )
}

it('keeps sent messages editable without a duplicate Stop and restores them after the turn ends', async () => {
  const onRestore = vi.fn()
  const { rerender } = render(<Harness onRestore={onRestore} running />)

  await screen.findByRole('button', { name: 'Edit message' })
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Restore checkpoint' })).toBeNull()

  rerender(<Harness onRestore={onRestore} running={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Restore checkpoint' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Restore & rerun' }))

  await waitFor(() => expect(onRestore).toHaveBeenCalledWith('user-1', { text: 'edit me please', userOrdinal: 0 }))
})
