import { atom } from 'nanostores'

import { translateNow } from '@/i18n'
import { localizedWakeCaptureErrorNow } from '@/i18n/wake-errors'
import { type ClientWakeCaptureHandle, startClientWakeCapture } from '@/lib/wake-client-capture'
import { $gateway } from '@/store/gateway'

// "Hey Hermes" wake-word listener state for the composer toggle. The gateway is
// the single source of truth (the listener lives in the backend and is shared
// with the TUI under a single-owner mic lease); this atom is the renderer's
// cache of that truth, refreshed from every wake.* RPC response we see.

export interface WakeWordState {
  /** Wake word can run at all (deps + mic + key). With `enabled` false too, hides the toggle. */
  available: boolean
  /** Config truth (wake_word.enabled) — keeps the ear mounted through transient refusals. */
  enabled: boolean
  /** The listener is armed and owned by this surface. */
  listening: boolean
  /** Last failure reason/hint (start refused, unavailable, …) for the tooltip. */
  notice: string
  /** A toggle RPC is in flight — guards double-clicks. */
  pending: boolean
  /** Human-facing wake phrase, e.g. "hey hermes". */
  phrase: string
}

const INITIAL_WAKE_WORD_STATE: WakeWordState = {
  available: false,
  enabled: false,
  listening: false,
  notice: '',
  pending: false,
  phrase: ''
}

export const $wakeWord = atom<WakeWordState>(INITIAL_WAKE_WORD_STATE)

/** Active client mic stream for remote wake (capture: client). */
interface WakeControllerState {
  state: ReturnType<typeof atom<WakeWordState>>
  capture: ClientWakeCaptureHandle | null
  captureEpoch: number
  disposed: boolean
}

const defaultController: WakeControllerState = {
  state: $wakeWord,
  capture: null,
  captureEpoch: 0,
  disposed: false
}

/** Stop client-side PCM capture (also called on wake.detected before voice). */
export function stopClientCapture(controller = defaultController): void {
  controller.captureEpoch++
  controller.capture?.stop()
  controller.capture = null
}

async function maybeStartClientCapture(
  result: WakeStartResponse | null | undefined,
  request: WakeRequester,
  controller: WakeControllerState
): Promise<void> {
  stopClientCapture(controller)
  const epoch = controller.captureEpoch

  if (!result?.started) {
    return
  }

  const mode = (result.capture || '').toLowerCase()

  if (mode !== 'client' && mode !== 'remote' && mode !== 'external') {
    return
  }

  try {
    const capture = await startClientWakeCapture({
      frameLength: result.frame_length,
      request: async <T>(method: string, params?: Record<string, unknown>) => {
        if (controller.disposed || controller.captureEpoch !== epoch) {
          throw new WakeOperationCancelled()
        }

        return request<T>(method, params)
      }
    })

    if (controller.disposed || controller.captureEpoch !== epoch) {
      capture.stop()

      return
    }

    controller.capture = capture
  } catch (error) {
    if (controller.disposed || error instanceof WakeOperationCancelled) {
      return
    }
    const current = controller.state.get()
    controller.state.set({
      ...current,
      listening: false,
      notice: localizedWakeCaptureErrorNow(error),
      pending: false
    })

    // Best-effort: release server lease if client mic failed.
    try {
      await request('wake.stop', {})
    } catch {
      // ignore
    }
  }
}

export interface WakeStatusResponse {
  /** Armed but the selected backend input delivers only silence. */
  audio_silent?: boolean
  available?: boolean
  /** local | client | auto — where PCM is captured. */
  capture?: string
  configured_surface?: string
  /** Config truth (wake_word.enabled) — drives post-voice re-arm. */
  enabled?: boolean
  frame_length?: number
  hint?: string
  input_device?: WakeInputDeviceStatus
  listening?: boolean
  local_input_available?: boolean
  owned_by_caller?: boolean
  owner_surface?: string | null
  phrase?: string
  provider?: string
  sample_rate?: number
}

export interface WakeStartResponse {
  capture?: string
  enabled_persisted?: boolean
  frame_length?: number
  hint?: string
  owner_surface?: string | null
  phrase?: string
  provider?: string
  reason?: string
  sample_rate?: number
  started?: boolean
}

