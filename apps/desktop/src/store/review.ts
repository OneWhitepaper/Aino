import { atom, computed } from 'nanostores'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { isPaneVisible, revealTreePane } from '@/components/pane-shell/tree/store'
import type { HermesReviewFile, HermesReviewShipInfo } from '@/global'
import { matchesQuery } from '@/hooks/use-media-query'
import { translateNow } from '@/i18n/runtime'
import { desktopGit } from '@/lib/desktop-git'
import { isExcludedPath } from '@/lib/excluded-paths'
import { requestOneShot } from '@/lib/oneshot'
import { Codecs, persistentAtom } from '@/lib/persisted'
import { modeBound } from '@/store/interface-mode'

import { refreshRepoStatus, repoStatusForCwd } from './coding-status'
import { $activeConnectionId } from './connections'
import { $activeGatewayProfile } from './profile'
import { stampSessionPrBranch } from './pull-requests'
import { $busy, $currentCwd, $selectedStoredSessionId, $sessions } from './session'
import { $toolSession, $toolWorkspaceCwd, toolSessionHasCurrentSource } from './tool-session'
import { $workspaceChangeTick, notifyWorkspaceChanged } from './workspace-events'

// State for the review pane: the working-tree changed-file list, the selected
// file's diff, and the git mutations (stage / unstage / revert). The active
// session's cwd is the repo; the pane reads git as the source of truth, the
// same bounded "re-probe on structural edges" model as the coding rail.
//
// Scope is always "uncommitted" — Hermes' flow is agent edits you review BEFORE
// committing, so branch/last-turn scopes are almost always empty here (unlike
// Codex, which commits per turn). We show the one view that's always populated.

// Must match the review <Pane id> in desktop-controller (the forced-reveal
// event is addressed by pane id).
export const REVIEW_PANE_ID = 'review'

const OPEN_KEY = 'hermes.desktop.reviewOpen'
const COMMIT_DEFAULT_KEY = 'hermes.desktop.reviewCommitDefault'
const TREE_MODE_KEY = 'hermes.desktop.reviewTreeMode'
const SELECTED_KEY = 'hermes.desktop.reviewSelectedPath'
const REVIEW_REFRESH_DEBOUNCE_MS = 100
const SHIP_INFO_STALE_MS = 30_000

// Persisted so the pane stays open across reloads (like the other rail panes).
// Simple mode rests it closed without touching the preference; ⌘G still opens
// it for the session.
const $reviewOpenPref = persistentAtom(OPEN_KEY, false, Codecs.bool)

export const $reviewOpen = modeBound('reviewOpen', $reviewOpenPref, open => $reviewOpenPref.set(open))

// The split-button's remembered default action ('commit' | 'commitPush').
export type CommitAction = 'commit' | 'commitPush'

export const $reviewCommitDefault = persistentAtom<CommitAction>(COMMIT_DEFAULT_KEY, 'commit', {
  decode: raw => (raw === 'commitPush' ? 'commitPush' : 'commit'),
  encode: value => value
})

// Changed-file layout: a flat path list (VS Code's default) or a folder tree.
export type ReviewTreeMode = 'list' | 'tree'

export const $reviewTreeMode = persistentAtom<ReviewTreeMode>(TREE_MODE_KEY, 'tree', {
  decode: raw => (raw === 'list' ? 'list' : 'tree'),
  encode: value => value
})

export function toggleReviewTreeMode(): void {
  $reviewTreeMode.set($reviewTreeMode.get() === 'tree' ? 'list' : 'tree')
}

export const $reviewFiles = atom<HermesReviewFile[]>([])
export const $reviewLoading = atom(false)
// False when the active session isn't in a local git repo (detached/fresh chat,
// remote backend). Lets the pane say "not a repo" instead of stranding on a
// skeleton or implying a clean repo with "no changes".
export const $reviewIsRepo = atom(true)

