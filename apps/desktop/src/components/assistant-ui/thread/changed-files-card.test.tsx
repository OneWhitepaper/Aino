import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComposerScopeProvider, MAIN_COMPOSER_SCOPE } from '@/app/chat/composer/scope'
import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { en } from '@/i18n/en'
import { revealReview } from '@/store/review'

import { changedFileDisplayPath } from './changed-files'
import { ChangedFilesCard } from './changed-files-card'

vi.mock('@/store/review', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revealReview: vi.fn()
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const edit = (path: string, diff: string) => ({
  type: 'tool-call',
  toolName: 'patch',
  args: { path },
  result: { inline_diff: diff }
})

describe('changed-files summary', () => {
  it('counts each file once and totals all landed edits without counting pending calls', () => {
    const parts = [
      edit('/repo/src/a.ts', '-before\n+after\n+added'),
      edit('/repo/src/a.ts', '-old\n+updated'),
      edit('/repo/src/b.ts', '-previous\n+next'),
      { type: 'tool-call', toolName: 'patch', args: { path: '/repo/pending.ts' } }
    ]

    const ui = render(<ChangedFilesCard parts={parts} />)
    const review = screen.getByRole('button', { name: en.assistant.thread.reviewChanges })

    expect(screen.getByRole('region', { name: en.assistant.thread.filesChanged(2) })).toBeTruthy()
    expect(review.parentElement?.textContent).toContain('+4−3')
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /pending/ })).toBeNull()

    fireEvent.click(review)
    const recorded = within(screen.getByRole('dialog'))
    expect(recorded.getByText(en.assistant.thread.recordedFileEdit(1))).toBeTruthy()
    expect(recorded.getByText(en.assistant.thread.recordedFileEdit(2))).toBeTruthy()
    expect(recorded.getByText('before')).toBeTruthy()
    expect(recorded.getByText('updated')).toBeTruthy()
    expect(revealReview).not.toHaveBeenCalled()

    fireEvent.click(recorded.getByRole('button', { name: '/repo/src/b.ts' }))
    expect(within(screen.getByRole('dialog')).getByText('next')).toBeTruthy()
    expect(within(screen.getByRole('dialog')).queryByText('before')).toBeNull()

    ui.rerender(<ChangedFilesCard parts={[]} />)
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    ui.rerender(<ChangedFilesCard parts={parts} />)
    expect(screen.getByRole('region')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['primary', 'tile'] as const)('reviews the original path in its %s conversation scope', kind => {
    const cwd = '/repo'
    const target = kind === 'primary' ? 'main' : 'tile:42'
    render(
      <SessionViewProvider value={{ ...PRIMARY_SESSION_VIEW, kind, $cwd: atom(cwd) }}>
        <ComposerScopeProvider value={{ ...MAIN_COMPOSER_SCOPE, target }}>
          <ChangedFilesCard parts={[edit('/repo/src/a.ts', '-old\n+new')]} />
        </ComposerScopeProvider>
      </SessionViewProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts' }))
    const recorded = within(screen.getByRole('dialog'))
    expect(recorded.getByRole('button', { name: '/repo/src/a.ts', pressed: true })).toBeTruthy()
    expect(recorded.getByText('new')).toBeTruthy()
    expect(revealReview).not.toHaveBeenCalled()

    fireEvent.click(recorded.getByRole('button', { name: en.assistant.thread.reviewRepositoryChanges }))
    expect(revealReview).toHaveBeenCalledWith(kind === 'primary' ? null : cwd, target)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('returns focus on explicit close while preserving focus when the user leaves for the composer', async () => {
    render(
      <>
        <input aria-label="composer" />
        <ChangedFilesCard parts={[edit('/repo/a.ts', '-old\n+new')]} />
      </>
    )
    const trigger = screen.getByRole('button', { name: en.assistant.thread.reviewChanges })
    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }))
    await waitFor(() => expect(trigger.ownerDocument.activeElement).toBe(trigger))

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'composer' })
    act(() => composer.focus())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(composer.ownerDocument.activeElement).toBe(composer))
  })
})

describe('changed-file display paths', () => {
  it.each([
    ['/repo/src/a.ts', '/repo/', 'src/a.ts'],
    ['/repository/a.ts', '/repo', '/repository/a.ts'],
    ['src/a.ts', '/repo', 'src/a.ts'],
    ['/src/a.ts', '/', 'src/a.ts'],
    ['C:\\Repo\\src\\a.ts', 'c:/repo/', 'src/a.ts'],
    ['\\\\server\\repo\\src\\a.ts', '//SERVER/repo', 'src/a.ts'],
    ['/Users/person/other/a.ts', '/repo', '~/other/a.ts'],
    [
      '/Users/person/Library/Application Support/Aino/cache/scratch/project/check.cjs',
      '/repo',
      '…/scratch/project/check.cjs'
    ]
  ])('formats %s within %s without stripping an unrelated parent', (path, cwd, expected) => {
    expect(changedFileDisplayPath(path, cwd)).toBe(expected)
  })
})