export interface WakeStopResponse {
  disabled_persisted?: boolean
  reason?: string | null
  stopped?: boolean
}

export interface WakeInputDeviceStatus {
  default_samplerate?: number
  error?: string
  hostapi?: string
  hostapi_index?: number
  max_input_channels?: number
  name?: string
  selector?: number | string | null
}

/** Minimal requester shape — satisfied by both `useGatewayRequest`'s
 *  `requestGateway` and the `$gateway` instance wrapper below. */
export type WakeRequester = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

// First-use wake.start lazy-installs the detection engine (onnxruntime is a
// large wheel) — that legitimately takes minutes. The default 30s WS timeout
// fired mid-install, leaving a dead button that went blue on its own later.
const WAKE_START_TIMEOUT_MS = 180_000

const gatewayRequester: WakeRequester = async <T>(method: string, params: Record<string, unknown> = {}) => {
  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error(translateNow('composer.wakeWordGatewayUnavailable'))
  }

  return method === 'wake.start'
    ? gateway.request<T>(method, params, WAKE_START_TIMEOUT_MS)
    : gateway.request<T>(method, params)
}

// Friendly text for the gateway's wake refusal codes (mirrors the TUI's
// START_REASON_TEXT). Unknown codes fall through raw so new server-side
// codes stay visible instead of silently disappearing.
const REASON_TEXT: Record<string, () => string> = {
  disabled: () => translateNow('composer.wakeWordDisabled'),
  disabled_for_surface: () => translateNow('composer.wakeWordDisabledForSurface'),
  not_owner: () => translateNow('composer.wakeWordOwnedByOtherSurface'),
  owned: () => translateNow('composer.wakeWordOwnedByOtherSurface'),
  unavailable: () => translateNow('composer.wakeWordUnavailable')
}

const noticeFrom = (result: { hint?: string; reason?: string | null } | null | undefined): string => {
  const hint = result?.hint?.trim()

  if (hint) {
    return hint
  }

  const reason = result?.reason?.trim()

  return reason ? (REASON_TEXT[reason]?.() ?? reason) : ''
}

/** Sync the atom from a `wake.status` payload (mount / gateway-ready). */
export function applyWakeStatus(status: WakeStatusResponse | null | undefined, controller = defaultController): void {
  if (controller.disposed) {
    return
  }
  const current = controller.state.get()
  const listening = Boolean(status?.listening)
  // "Armed but deaf" keeps its input-device hint visible in the tooltip even
  // though the toggle shows listening.
  const silent = Boolean(status?.audio_silent)

  controller.state.set({
    ...current,
    available: Boolean(status?.available),
    enabled: Boolean(status?.enabled),
    listening,
    notice: listening && !silent ? '' : noticeFrom(status),
    phrase: status?.phrase?.trim() || current.phrase
  })
}

/** Sync the atom from a `wake.start` response. A `{started:false, reason}`
 *  refusal keeps the toggle off and surfaces the reason as the tooltip. */
export function applyWakeStartResult(
  result: WakeStartResponse | null | undefined,
  request: WakeRequester = gatewayRequester,
  controller = defaultController
): void {
  if (controller.disposed) {
    return
  }
  const current = controller.state.get()

  if (result?.started) {
    controller.state.set({
      ...current,
      available: true,
      enabled: true,
      listening: true,
      notice: '',
      pending: false,
      phrase: result.phrase?.trim() || current.phrase
    })
    void maybeStartClientCapture(result, request, controller)

    return
  }

  stopClientCapture(controller)

  controller.state.set({
    ...current,
    // The backend probes requirements on start; an explicit "unavailable"
    // refusal means the feature can't run here right now. Keep `enabled`
    // (config truth) as-is so the button stays mounted through transient
    // refusals instead of vanishing mid-session.
    available: result?.reason === 'unavailable' ? false : current.available,
    listening: false,
    notice: noticeFrom(result),
    pending: false
  })
}

/** Sync the atom from a `wake.stop` response. `{stopped:false, reason:'not_owner'}`
 *  still means WE are not listening, so the toggle lands on off either way. */
