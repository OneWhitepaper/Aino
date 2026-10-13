import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { type Translations, useI18n } from '@/i18n'
import { AlertCircle, Clock, type IconComponent } from '@/lib/icons'
import { $petActivity, $petState, type PetState } from '@/store/pet'
import { $petPluginMessage, type PetMessageTone } from '@/store/pet-plugin-messages'

/**
 * Speech bubble + status glyph for the pet — the "notification" half of the
 * mascot. It externalizes what the agent is doing (Codex-style) so a glance at
 * the desktop pet replaces switching back to the window. The core status lines
 * show only in the popped-out overlay (`showStatus`); in-window the app itself
 * is the surface, so the in-window pet renders the bubble for plugin lines only.
 *
 * Plugin lines (`ctx.pet.say`, see store/pet-plugin-messages) share the bubble:
 * the newest live line shows with its plugin's name as a small label, unless
 * the agent is in an error or waiting-on-you state — those keep the bubble.
 *
 * Text is derived purely from the same `$petState` / `$petActivity` the sprite
 * already reacts to, so it never drifts from the animation. The bubble is shown
 * only when there's something worth saying (working / reviewing / a transient
 * done/error beat / waiting on the user) and is hidden at plain idle.
 */

type Tone = PetMessageTone

interface SpecMeta {
  copyKey: keyof PetBubbleCopy
  glyph?: IconComponent
  tone?: Tone
}

// Visual metadata per mood. The short phrases themselves live in the locale
// catalog so the pop-out mascot does not leak English into a localized UI.
const SPEC_META: Partial<Record<PetState, SpecMeta>> = {
  run: {
    copyKey: 'run'
  },
  review: {
    copyKey: 'review'
  },
  failed: {
    glyph: AlertCircle,
    copyKey: 'failed',
    tone: 'error'
  },
  waiting: {
    glyph: Clock,
    copyKey: 'waiting',
    tone: 'wait'
  }
}

type PetBubbleCopy = Translations['settings']['appearance']['pet']['bubble']

const EMPTY_LINES: readonly string[] = []

const TONE_COLOR: Record<Tone, string> = {
  error: 'var(--ui-red)',
  info: 'currentColor',
  wait: 'var(--ui-yellow)'
}

const TONE_GLYPH: Partial<Record<Tone, IconComponent>> = { error: AlertCircle, wait: Clock }

// Core states that outrank a plugin line: the pet is flagging trouble or the
// turn is paused on the user, and a plugin must not talk over that.
const PRIORITY_TONES: ReadonlySet<Tone | undefined> = new Set(['error', 'wait'])

const BUBBLE_SURFACE = {
  // Solid, theme-driven surface (the prior --ui-bg-card mixes in
  // `transparent`, so the bubble was see-through).
  background: 'var(--ui-bg-elevated)',
  border: '1px solid var(--ui-stroke-secondary)',
  boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
  color: 'var(--foreground)',
  fontSize: 11,
  fontWeight: 500,
  pointerEvents: 'none'
} as const

// Random pick that avoids repeating the line we're already showing.
function pick(lines: readonly string[], prev: string): string {
  if (lines.length <= 1) {
    return lines[0] ?? ''
  }

  let next = prev

  while (next === prev) {
    next = lines[Math.floor(Math.random() * lines.length)]
  }

  return next
}

export interface PetBubbleProps {
  /** Render the core status lines (working…, your turn). The overlay passes
   *  true; the in-window pet leaves them to the app and shows plugin lines only. */
  showStatus?: boolean
}

export function PetBubble({ showStatus = true }: PetBubbleProps = {}) {
  const { t } = useI18n()
  const state = useStore($petState)
  const activity = useStore($petActivity)
  const pluginLine = useStore($petPluginMessage)
  const [line, setLine] = useState('')
  const bubbleCopy = t.settings.appearance.pet.bubble

  // Finish beats are carried by the sprite/mail icon; idle only speaks up when
  // it's actually the user's turn. Everything else maps to a mood spec.
  const specKey: null | PetState =
    state in SPEC_META ? state : state === 'idle' && activity.awaitingInput ? 'waiting' : null

  const rotating = specKey === 'run' || specKey === 'review'
  const meta = specKey ? SPEC_META[specKey] : null
  const lines = meta ? bubbleCopy[meta.copyKey] : EMPTY_LINES

  // Pick a fresh line on every mood change, then keep rotating (random, no
  // repeat) only while the agent is actively working/thinking.
  useEffect(() => {
    if (!meta) {
      setLine('')

      return
    }

    setLine(prev => pick(lines, prev))

    if (!rotating || lines.length <= 1) {
      return
    }

    const id = window.setInterval(() => setLine(prev => pick(lines, prev)), 2600)

    return () => window.clearInterval(id)
  }, [lines, meta, rotating, specKey])

  const spec = meta

  if (pluginLine && !PRIORITY_TONES.has(spec?.tone)) {
    const Glyph = TONE_GLYPH[pluginLine.tone]

    return (
      <div
        data-pet-plugin={pluginLine.pluginId}
        data-slot="pet-plugin-bubble"
        style={{
          ...BUBBLE_SURFACE,
          borderRadius: 10,
          display: 'inline-flex',
          flexDirection: 'column',
          gap: 3,
          lineHeight: 1.3,
          maxWidth: 220,
          padding: '5px 8px',
          width: 'max-content'
        }}
      >
        <span
          style={{
            color: 'var(--ui-text-secondary, var(--muted-foreground))',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: 0.2,
            lineHeight: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {pluginLine.pluginName}
        </span>
        <span style={{ alignItems: 'flex-start', display: 'inline-flex', gap: 5, overflowWrap: 'anywhere' }}>
          {Glyph && (
            <span style={{ display: 'inline-flex', flex: 'none', paddingTop: 1 }}>
              <Glyph style={{ color: TONE_COLOR[pluginLine.tone], height: 12, width: 12 }} />
            </span>
          )}
          {pluginLine.text}
        </span>
      </div>
    )
  }

  if (!meta || !showStatus) {
    return null
  }

  const Glyph = meta.glyph
  const text = line || lines[0]
  const hasText = Boolean(text)

  return (
    <div
      className="aino-pet-bubble"
      style={{
        gap: hasText ? 5 : 0,
        // Glyph-only bubbles collapse to a tight, symmetric badge.
        padding: hasText ? '5px 8px' : 5,
        whiteSpace: 'nowrap'
      }}
    >
      {Glyph && (
        <span style={{ display: 'inline-flex' }}>
          <Glyph style={{ color: meta.tone ? TONE_COLOR[meta.tone] : 'currentColor', height: 13, width: 13 }} />
        </span>
      )}
      {text}
    </div>
  )
}