// Largest single-file churn (added + removed) in the current diff. Drives the
// per-row data bars: each file's bar is its churn relative to this max, so the
// biggest file fills the row and the rest scale down against it.
export const $reviewMaxChurn = computed($reviewFiles, files =>
  files.reduce((max, file) => Math.max(max, file.added + file.removed), 0)
)
// Persisted so a relaunch restores the file you were diffing (its diff is
// re-fetched in refreshReview once the file is confirmed still changed).
export const $reviewSelectedPath = persistentAtom<null | string>(SELECTED_KEY, null, Codecs.nullableText)
export const $reviewDiff = atom<null | string>(null)
export const $reviewDiffLoading = atom(false)

// Ship state: gh availability + this branch's PR, and a busy flag for the
// commit/push/PR action bar (disables buttons + shows progress).
export const $reviewShipInfo = atom<HermesReviewShipInfo>({ ghReady: false, pr: null })
export const $reviewShipBusy = atom(false)

// True while a commit message is being generated (drives the input's spinner).
export const $reviewCommitMsgBusy = atom(false)

// The pane's repo scope. Null = follow the ACTIVE session's cwd (the classic
// behavior). A tile's rail opens the pane pinned to ITS worktree instead —
// tiles can sit in different worktrees than main, and reviewing "the diff I'm
// looking at" must mean that tile's repo, not whatever main happens to be on.
export const $reviewScopeCwd = atom<null | string>(null)
// The composer target that opened the pane. The review pane is a shared
// surface, but its "let the agent ship it" action must return to the session
// whose worktree the user is reviewing, not broadcast to every mounted tile.
export const $reviewScopeTarget = atom('main')

let reviewScopeSource: string | null = null
let reviewScopeStoredId: string | null = null

export const $reviewRepoCwd = computed(
  [$reviewScopeCwd, $toolWorkspaceCwd],
  (scope, cwd) => scope?.trim() || cwd || null
)

/** The repo the pane is reading right now: its pinned scope, else the active
 *  session's cwd. Exported for pane helpers that join repo-relative paths. */
export const reviewRepoCwd = (): null | string => $reviewRepoCwd.get()

const repoCwd = reviewRepoCwd

type ReviewBridge = NonNullable<NonNullable<NonNullable<Window['hermesDesktop']>['git']>['review']>
let reviewRefreshSeq = 0
let reviewDiffSeq = 0
let reviewRefreshTimer: ReturnType<typeof setTimeout> | null = null
let shipInfoSeq = 0
let shipInfoLastCheckedAt = 0

function reviewSourceIsCurrent(scopeCwd?: null | string): boolean {
  const session = $toolSession.get()

  return (
    Boolean(scopeCwd) ||
    ($reviewScopeCwd.get() ? reviewScopeSource === session.sourceKey : toolSessionHasCurrentSource(session))
  )
}

// The two things every review op needs: the repo cwd + the IPC bridge. Null when
// either is missing (no session, remote backend), so callers bail in one line.
function reviewCtx(scopeCwd?: null | string): { cwd: string; review: ReviewBridge; sourceKey: string } | null {
  const cwd = scopeCwd?.trim() || repoCwd()
  const session = $toolSession.get()

  if (!reviewSourceIsCurrent(scopeCwd)) {
    return null
  }

  const review = desktopGit()?.review

  return cwd && review ? { cwd, review, sourceKey: session.sourceKey } : null
}

const reviewContextIsCurrent = (ctx: { cwd: string; sourceKey: string }) =>
  repoCwd() === ctx.cwd && $toolSession.get().sourceKey === ctx.sourceKey

/** Identity for delayed pane actions such as opening a file preview. */
export function reviewWorkspaceKey(): string | null {
  return reviewSourceIsCurrent() && repoCwd() ? JSON.stringify([repoCwd(), $toolSession.get().sourceKey]) : null
}