export function applyWakeStopResult(result: WakeStopResponse | null | undefined, controller = defaultController): void {
  if (controller.disposed) {
    return
  }
  const current = controller.state.get()

  stopClientCapture(controller)
  controller.state.set({
    ...current,
    enabled: result?.disabled_persisted ? false : current.enabled,
    listening: false,
    notice: result?.stopped ? '' : noticeFrom(result),
    pending: false
  })
}

/**
 * Gateway-ready sync + auto-arm (wiring.tsx). Queries `wake.status` first so
 * the button knows availability/phrase even when arming is refused, then arms
 * the listener for this surface exactly like the historical auto-arm did.
 * Best-effort: a gateway without the wake.* methods leaves the atom at its
 * hidden default.
 */
export async function armWakeWord(
  request: WakeRequester = gatewayRequester,
  controller = defaultController
): Promise<void> {
  if (controller.disposed) {
    return
  }

  try {
    const status = await request<WakeStatusResponse>('wake.status', {
      client_capture: true,
      surface: 'gui'
    })

    applyWakeStatus(status, controller)

    if (!status?.available || status.listening) {
      // Armed already (e.g. another surface/restart) — reattach feeder if client.
      if (status?.listening) {
        const mode = (status.capture || '').toLowerCase()

        if (mode === 'client' || mode === 'remote' || mode === 'external') {
          void maybeStartClientCapture(
            {
              started: true,
              capture: 'client',
              frame_length: status.frame_length ?? 1280
            },
            request,
            controller
          )
        }
      }

      return
    }

    const result = await request<WakeStartResponse>('wake.start', {
      surface: 'gui',
      client_capture: true
    })

    applyWakeStartResult(result, request, controller)
  } catch {
    // Older backends / transient failures — keep whatever we last knew.
  }
}

