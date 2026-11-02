import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { WorkspaceListInput } from './workspace-settings'

afterEach(cleanup)

function DeferredList({ approve, initial = ['hermes-cli'] }: { approve: Promise<boolean>; initial?: string[] }) {
  const [value, setValue] = useState(initial)

  return (
    <>
      <WorkspaceListInput
        label="Toolsets"
        onChange={next => {
          void approve.then(accepted => {
            if (accepted) {
              setValue(next)
            }
          })
        }}
        placeholder="One per line"
        value={value}
      />
      <output aria-label="Saved toolsets">{JSON.stringify(value)}</output>
    </>
  )
}

it('shows the retained toolsets while clearing awaits approval and after cancellation', async () => {
  let resolve!: (value: boolean) => void

  const approve = new Promise<boolean>(done => {
    resolve = done
  })

  render(<DeferredList approve={approve} />)
  const input = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.blur(input)

  expect(input.value).toBe('hermes-cli')
  expect(screen.getByLabelText('Saved toolsets').textContent).toBe('["hermes-cli"]')
  await act(async () => resolve(false))
  expect(input.value).toBe('hermes-cli')
  expect(screen.getByLabelText('Saved toolsets').textContent).toBe('["hermes-cli"]')
})

it('shows the empty toolsets only after clearing is approved by the existing owner', async () => {
  let resolve!: (value: boolean) => void

  const approve = new Promise<boolean>(done => {
    resolve = done
  })

  render(<DeferredList approve={approve} />)
  const input = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.blur(input)
  expect(input.value).toBe('hermes-cli')

  await act(async () => resolve(true))
  expect(input.value).toBe('')
  expect(screen.getByLabelText('Saved toolsets').textContent).toBe('[]')
})

it('adopts an external value after focus without resubmitting the stale unedited list', () => {
  const onChange = vi.fn()

  const editor = (value: string[]) => (
    <WorkspaceListInput label="Toolsets" onChange={onChange} placeholder="One per line" value={value} />
  )

  const { rerender } = render(editor(['old']))
  const input = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.focus(input)
  rerender(editor(['external']))
  fireEvent.blur(input)

  expect(input.value).toBe('external')
  expect(onChange).not.toHaveBeenCalled()
})

it('retains a typed draft during same-owner refresh and commits it once through the owner', () => {
  const onChange = vi.fn()

  const editor = (value: string[]) => (
    <WorkspaceListInput label="Toolsets" onChange={onChange} placeholder="One per line" value={value} />
  )

  const { rerender } = render(editor(['old']))
  const input = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'my-draft\n next' } })
  rerender(editor(['external']))
  expect(input.value).toBe('my-draft\n next')
  fireEvent.blur(input)

  expect(onChange).toHaveBeenCalledExactlyOnceWith(['my-draft', 'next'])
  expect(input.value).toBe('external')
  rerender(editor(['my-draft', 'next']))
  expect(input.value).toBe('my-draft\nnext')
})

it('drops a pending draft at the existing keyed scope boundary without submitting it to the next owner', () => {
  const firstChange = vi.fn()
  const secondChange = vi.fn()

  const { rerender } = render(
    <WorkspaceListInput
      key="first-owner"
      label="Toolsets"
      onChange={firstChange}
      placeholder="One per line"
      value={['first']}
    />
  )

  const input = screen.getByRole('textbox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'first-draft' } })

  rerender(
    <WorkspaceListInput
      key="second-owner"
      label="Toolsets"
      onChange={secondChange}
      placeholder="One per line"
      value={['second']}
    />
  )
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('second')
  expect(firstChange).not.toHaveBeenCalled()
  expect(secondChange).not.toHaveBeenCalled()
})