/** Read one repo's review list without publishing into ReviewPane's pinned cache. */
export async function reviewFilesForCwd(
  cwd: string,
  review: ReviewBridge | undefined = desktopGit()?.review
): Promise<HermesReviewFile[]> {
  const target = cwd.trim()

  if (!target || !review) {
    throw new Error('Git review is unavailable')
  }

  const result = await review.list(target, 'uncommitted', null)

  return result.files.filter(file => !isExcludedPath(file.path))
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function refreshReview(options: { allowClosed?: boolean } = {}): Promise<void> {
  const ctx = reviewCtx()
  const seq = (reviewRefreshSeq += 1)

  if ((!$reviewOpen.get() && !options.allowClosed) || !ctx) {
    $reviewFiles.set([])
    $reviewIsRepo.set(Boolean(ctx))

    // Critical: clear loading on the no-cwd / not-a-repo path too. It's set
    // true (optimistically) before a refresh is scheduled, so skipping it here
    // strands the pane on a forever-skeleton for a fresh, detached chat.
    if (seq === reviewRefreshSeq) {
      $reviewLoading.set(false)
    }

    return
  }

  const { cwd } = ctx

  $reviewIsRepo.set(true)
  $reviewLoading.set(true)

  try {
    const files = await reviewFilesForCwd(cwd, ctx.review)

    // Ignore a result that resolved after the cwd moved on.
    if (seq !== reviewRefreshSeq || !reviewContextIsCurrent(ctx)) {
      return
    }

    // Hide dep/build/cache dirs and OS noise even when the repo tracks them —
    // .gitignored paths are already dropped upstream by `git status`.
    $reviewFiles.set(files)

    // Drop the selection if the file is gone (staged away, reverted) so the diff
    // pane doesn't strand on a ghost; otherwise lazily fetch its diff so a
    // restored (persisted) selection re-renders on boot.
    const selected = $reviewSelectedPath.get()
    const selectedFile = selected ? files.find(file => file.path === selected) : null

    if (selected && !selectedFile) {
      clearReviewSelection()
    } else if (selectedFile && $reviewDiff.get() === null) {
      void selectReviewFile(selectedFile)
    }
  } catch {
    if (seq === reviewRefreshSeq && reviewContextIsCurrent(ctx)) {
      $reviewFiles.set([])
    }
  } finally {
    if (seq === reviewRefreshSeq) {
      $reviewLoading.set(false)
    }
  }
}

function scheduleReviewRefresh(): void {
  if (!$reviewOpen.get()) {
    return
  }

  if (reviewRefreshTimer) {
    clearTimeout(reviewRefreshTimer)
  }

  reviewRefreshTimer = setTimeout(() => {
    reviewRefreshTimer = null
    void refreshReview()
  }, REVIEW_REFRESH_DEBOUNCE_MS)
}

export async function selectReviewFile(file: HermesReviewFile): Promise<void> {
  const seq = ++reviewDiffSeq
  $reviewSelectedPath.set(file.path)

  const ctx = reviewCtx()

  if (!ctx) {
    $reviewDiff.set(null)
    $reviewDiffLoading.set(false)

    return
  }

  $reviewDiffLoading.set(true)

  try {
    const diff = await ctx.review.diff(ctx.cwd, file.path, 'uncommitted', null, file.staged)

    if (seq === reviewDiffSeq && reviewContextIsCurrent(ctx) && $reviewSelectedPath.get() === file.path) {
      $reviewDiff.set(diff || '')
    }
  } catch {
    if (seq === reviewDiffSeq && reviewContextIsCurrent(ctx) && $reviewSelectedPath.get() === file.path) {
      $reviewDiff.set('')
    }
  } finally {
    if (seq === reviewDiffSeq && reviewContextIsCurrent(ctx) && $reviewSelectedPath.get() === file.path) {
      $reviewDiffLoading.set(false)
    }
  }
}

export function clearReviewSelection(): void {
  reviewDiffSeq += 1
  $reviewSelectedPath.set(null)
  $reviewDiff.set(null)
  $reviewDiffLoading.set(false)
}

// ── View state ───────────────────────────────────────────────────────────────

export async function refreshShipInfo(): Promise<void> {
  const ctx = reviewCtx()
  const seq = (shipInfoSeq += 1)

  if (!ctx) {
    $reviewShipInfo.set({ ghReady: false, pr: null })

    return
  }

  try {
    const info = await ctx.review.shipInfo(ctx.cwd)

    if (seq === shipInfoSeq && reviewContextIsCurrent(ctx)) {
      $reviewShipInfo.set(info)
      shipInfoLastCheckedAt = Date.now()
    }
  } catch {
    if (seq === shipInfoSeq && reviewContextIsCurrent(ctx)) {
      $reviewShipInfo.set({ ghReady: false, pr: null })
      shipInfoLastCheckedAt = Date.now()
    }
  }
}

function refreshShipInfoIfStale(): void {
  if (Date.now() - shipInfoLastCheckedAt > SHIP_INFO_STALE_MS) {
    void refreshShipInfo()
  }
}

function resolveReviewOrigin(scopeCwd: null | string, scopeTarget: string) {
  const session = $toolSession.get()
  const cwd = scopeCwd?.trim() || null
  const target = cwd ? scopeTarget.trim() || 'main' : session.target

  return {
    cwd,
    target,
    sourceKey: cwd && toolSessionHasCurrentSource(session) ? session.sourceKey : null,
    storedId: target.startsWith('tile:') ? target.slice('tile:'.length) : $selectedStoredSessionId.get()
  }
}

function reviewOriginChanged(scopeCwd: null | string, scopeTarget: string): boolean {
  const origin = resolveReviewOrigin(scopeCwd, scopeTarget)

  return (
    $reviewScopeCwd.get() !== origin.cwd ||
    $reviewScopeTarget.get() !== origin.target ||
    reviewScopeSource !== origin.sourceKey ||
    reviewScopeStoredId !== origin.storedId
  )
}

/** Open the pane scoped to `scopeCwd` (a tile's worktree), or to the active
 *  session's cwd when null — see `$reviewScopeCwd`. Keep the originating
 *  composer target alongside it for agent-ship actions. */
export function openReview(scopeCwd: null | string = null, scopeTarget = 'main'): void {
  const origin = resolveReviewOrigin(scopeCwd, scopeTarget)
  reviewScopeSource = origin.sourceKey
  reviewScopeStoredId = origin.storedId
  $reviewScopeCwd.set(origin.cwd)
  $reviewScopeTarget.set(origin.target)
  $reviewOpen.set(true)
  void refreshReview()
  void refreshShipInfo()
}

export function closeReview(): void {
  $reviewOpen.set(false)
  $reviewScopeCwd.set(null)
  $reviewScopeTarget.set('main')
  clearReviewSelection()
}

/** Restoring a minimized/hidden pane is not a new repository selection. */
export function restoreReview(): void {
  $reviewOpen.set(true)
  void refreshReview()
  void refreshShipInfo()
}

export function toggleReview(scopeCwd: null | string = null, scopeTarget = 'main'): void {
  // Narrow width: the pane is a collapsed overlay (like the sidebar under ⌘B).
  // Make sure its data is loaded, then slide it in/out via the forced-reveal pin
  // — never the docked open state, which a 0px track would render invisibly.
  if (matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
    if (!$reviewOpen.get() || reviewOriginChanged(scopeCwd, scopeTarget)) {
      openReview(scopeCwd, scopeTarget)
    }

    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: REVIEW_PANE_ID } }))

    return
  }

  // Ask the TREE, not `$reviewOpen`. The store stays true while the pane sits
  // behind a sibling tab in the right column or inside a minimized zone, so a
  // boolean flip spent the press re-asserting a value it already held and ⌘G
  // read as a dead key. `revealReview` fronts and un-minimizes; only close when
  // the diff is genuinely the thing on screen.
  if (isPaneVisible(REVIEW_PANE_ID)) {
    closeReview()
  } else {
    revealReview(scopeCwd, scopeTarget)
  }
}

