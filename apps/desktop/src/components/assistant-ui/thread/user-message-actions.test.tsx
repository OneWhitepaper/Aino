import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { $touchPointer } from '@/lib/touch-interaction'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, userMessage } from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()
stubThreadViewportSize()
afterEach(() => {
  cleanup()
  $touchPointer.set(false)
})

function Harness({
  running,
  onRestore,
  onCancel = async () => {}
}: {
  running: boolean
  onRestore: () => void
  onCancel?: () => Promise<void>
}) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: [
      userMessage(),
      { ...assistantMessage(), status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' } }
    ],
    isRunning: running,
    onNew: async () => {},
    onEdit: async () => {},
    onCancel
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread onCancel={onCancel} onRestoreToMessage={onRestore} />
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

it('lets a touch user stop the latest running prompt from its bubble', async () => {
  $touchPointer.set(true)
  const onCancel = vi.fn(async () => {})
  render(<Harness onCancel={onCancel} onRestore={vi.fn()} running />)

  fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))

  await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  expect(screen.queryByRole('button', { name: 'Restore checkpoint' })).toBeNull()
})
