import { fromThreadMessageLike, getAutoStatus } from '@assistant-ui/core/internal'
import {
  AssistantRuntimeProvider,
  type ExportedMessageRepository,
  type ThreadMessage,
  useAuiState
} from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { memo, StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { useIncrementalExternalStoreRuntime } from '@/lib/incremental-external-store-runtime'
import { $paneStates } from '@/store/panes'

import { group, split } from '../model'
import {
  $collapsedTreeSides,
  $hiddenTreePanes,
  $layoutTree,
  $narrowViewport,
  mirrorLayoutTree,
  setTreeGroupMinimized
} from '../store'

import { layoutRequiredWidth } from './required-width'
import { isNavigationGroup } from './track-model'
import { TreeSplit } from './tree-split'

const status = getAutoStatus(false, false, false, false, undefined)

const transcript = (id: string, text = id): ExportedMessageRepository => ({
  headId: id,
  messages: [
    {
      message: fromThreadMessageLike({ role: 'assistant', content: [{ type: 'text', text }] }, id, status),
      parentId: null
    }
  ]
})

const $repository = atom(transcript('First conversation'))

function Transcript() {
  const text = useAuiState(state =>
    state.thread.messages
      .flatMap(message => message.content.flatMap(part => (part.type === 'text' ? [part.text] : [])))
      .join(',')
  )

  return <p>{text}</p>
}

const Chat = memo(function Chat() {
  const repository = useStore($repository)

  const runtime = useIncrementalExternalStoreRuntime<ThreadMessage>({
    messageRepository: repository,
    isRunning: false,
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Transcript />
      <textarea aria-label="Draft" defaultValue="Keep this draft" />
    </AssistantRuntimeProvider>
  )
})

function Workspace() {
  const tree = useStore($layoutTree)

  return tree?.type === 'split' ? <TreeSplit node={tree} root rootRow /> : null
}

const disposers: (() => void)[] = []

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  $repository.set(transcript('First conversation'))
  $collapsedTreeSides.set(new Set())
  $hiddenTreePanes.set(new Set())
  $narrowViewport.set(false)
  $paneStates.set({})
  disposers.push(
    registry.register({
      area: 'panes',
      data: { placement: 'main' },
      id: 'chat',
      render: () => <Chat />,
      title: 'Chat'
    }),
    registry.register({
      area: 'panes',
      data: { hideOnly: true, placement: 'left', width: '200px' },
      id: 'navigation',
      render: () => <aside>Navigation</aside>,
      title: 'Navigation'
    })
  )
  $layoutTree.set(
    split('row', [group(['navigation'], { id: 'nav-zone' }), group(['chat'], { id: 'chat-zone' })], [1, 4], 'workspace')
  )
})

afterEach(() => {
  cleanup()
  $layoutTree.set(null)
  $paneStates.set({})
  disposers.splice(0).forEach(dispose => dispose())
  vi.unstubAllGlobals()
})

describe('sidebar swaps preserve the live workspace', () => {
  it('reserves the chat width when the workspace also contains a vertical terminal split', () => {
    disposers.push(
      registry.register({
        area: 'panes',
        id: 'chat',
        title: 'Chat',
        data: { placement: 'main', minWidth: '320px' },
        render: () => <Chat />
      }),
      registry.register({ area: 'panes', id: 'terminal', title: 'Terminal', render: () => <div>Terminal</div> })
    )
    $layoutTree.set(
      split('row', [
        group(['navigation'], { id: 'nav-zone' }),
        split('column', [group(['chat'], { id: 'chat-zone' }), group(['terminal'], { id: 'terminal-zone' })])
      ])
    )
    const { container } = render(<Workspace />)
    expect(layoutRequiredWidth(container)).toBe(520)
  })

  it.each([
    { label: 'registered navigation', panes: ['navigation'] },
    { label: 'navigation with an unavailable Bot contribution', panes: ['navigation', 'hermes-bots:pane'] }
  ])('hides minimized $label completely and restores it without touching the conversation', ({ panes }) => {
    $layoutTree.set(
      split('row', [group(panes, { id: 'nav-zone' }), group(['chat'], { id: 'chat-zone' })], [1, 4], 'workspace')
    )
    const { container } = render(<Workspace />)
    const draft = screen.getByRole('textbox', { name: 'Draft' })

    fireEvent.change(draft, { target: { value: 'Keep while navigation is hidden' } })
    act(() => setTreeGroupMinimized('nav-zone', true))

    const track = container.querySelector<HTMLElement>('[data-tree-track="nav-zone"]')!

    expect(track.style.display).toBe('none')
    expect(within(track).queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)

    act(() => setTreeGroupMinimized('nav-zone', false))
    expect(track.style.display).not.toBe('none')
    expect(screen.getByText('Navigation')).toBeTruthy()
    expect((draft as HTMLTextAreaElement).value).toBe('Keep while navigation is hidden')
  })

  it('requires a registered navigation pane and never classifies tools or main content as navigation', () => {
    disposers.push(
      registry.register({
        area: 'panes',
        id: 'review',
        data: { placement: 'right', toolPanel: true },
        render: () => null
      })
    )
    const paneFor = (id: string) => registry.getArea('panes').find(pane => pane.id === id)

    expect(isNavigationGroup(group(['unregistered']), paneFor)).toBe(false)
    expect(isNavigationGroup(group(['review']), paneFor)).toBe(false)
    expect(isNavigationGroup(group(['navigation', 'review']), paneFor)).toBe(false)
    expect(isNavigationGroup(group(['navigation', 'chat']), paneFor)).toBe(false)
  })

  it('continues updating the conversation after swapping without losing the composer', async () => {
    render(
      <StrictMode>
        <Workspace />
      </StrictMode>
    )
    await screen.findByText('First conversation')
    const draft = screen.getByRole('textbox', { name: 'Draft' })
    fireEvent.change(draft, { target: { value: 'Unsent draft' } })

    await act(async () => $repository.set(transcript('First conversation', 'Updated response')))
    await screen.findByText('Updated response')
    act(() => mirrorLayoutTree())
    act(() => mirrorLayoutTree())
    await act(async () => $repository.set(transcript('Second conversation')))

    await screen.findByText('Second conversation')
    expect(screen.queryByText('Updated response')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
    expect((draft as HTMLTextAreaElement).value).toBe('Unsent draft')
  })

  it('resizes the visible navigation/chat boundary after their positions swap', () => {
    const { container } = render(<Workspace />)
    act(() => mirrorLayoutTree())
    const row = container.querySelector<HTMLElement>('[data-tree-split="workspace"]')!
    const navigation = container.querySelector<HTMLElement>('[data-tree-group="nav-zone"]')!
    const chat = container.querySelector<HTMLElement>('[data-tree-group="chat-zone"]')!

    const width = (element: HTMLElement, value: number) =>
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, value, 600))

    width(row, 1000)
    width(navigation, 200)
    width(navigation.parentElement!, 200)
    width(chat, 800)
    width(chat.parentElement!, 800)

    const sash = screen.getByRole('separator')
    fireEvent.pointerDown(sash, { button: 0, clientX: 800, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerMove(window, { clientX: 700, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerUp(window, { clientX: 700, pointerId: 1, pointerType: 'mouse' })

    expect($paneStates.get().navigation?.widthOverride).toBe(300)
    const tree = $layoutTree.get()
    expect(tree?.type === 'split' && tree.children.map(child => child.id)).toEqual(['chat-zone', 'nav-zone'])
  })
})
