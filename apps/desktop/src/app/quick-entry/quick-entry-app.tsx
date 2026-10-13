import '../auxiliary-surfaces.css'

import { useEffect, useReducer, useRef } from 'react'

import { controlVariants } from '@/components/ui/control'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { CornerDownLeft } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import {
  initialQuickComposerState,
  QUICK_TARGET_CURRENT,
  QUICK_TARGET_NEW,
  type QuickComposerEvent,
  quickComposerReducer,
  type QuickComposerState,
  quickEntryResultEvent
} from '@/store/quick-entry'

// Native select popups do not reliably inherit the closed control's colors.
// Paint both sides of the contrast pair on every option so Chromium cannot
// combine a dark-theme foreground with an OS-provided light popup surface.
const QUICK_TARGET_OPTION_STYLE = {
  backgroundColor: 'var(--ui-bg-elevated, var(--background))',
  color: 'var(--ui-text-primary, var(--foreground))'
}

/**
 * The Quick Entry composer — the whole renderer surface of the global-hotkey
 * mini window. Deliberately one input plus a session-target picker and nothing
 * else: this is a capture surface, not a second chat.
 *
 * All behavior rides `quickComposerReducer` (pure, unit-tested): submit sends
 * the trimmed text + target through the shell and asks to hide; an empty submit
 * does neither so a stray Enter can't make the window vanish; Escape and losing
 * focus dismiss without sending; a dead gateway disables the input entirely
 * (the reducer refuses the send AND the input paints the reconnect hint).
 *
 * The window itself has no gateway connection. Its view of backend truth — is
 * the gateway up, which recent sessions exist — is pushed in by the primary
 * renderer through main (`onState`), and its text goes back the same road to
 * the primary renderer's normal prompt-submit path.
 */
export function QuickEntryApp() {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const submitIdRef = useRef(0)

  // The reducer returns { send, state }; this wrapper performs the side effect
  // (hand the payload to the shell, ask to hide) and stores the next state, so
  // the decision stays pure and testable while the effects stay in one place.
  const [state, dispatch] = useReducer((current: QuickComposerState, event: QuickComposerEvent) => {
    const { send, state: next } = quickComposerReducer(current, event)
    const api = window.hermesDesktop?.quickEntry

    if (send) {
      const submitId = submitIdRef.current
      void api?.submit(send).then(result => {
        dispatch(quickEntryResultEvent(result, submitId))

        if (!result.ok) {
          requestAnimationFrame(() => inputRef.current?.focus())
        }
      })
    } else if (!next.visible && current.visible) {
      api?.dismiss()
    }

    return next
  }, initialQuickComposerState)

  // Re-summoned by the chord: the shell reuses the window, so reset the draft
  // and take the keyboard back for a fresh capture. Also adopt gateway-state
  // pushes (connection + recent sessions) relayed from the primary renderer.
  useEffect(() => {
    const api = window.hermesDesktop?.quickEntry

    const offShown = api?.onShown(() => {
      dispatch({ type: 'shown' })
      requestAnimationFrame(() => inputRef.current?.focus())
    })

    const offState = api?.onState(payload => {
      dispatch({
        connected: payload?.connected === true,
        sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
        type: 'state'
      })
    })

    const offLateResult = api?.onLateResult(payload => {
      dispatch({
        message: payload?.result?.message ?? 'Hermes could not deliver the prompt.',
        ok: payload?.result?.ok === true,
        type: 'late-result'
      })
    })

    inputRef.current?.focus()

    return () => {
      offShown?.()
      offState?.()
      offLateResult?.()
    }
  }, [])

  return (
    <div
      style={{
        alignItems: 'center',
        background: 'transparent',
        display: 'flex',
        height: '100vh',
        justifyContent: 'center',
        padding: 12,
        width: '100vw'
      }}
    >
      <div className="aino-auxiliary-panel aino-quick-entry-panel">
        <div className="aino-quick-entry-field">
          <Input
            aria-label={t.desktop.quickEntry.label}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            disabled={!state.connected}
            onBlur={event => {
              // Moving focus to the target picker is not leaving the window.
              if (!event.relatedTarget) {
                dispatch({ type: 'blur' })
              }
            }}
            onChange={event => dispatch({ draft: event.target.value, type: 'edit' })}
            onKeyDown={event => {
              if (isSubmitEnter(event) && !event.shiftKey) {
                event.preventDefault()
                dispatch({ submitId: ++submitIdRef.current, type: 'submit' })
              } else if (event.key === 'Escape') {
                event.preventDefault()
                dispatch({ type: 'dismiss' })
              }
            }}
            placeholder={
              state.connected ? t.desktop.quickEntry.askPlaceholder : t.desktop.quickEntry.disconnectedPlaceholder
            }
            prefix={<CornerDownLeft aria-hidden className="aino-quick-entry-icon" />}
            ref={inputRef}
            size="lg"
            spellCheck={false}
            value={state.draft}
          />
        </div>
        <div className="aino-quick-entry-target-row">
          <label className="aino-quick-entry-label" htmlFor="quick-entry-target">
            {t.desktop.quickEntry.sendTo}
          </label>
          <select
            aria-label={t.desktop.quickEntry.targetSession}
            className={`${controlVariants({ size: 'xs' })} aino-quick-entry-select`}
            disabled={!state.connected}
            id="quick-entry-target"
            onChange={event => dispatch({ target: event.target.value, type: 'target' })}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                dispatch({ type: 'dismiss' })
              }
            }}
            value={state.target}
          >
            <option style={QUICK_TARGET_OPTION_STYLE} value={QUICK_TARGET_CURRENT}>
              {t.desktop.quickEntry.currentChat}
            </option>
            <option style={QUICK_TARGET_OPTION_STYLE} value={QUICK_TARGET_NEW}>
              {t.desktop.quickEntry.newSession}
            </option>
            {state.sessions.map(session => (
              <option key={session.id} style={QUICK_TARGET_OPTION_STYLE} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
        </div>
        {state.error ? (
          <div role="alert" style={{ color: 'var(--destructive, #ef4444)', fontSize: 11 }}>
            {state.error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