/**
 * Open the review pane and bring it into view. Unlike `toggleReview` this never
 * closes an already-open pane — it's the "take me to the diff" entry point used
 * by the transcript's changed-files card.
 */
export function revealReview(scopeCwd: null | string = null, scopeTarget = 'main'): void {
  const wasOpen = $reviewOpen.get()

  if (!wasOpen || reviewOriginChanged(scopeCwd, scopeTarget)) {
    // Explicit selection may come from another conversation or source at the
    // same path. Restoring the existing pane uses restoreReview instead.
    openReview(scopeCwd, scopeTarget)
  }

  if (matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
    // The reveal pin is a toggle, so only fire it when the overlay isn't
    // already slid in — otherwise "show me the diff" would hide the pane.
    if (!wasOpen) {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: REVIEW_PANE_ID } }))
    }

    return
  }

  revealTreePane(REVIEW_PANE_ID)
}

/** The changed file matching a tool-reported path (absolute or repo-relative). */
function matchReviewFile(files: readonly HermesReviewFile[], path: string): HermesReviewFile | undefined {
  const target = path.replace(/\\/g, '/').replace(/\/+$/, '')

  if (!target) {
    return undefined
  }

  return files.find(file => {
    const candidate = file.path.replace(/\\/g, '/')

    return candidate === target || target.endsWith(`/${candidate}`) || candidate.endsWith(`/${target}`)
  })
}