/** The composer button's click handler: stop when listening, start otherwise. */
export async function toggleWakeWord(
  request: WakeRequester = gatewayRequester,
  controller = defaultController
): Promise<void> {
  if (controller.disposed) {
    return
  }
  const state = controller.state.get()

  if (state.pending) {
    return
  }

  controller.state.set({
    ...state,
    // First arm may lazy-install the detection engine — say so instead of
    // freezing a silent disabled button for the duration.
    notice: state.listening ? '' : translateNow('composer.wakeWordArming'),
    pending: true
  })

  try {
    if (state.listening) {
      applyWakeStopResult(await request<WakeStopResponse>('wake.stop', { persist: true }), controller)
    } else {
      // persist: true — a deliberate click is consent, so the backend flips
      // wake_word.enabled in config.yaml (on/off) and the choice sticks for
      // future sessions. Auto-arm (armWakeWord) never passes it.
      applyWakeStartResult(
        await request<WakeStartResponse>('wake.start', {
          persist: true,
          surface: 'gui',
          client_capture: true
        }),
        request,
        controller
      )
    }
  } catch (error) {
    if (controller.disposed || error instanceof WakeOperationCancelled) {
      return
    }
    const current = controller.state.get()

    controller.state.set({
      ...current,
      notice: error instanceof Error ? error.message : String(error),
      pending: false
    })
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Post-voice-turn reconcile: the wake word is a persistent setting, so ending a
 * voice conversation must land the listener back where config says it belongs.
 * `wake.resume` alone isn't enough — the mic can still be held by the just-torn
 * -down WebRTC capture, and a fire-and-forget resume that loses that race left
 * the ear silently off until the user re-toggled. Resume, then verify against
 * `wake.status` (config `enabled` is the authority) and re-arm, with a couple
 * of spaced retries to ride out mic-release latency. Never passes `persist` —
 * this is a passive path and must not flip config.
 */
export async function resumeWakeAfterVoice(
  request: WakeRequester = gatewayRequester,
  controller = defaultController
): Promise<void> {
  if (controller.disposed) {
    return
  }

  try {
    await request('wake.resume', {})
  } catch {
    // Older backend without wake.* — nothing to reconcile.
    return
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const status = await request<WakeStatusResponse>('wake.status', {
        client_capture: true,
        surface: 'gui'
      })

      applyWakeStatus(status, controller)

      // Config says off (or the feature can't run) — off is the correct rest
      // state. A user /wake off during the voice turn stays respected.
      if (!status?.enabled || !status.available) {
        return
      }

      if (status.listening) {
        // Server lease is still armed (e.g. wake.resume after voice).
        // Client PCM was stopped on wake.detected — reattach if needed.
        const mode = (status.capture || '').toLowerCase()

        if (mode === 'client' || mode === 'remote' || mode === 'external') {
          void maybeStartClientCapture(
            {
              started: true,
              capture: 'client',
              frame_length: status.frame_length ?? 1280
            },
            request,
            controller
          )
        }

        return
      }

      const started = await request<WakeStartResponse>('wake.start', {
        surface: 'gui',
        client_capture: true
      })

      applyWakeStartResult(started, request, controller)

      if (started?.started) {
        return
      }

      // Another surface holds the mic lease — theirs to keep.
      if (started?.reason === 'owned') {
        return
      }
    } catch (error) {
      if (controller.disposed || error instanceof WakeOperationCancelled) {
        return
      }
      // Transient (mic still releasing) — fall through to the next attempt.
    }

    await sleep(1500)
  }
}

/** Test-only reset. */
export function resetWakeWordState(): void {
  const controller = defaultController
  stopClientCapture(controller)
  controller.state.set(INITIAL_WAKE_WORD_STATE)
}

class WakeOperationCancelled extends Error {}

// A new foreground owner must wait until the old owner's last start and stop
// settle; both can name the same backend microphone lease after a Profile swap.
let wakeHandoff: Promise<void> = Promise.resolve()

export function createWakeWordController(request: WakeRequester) {
  const controller: WakeControllerState = {
    state: atom<WakeWordState>({ ...INITIAL_WAKE_WORD_STATE }),
    capture: null,
    captureEpoch: 0,
    disposed: false
  }

  const operations = new Set<Promise<void>>()
  let operationEpoch = 0
  let disposal: Promise<void> | undefined

  const run = (action: (owned: WakeRequester) => Promise<void>): Promise<void> => {
    if (controller.disposed) {
      return Promise.resolve()
    }
    const epoch = ++operationEpoch

    const owned: WakeRequester = async <T>(method: string, params?: Record<string, unknown>) => {
      if (controller.disposed || epoch !== operationEpoch) {
        throw new WakeOperationCancelled()
      }
      const result = await request<T>(method, params)

      if (controller.disposed || epoch !== operationEpoch) {
        throw new WakeOperationCancelled()
      }

      return result
    }

    const barrier = Promise.allSettled([wakeHandoff, ...operations])

    const operation = barrier
      .then(() => action(owned))
      .catch(error => {
        if (!(error instanceof WakeOperationCancelled)) {
          throw error
        }
      })

    operations.add(operation)
    void operation.then(
      () => operations.delete(operation),
      () => operations.delete(operation)
    )

    return operation
  }

  return {
    state: controller.state,
    $wakeWord: controller.state,
    arm: () => run(owned => armWakeWord(owned, controller)),
    toggle: () =>
      controller.state.get().pending ? Promise.resolve() : run(owned => toggleWakeWord(owned, controller)),
    resume: () => run(owned => resumeWakeAfterVoice(owned, controller)),
    pause: () => {
      stopClientCapture(controller)

      return run(async owned => {
        await owned('wake.pause', {})
        controller.state.set({ ...controller.state.get(), listening: false, pending: false })
      })
    },
    stopCapture: () => stopClientCapture(controller),
    dispose: (): Promise<void> => {
      if (disposal) {
        return disposal
      }
      controller.disposed = true
      operationEpoch++
      stopClientCapture(controller)
      controller.state.set({ ...controller.state.get(), listening: false, pending: false })
      disposal = Promise.allSettled([wakeHandoff, ...operations]).then(async () => {
        try {
          await request('wake.stop', {})
        } catch {
          /* Disconnected owner cannot retain a live client feeder. */
        }
      })
      wakeHandoff = disposal

      return disposal
    }
  }
}
