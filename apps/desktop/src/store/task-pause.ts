import { atom } from 'nanostores'

export interface TaskContinuation {
  admission_id: string
  execution_generation: number
  revision: number
}

interface TaskPause {
  generation: number
  phase: 'stopping' | 'paused' | 'continuing'
  acknowledged: boolean
  stoppedRevision?: number
  admissionId?: string
  idleRevision?: number
}

export const $taskPauses = atom<Record<string, TaskPause>>({})
const owners = new WeakMap<object, number>()
let nextOwner = 0

/** Protocol instance + profile + runtime: imported IDs on another socket are unrelated. */
export function taskPauseKey(owner: object, sessionId: string, profile = 'default'): string {
  if (!owners.has(owner)) {
    owners.set(owner, ++nextOwner)
  }

  return JSON.stringify([owners.get(owner), profile || 'default', sessionId])
}

function matchesContinuation(pause: TaskPause | undefined, continuation: TaskContinuation): boolean {
  return (
    pause?.generation === continuation.execution_generation &&
    pause.admissionId === continuation.admission_id &&
    pause.idleRevision === continuation.revision
  )
}

export function clearTaskPause(key: string, expected?: TaskContinuation | number): void {
  const pause = $taskPauses.get()[key]

  if (
    !pause ||
    (typeof expected === 'number' ? pause.generation !== expected : expected && !matchesContinuation(pause, expected))
  ) {
    return
  }

  const next = { ...$taskPauses.get() }
  delete next[key]
  $taskPauses.set(next)
}

export function clearOwnerTaskPauses(owner: object): void {
  const id = owners.get(owner)

  if (id === undefined) {
    return
  }

  for (const key of Object.keys($taskPauses.get())) {
    if (JSON.parse(key)[0] === id) {
      clearTaskPause(key)
    }
  }
}

function save(key: string, pause: TaskPause): void {
  const phase =
    pause.phase === 'stopping' && pause.acknowledged && pause.admissionId && pause.idleRevision !== undefined
      ? 'paused'
      : pause.phase

  $taskPauses.set({ ...$taskPauses.get(), [key]: { ...pause, phase } })
}

export function beginTaskPause(key: string, generation: number, stoppedRevision?: number): void {
  if ($taskPauses.get()[key]?.generation === generation) {
    return
  }

  save(key, { generation, stoppedRevision, phase: 'stopping', acknowledged: false })
}

export function acknowledgeTaskPause(key: string, generation: unknown): void {
  const pause = $taskPauses.get()[key]

  if (pause && pause.generation === generation) {
    save(key, { ...pause, acknowledged: true })
  }
}

/** Only canonical frames past the adapter's generation fence reach this projection. */
export function observeTaskPause(
  key: string,
  type: string,
  generation: unknown,
  payload: Record<string, unknown>
): void {
  const pause = $taskPauses.get()[key]

  if (!pause) {
    return
  }

  // A resume response can arrive after the turn's settlement events. Its old
  // running/pending snapshot cannot revoke a pause proved by a newer revision.
  if (
    type === 'session.info' &&
    typeof payload.revision === 'number' &&
    payload.revision < Math.max(pause.idleRevision ?? -1, pause.stoppedRevision ?? -1)
  ) {
    return
  }

  if ((typeof generation === 'number' && generation !== pause.generation) || type === 'session.updated') {
    clearTaskPause(key)

    return
  }

  if (type === 'message.start') {
    if (pause.phase !== 'stopping') {
      clearTaskPause(key)
    }

    return
  }

  if (type === 'message.complete') {
    observePauseCompletion(key, pause, generation, payload)
  }

  if (type === 'session.info' && generation === pause.generation) {
    observePauseInfo(key, pause, payload)
  }
}

function observePauseCompletion(key: string, pause: TaskPause, generation: unknown, payload: Record<string, unknown>) {
  if (generation !== pause.generation || payload.status !== 'interrupted' || typeof payload.admission_id !== 'string') {
    clearTaskPause(key)
  } else {
    save(key, { ...pause, admissionId: payload.admission_id })
  }
}

function observePauseInfo(key: string, pause: TaskPause, payload: Record<string, unknown>) {
  const hasOtherInput =
    Array.isArray(payload.pending) &&
    payload.pending.some(
      row => pause.phase !== 'stopping' || row?.status !== 'started' || row?.execution_generation !== pause.generation
    )

  if (
    hasOtherInput ||
    (pause.phase !== 'stopping' &&
      (payload.running === true || (typeof payload.revision === 'number' && payload.revision !== pause.idleRevision)))
  ) {
    clearTaskPause(key)
  } else if (
    payload.running === false &&
    Array.isArray(payload.pending) &&
    payload.pending.length === 0 &&
    typeof payload.revision === 'number' &&
    (pause.stoppedRevision === undefined || payload.revision > pause.stoppedRevision)
  ) {
    save(key, { ...pause, idleRevision: payload.revision })
  }
}

/** Claim synchronously before any asynchronous submit work, so double clicks admit once. */
export function claimTaskContinuation(key: string): TaskContinuation | null {
  const pause = $taskPauses.get()[key]

  if (pause?.phase !== 'paused' || !pause.admissionId || pause.idleRevision === undefined) {
    return null
  }

  save(key, { ...pause, phase: 'continuing' })

  return { admission_id: pause.admissionId, execution_generation: pause.generation, revision: pause.idleRevision }
}

export function releaseTaskContinuation(key: string, continuation: TaskContinuation): void {
  const pause = $taskPauses.get()[key]

  if (pause?.phase === 'continuing' && matchesContinuation(pause, continuation)) {
    save(key, { ...pause, phase: 'paused' })
  }
}