/**
 * Open the review pane on one file's diff. The path comes from a tool call, so
 * it may be absolute while git reports repo-relative — match on the tail.
 */
export async function openReviewForPath(
  path: string,
  scopeCwd: null | string = null,
  scopeTarget = 'main'
): Promise<void> {
  revealReview(scopeCwd, scopeTarget)
  const ctx = reviewCtx()
  await refreshReview()

  if (!ctx || !reviewContextIsCurrent(ctx)) {
    return
  }

  const file = matchReviewFile($reviewFiles.get(), path)

  if (file) {
    await selectReviewFile(file)
  }
}

// ── Mutations ────────────────────────────────────────────────────────────────

// Run a git mutation then re-sync both the review list and the rail's +/- (the
// working tree changed). A failure is swallowed by the caller's notify wrapper.
async function afterMutation(ctx: { cwd: string; sourceKey: string }): Promise<void> {
  if ($toolSession.get().sourceKey !== ctx.sourceKey) {
    return
  }

  if (reviewContextIsCurrent(ctx)) {
    await refreshReview({ allowClosed: true })
  }

  if ($toolSession.get().sourceKey !== ctx.sourceKey) {
    return
  }

  void refreshRepoStatus(ctx.cwd)
  notifyWorkspaceChanged()

  const selected = $reviewSelectedPath.get()
  const file = reviewContextIsCurrent(ctx) && selected ? $reviewFiles.get().find(f => f.path === selected) : null

  // Re-fetch the open diff (staging flips which diff — cached vs worktree).
  if (file) {
    void selectReviewFile(file)
  }
}

export async function stageReviewFile(path: null | string, scopeCwd?: null | string): Promise<void> {
  const ctx = reviewCtx(scopeCwd)

  if (!ctx) {
    throw new Error('Git review is unavailable')
  }

  await ctx.review.stage(ctx.cwd, path)
  await afterMutation(ctx)
}

export async function unstageReviewFile(path: null | string, scopeCwd?: null | string): Promise<void> {
  const ctx = reviewCtx(scopeCwd)

  if (!ctx) {
    throw new Error('Git review is unavailable')
  }

  await ctx.review.unstage(ctx.cwd, path)
  await afterMutation(ctx)
}

export async function revertReviewFile(path: null | string, scopeCwd?: null | string): Promise<void> {
  const ctx = reviewCtx(scopeCwd)

  if (!ctx) {
    throw new Error('Git review is unavailable')
  }

  await ctx.review.revert(ctx.cwd, path)
  await afterMutation(ctx)
}

// Revert is destructive (discards working-tree edits with no undo), so it always
// routes through a confirm dialog. The target is `{ path }` where `path === null`
// means "revert all"; `undefined` means no confirm is open. We wrap the path in
// an object so the `null` ("all") case is distinguishable from "closed".
interface ReviewRevertTarget {
  connectionId: string | null
  cwd: string | null
  path: string | null
  profile: string | null
  sourceKey: string
}

export const $reviewRevertTarget = atom<ReviewRevertTarget | undefined>(undefined)

/** Open the revert confirm for a single file, or `null` for all changes. */
export function requestRevert(path: null | string, cwd?: string): void {
  $reviewRevertTarget.set({
    connectionId: $activeConnectionId.get(),
    cwd: reviewSourceIsCurrent(cwd) ? cwd?.trim() || repoCwd() : null,
    path,
    profile: $activeGatewayProfile.get(),
    sourceKey: $toolSession.get().sourceKey
  })
}

export function cancelRevert(): void {
  $reviewRevertTarget.set(undefined)
}

/** Confirm the pending revert (closes the dialog, then performs it). */
export async function confirmRevert(): Promise<void> {
  const target = $reviewRevertTarget.get()

  $reviewRevertTarget.set(undefined)

  if (!target) {
    return
  }

  // A confirmation belongs to the backend where it was requested. Re-resolving
  // its cwd after a connection/profile switch could discard another repo's edits.
  if (
    !target.cwd ||
    target.sourceKey !== $toolSession.get().sourceKey ||
    target.connectionId !== $activeConnectionId.get() ||
    target.profile !== $activeGatewayProfile.get()
  ) {
    throw new Error(translateNow('summary.state.unavailable'))
  }

  await revertReviewFile(target.path, target.cwd)
}

// ── Ship flow (commit / push / PR) ───────────────────────────────────────────

/** A pinned main repo must not send its ship task to a different conversation
 * that has since reused the main composer. Tile targets have stable ids. */
export function reviewComposerTarget(): string | null {
  const target = $reviewScopeTarget.get()

  if (!reviewSourceIsCurrent()) {
    return null
  }

  if (
    $reviewScopeCwd.get() &&
    target === 'main' &&
    (reviewScopeStoredId !== $selectedStoredSessionId.get() || repoCwd() !== $currentCwd.get().trim())
  ) {
    return null
  }

  return target
}

// Serialize ship actions behind one busy flag so the bar can't double-fire.
async function runShip<T>(action: () => Promise<T>): Promise<T> {
  $reviewShipBusy.set(true)

  try {
    return await action()
  } finally {
    $reviewShipBusy.set(false)
  }
}

export async function commitChanges(message: string, opts: { push?: boolean } = {}): Promise<void> {
  const ctx = reviewCtx()

  if (!ctx || !message.trim()) {
    return
  }

  await runShip(async () => {
    await ctx.review.commit(ctx.cwd, message.trim(), Boolean(opts.push))
    await afterMutation(ctx)

    if (reviewContextIsCurrent(ctx)) {
      void refreshShipInfo()
    }
  })
}

// Monotonic token: each generation captures one; Stop (or a newer press) bumps
// it, so a stale resolve is ignored. The model call can't be aborted
// server-side — we just drop its result and free the UI immediately.
let commitGenSeq = 0

/** Abandon any in-flight commit-message generation and re-enable the input. */
export function cancelCommitMessage(): void {
  commitGenSeq += 1
  $reviewCommitMsgBusy.set(false)
}

// Draft a commit message from the working-tree diff via a one-off LLM request
// (outside the conversation — no history, no cache break). `previous` is the
// current box text: handing it back as "don't repeat this" makes a re-press a
// real regen even on greedy / temperature-pinned models. Throws so the UI toasts.
export async function generateCommitMessage(previous = ''): Promise<string> {
  const ctx = reviewCtx()

  if (!ctx?.review.commitContext) {
    return ''
  }

  const gen = (commitGenSeq += 1)
  const live = () => gen === commitGenSeq

  $reviewCommitMsgBusy.set(true)

  try {
    const { diff, recent } = await ctx.review.commitContext(ctx.cwd)

    if (!live() || !diff.trim()) {
      return ''
    }

    const text = await requestOneShot({
      template: 'commit_message',
      temperature: 0.8,
      variables: { avoid: previous, diff, recent_commits: recent }
    })

    return live() ? text : ''
  } finally {
    if (live()) {
      $reviewCommitMsgBusy.set(false)
    }
  }
}

export async function pushChanges(scopeCwd?: null | string): Promise<void> {
  const ctx = reviewCtx(scopeCwd)

  if (!ctx) {
    return
  }

  await runShip(async () => {
    await ctx.review.push(ctx.cwd)

    if (reviewContextIsCurrent(ctx)) {
      void refreshShipInfo()
    }
  })
}

// PR button: open the existing PR in the browser, or create one (pushing first)
// then open it. Caller gates this on shipInfo.ghReady.
export async function createOrOpenPr(): Promise<void> {
  const ctx = reviewCtx()
  const storedId = $reviewScopeCwd.get() ? reviewScopeStoredId : $toolSession.get().storedId

  if (!ctx) {
    return
  }

  const existing = $reviewShipInfo.get().pr

  if (existing?.url) {
    void window.hermesDesktop?.openExternal?.(existing.url)

    return
  }

  await runShip(async () => {
    const { url } = await ctx.review.createPr(ctx.cwd)

    if (url) {
      void window.hermesDesktop?.openExternal?.(url)
    }

    if (!reviewContextIsCurrent(ctx)) {
      return
    }

    // The session recorded its branch when it started; the checkout may have
    // moved since, so bind the conversation to the branch the PR actually came
    // from — otherwise a session that began on trunk badges whatever else lives
    // on trunk, or nothing.
    const session = $sessions.get().find(s => s.id === storedId)
    const branch = repoStatusForCwd(ctx.cwd).get()?.branch

    if (session?.git_repo_root && branch) {
      stampSessionPrBranch(session.id, session.git_repo_root, branch)
    }

    void refreshShipInfo()
  })
}

// ── Triggers (module-scope, mirror coding-status.ts) ─────────────────────────

// A file-mutating tool finished (event-driven, not polled) → refresh the open
// pane's changed-file list. gh/PR re-check is NOT here (gh is slow); it runs on
// the settle edge below.
$workspaceChangeTick.subscribe(() => {
  if ($reviewOpen.get()) {
    scheduleReviewRefresh()
  }
})

// Turn settled: final list refresh + the slower gh/PR re-check.
let prevBusy = $busy.get()

$busy.subscribe(busy => {
  if (prevBusy && !busy && $reviewOpen.get()) {
    scheduleReviewRefresh()
    refreshShipInfoIfStale()
  }

  prevBusy = busy
})

// The pane's repo moved under it. For the classic (unscoped) pane that's the
// active session's cwd changing; for a scoped pane it's a re-home to another
// tile's worktree — and a main-pane cwd change is deliberately IGNORED while
// scoped, so switching sessions in main can't yank the diff you're reviewing.
// Either way: clear the stale file list + selection up front so the pane drops
// straight to its loading skeleton instead of blipping the previous repo's
// diff into the new one.
function onReviewRepoMoved(): void {
  reviewRefreshSeq += 1
  shipInfoSeq += 1
  shipInfoLastCheckedAt = 0
  cancelCommitMessage()

  if ($reviewOpen.get()) {
    clearReviewSelection()
    $reviewFiles.set([])
    $reviewLoading.set(true)
    scheduleReviewRefresh()
    void refreshShipInfo()
  }
}

$reviewScopeCwd.listen(scope => {
  const session = $toolSession.get()
  reviewScopeSource = scope && toolSessionHasCurrentSource(session) ? session.sourceKey : null
})

computed([$reviewRepoCwd, $toolSession], (cwd, session) => JSON.stringify([cwd, session.sourceKey])).listen(
  onReviewRepoMoved
)

$toolSession.listen(session => {
  if (!$reviewScopeCwd.get()) {
    $reviewScopeTarget.set(session.target)
  }
})

// An outside terminal may have changed the tree while we were away.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if ($reviewOpen.get()) {
      scheduleReviewRefresh()
      refreshShipInfoIfStale()
    }
  })
}
