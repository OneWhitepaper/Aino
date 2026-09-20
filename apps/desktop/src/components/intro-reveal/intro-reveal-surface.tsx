import './intro-reveal.css'

import type { Ref } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { BrandClose } from './scenes/brand'
import { SideAgents } from './scenes/side-agents'
import { BLUE, BLUE_DIM, EASE, NOUS_SHADOW } from './scenes/style'
import { decoded, SPINNER } from './scenes/text'
import { INTRO_BEATS, INTRO_PROMPT, INTRO_REPLY_WORDS, INTRO_TOOL_ROWS } from './timeline'
import { useIntroClock } from './use-intro-clock'
import { viewportSlot } from './viewport-cube'

const INTRO_BEAT_INDEX: Record<string, number> = Object.fromEntries(INTRO_BEATS.map((b, i) => [b.id, i]))
const SKIP = 'Skip'
const SURFACES = 'Desktop · Messages · Phone · Anywhere'

export function IntroRevealSurface() {
  const { frame, leaving, faded, skip, glowRef, stageRef, brandRef, viewportRef } = useIntroClock()
  const everywhere = frame.beat >= INTRO_BEAT_INDEX.everywhere
  const brand = frame.beat >= INTRO_BEAT_INDEX.brand

  return (
    <div
      aria-label={SKIP}
      aria-modal="true"
      className={cn(
        'fixed inset-0 flex items-center justify-center overflow-hidden',
        'transition-opacity ease-out',
        leaving ? 'pointer-events-none opacity-0 duration-[900ms]' : faded ? 'opacity-100 duration-700' : 'opacity-0'
      )}
      onClick={skip}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          skip()
        }
      }}
      role="dialog"
      tabIndex={-1}
    >
      {/* The presentation follows the desktop's remembered appearance. */}
      <div
        className="absolute inset-0 bg-(--ui-bg-chrome)/95"
        style={{ opacity: faded && !leaving ? 1 : 0, transition: `opacity 900ms ${EASE}` }}
      />

      {/* One frame clock keeps the spotlight and brand group together. */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[130vmin] w-[150vmin] opacity-0"
        ref={glowRef}
        style={{
          background:
            'radial-gradient(ellipse 46% 44% at 50% 22%, var(--ui-bg-elevated), transparent 72%)',
          transform: 'translate(-50%, -30%) scale(0.9)'
        }}
      />

      {/* One transform keeps the constellation drifting as a group. */}
      <div
        className="relative flex items-center justify-center gap-[2vw]"
        ref={stageRef}
        style={{ perspective: '1400px', transformStyle: 'preserve-3d', willChange: 'transform, opacity' }}
      >
        <SideAgents active={everywhere && !brand} side="left" tick={frame.tick} />

        <HeroChat frame={frame} viewportRef={viewportRef} />

        <SideAgents active={everywhere && !brand} side="right" tick={frame.tick} />
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-[13vh] text-center text-[length:var(--aino-text-body)] tracking-[0.34em] text-(--ui-text-secondary) uppercase"
        style={{
          fontFamily: 'var(--dt-font-sans)',
          opacity: everywhere && !brand ? 1 : 0,
          transform: everywhere && !brand ? 'translateY(0)' : 'translateY(12px)',
          transition: `opacity 620ms ${EASE} 180ms, transform 620ms ${EASE} 180ms`
        }}
      >
        {SURFACES}
      </div>

      <BrandClose ref={brandRef} />

      <Button
        className="absolute bottom-6 right-7"
        onClick={skip}
        style={{ fontFamily: 'var(--dt-font-sans)' }}
        type="button"
        variant="ghost"
      >
        {SKIP}
      </Button>
    </div>
  )
}

interface HeroChatProps {
  frame: ReturnType<typeof useIntroClock>['frame']
  viewportRef: Ref<HTMLCanvasElement>
}

function HeroChat({ frame, viewportRef }: HeroChatProps) {
  const beat = frame.beat
  const sent = beat >= INTRO_BEAT_INDEX.send
  const replying = beat >= INTRO_BEAT_INDEX.reply
  const everywhere = beat >= INTRO_BEAT_INDEX.everywhere
  const typedText = INTRO_PROMPT.slice(0, frame.typed)
  const replyText = INTRO_REPLY_WORDS.slice(0, frame.replyWords).join(' ')

  return (
    <div
      className="relative w-[46vw] min-w-[560px] max-w-[1350px] rounded-(--aino-radius-panel) p-7"
      style={{
        background: 'var(--ui-bg-elevated)',
        border: '1px solid var(--stroke-nous)',
        boxShadow: NOUS_SHADOW,
        animation: 'intro-hover-a 8.4s ease-in-out infinite alternate',
        transform: everywhere ? 'rotateX(4deg) translateZ(-60px) scale(0.86)' : 'rotateX(1.6deg) scale(1)',
        transition: `transform 1100ms ${EASE}`,
        transformOrigin: 'center 60%',
        willChange: 'transform'
      }}
    >
      <ViewportNode frame={frame} viewportRef={viewportRef} />

      <div className="flex min-h-[3.9rem] justify-end">
        <div
          className="max-w-[80%] px-1 py-3.5 text-right text-[length:var(--aino-text-body)] leading-7 text-(--ui-text-primary)"
          style={{
            opacity: sent ? 1 : 0,
            transform: sent ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: `opacity 480ms ${EASE}, transform 480ms ${EASE}`,
            willChange: 'transform, opacity'
          }}
        >
          {INTRO_PROMPT}
        </div>
      </div>

      <div className="mt-5 grid min-h-[10.5rem] content-start gap-2.5">
        {INTRO_TOOL_ROWS.map((row, i) => {
          const shown = Boolean(frame.toolShown & (1 << i)) && sent
          const done = Boolean(frame.toolDone & (1 << i))

          return (
            <div
              className="flex items-center gap-3 rounded-(--aino-radius-control) px-4 py-3"
              key={row.label}
              style={{
                background: 'var(--ui-bg-quaternary)',
                border: '1px solid var(--stroke-nous)',
                opacity: shown ? 1 : 0,
                transform: shown ? 'translateY(0)' : 'translateY(6px)',
                transition: `opacity 520ms ${EASE}, transform 520ms ${EASE}`,
                willChange: 'transform, opacity'
              }}
            >
              <span
                className={cn('w-4 text-center font-mono text-[length:var(--aino-text-title)]', !done && 'text-(--ui-text-secondary)')}
                style={{ color: done ? BLUE : undefined, fontFamily: 'var(--dt-font-mono)' }}
              >
                {done ? '✓' : SPINNER[frame.tick % SPINNER.length]}
              </span>
              <span
                className="text-[length:var(--aino-text-caption)] font-bold uppercase tracking-[0.18em] text-(--ui-text-secondary)"
                style={{ fontFamily: 'var(--dt-font-sans)' }}
              >
                {row.label}
              </span>
              <span
                className="ml-auto grid text-[length:var(--aino-text-ui)] text-(--ui-text-secondary)"
                style={{ fontFamily: 'var(--dt-font-mono)' }}
              >
                {/* Stacking keeps the running/done crossfade in place. */}
                <span
                  className="col-start-1 row-start-1 text-right"
                  style={{ opacity: done ? 0 : 1, transition: `opacity 400ms ${EASE}` }}
                >
                  {shown && !done ? decoded(row.runningText, row.at, frame.tick) : row.runningText}
                </span>
                <span
                  className="col-start-1 row-start-1 text-right"
                  style={{ color: BLUE_DIM, opacity: done ? 1 : 0, transition: `opacity 400ms ${EASE}` }}
                >
                  {done ? decoded(row.doneText, row.doneAt, frame.tick, 380) : row.doneText}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-5 min-h-[6.5rem]">
        <div
          className="max-w-[88%] rounded-(--aino-radius-control) px-5 py-3.5 text-[length:var(--aino-text-body)] leading-7 text-(--ui-text-primary)"
          style={{
            background: 'var(--ui-bg-quaternary)',
            border: '1px solid var(--stroke-nous)',
            opacity: replying ? 1 : 0,
            transform: replying ? 'translateY(0)' : 'translateY(6px)',
            transition: `opacity 500ms ${EASE}, transform 500ms ${EASE}`,
            willChange: 'transform, opacity'
          }}
        >
          {replyText || '\u00a0'}
          {replying && frame.replyWords < INTRO_REPLY_WORDS.length ? (
            <span
              className="dither ml-1 inline-block h-[1.05em] w-[0.5em] translate-y-[3px]"
              style={{ animation: 'intro-caret 0.9s step-end infinite', color: BLUE }}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <div
          className="rounded-(--aino-radius-panel) px-3 py-2.5"
          style={{
            background: 'var(--ui-bg-quaternary)',
            backdropFilter: 'blur(12px) saturate(1.12)',
            border: '1px solid var(--stroke-nous)'
          }}
        >
          <div className="min-h-[2rem] px-1.5 pt-0.5 text-[length:var(--aino-text-body)] leading-7 text-(--ui-text-primary)">
            {sent || typedText.length === 0 ? (
              <span className="text-(--ui-text-tertiary)">Ask anything. Build anything.</span>
            ) : (
              typedText
            )}
            {!sent ? (
              <span
                className="dither ml-0.5 inline-block h-[1.1em] w-[0.52em] translate-y-[3px]"
                style={{ animation: 'intro-caret 1.05s step-end infinite', color: BLUE }}
              />
            ) : null}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="grid size-6 place-items-center rounded-full text-(--ui-text-tertiary)">
              <svg
                fill="none"
                height="13"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.6"
                viewBox="0 0 16 16"
                width="13"
              >
                <path d="M8 3.5v9M3.5 8h9" />
              </svg>
            </span>
            <span className="ml-auto grid size-6 place-items-center rounded-full text-(--ui-text-tertiary)">
              <svg
                fill="none"
                height="13"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
                width="13"
              >
                <rect height="12" rx="3" width="6" x="9" y="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </span>
            <span
              className="grid size-[1.65rem] shrink-0 place-items-center rounded-full"
              style={{
                background: 'var(--aino-action-bg)',
                opacity: sent ? 0.5 : 1,
                color: 'var(--aino-action-fg)',
                transform: !sent && frame.typed >= INTRO_PROMPT.length ? 'scale(1.08)' : 'scale(1)',
                transition: `transform 300ms ${EASE}, background 400ms ${EASE}`
              }}
            >
              <svg
                fill="none"
                height="13"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.4"
                viewBox="0 0 24 24"
                width="13"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ViewportNode({ frame, viewportRef }: HeroChatProps) {
  const viewport = viewportSlot(frame.tick * 45)
  const sent = frame.beat >= INTRO_BEAT_INDEX.send
  const everywhere = frame.beat >= INTRO_BEAT_INDEX.everywhere

  return (
    <>
      <div
        className="absolute -left-64 -top-20 w-52 rounded-(--aino-radius-panel)"
        style={{
          background: 'var(--ui-bg-elevated)',
          border: '1px solid var(--stroke-nous)',
          boxShadow: NOUS_SHADOW,
          animation: 'intro-hover-b 6.8s ease-in-out infinite alternate',
          opacity: sent && !everywhere ? 1 : 0,
          transform:
            sent && !everywhere
              ? 'translateZ(70px) rotateX(-2deg) rotateY(2.5deg) translateY(0) scale(1)'
              : everywhere
                ? 'translateZ(70px) rotateX(-2deg) rotateY(2.5deg) translateY(26px) scale(0.97)'
                : 'translateZ(70px) rotateX(-2deg) rotateY(2.5deg) translateY(12px) scale(0.95)',
          transition: `opacity 480ms ${EASE}, transform 560ms ${EASE}`,
          willChange: 'transform, opacity'
        }}
      >
        <div
          className="flex items-center justify-between px-3 pt-2.5 text-[length:var(--aino-text-caption)] uppercase tracking-[0.2em] text-(--ui-text-tertiary)"
          style={{ fontFamily: 'var(--dt-font-sans)' }}
        >
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-1 rounded-full"
              style={{ animation: 'intro-dot 1.6s ease-in-out infinite', background: BLUE }}
            />
            viewport
          </span>
          <span
            className="text-[length:var(--aino-text-caption)] normal-case tracking-normal"
            style={{ color: BLUE_DIM, fontFamily: 'var(--dt-font-mono)' }}
          >
            {decoded(viewport.mode, viewport.at, frame.tick, 300)}
          </span>
        </div>
        <canvas className="block h-40 w-full rounded-b-(--aino-radius-panel) bg-[#0a0b0e]" ref={viewportRef} />

        <span className="absolute -right-[5px] top-1/2 size-2.5 -translate-y-1/2 rounded-full border border-(--ui-stroke-primary) bg-(--ui-bg-elevated)" />
      </div>

      <svg
        aria-hidden
        className="pointer-events-none absolute -left-12 top-0 h-16 w-12 overflow-visible"
        style={{ opacity: everywhere ? 0 : sent ? 1 : 0, transition: `opacity 300ms ${EASE}` }}
        viewBox="0 0 48 64"
      >
        <path
          d="M 0 15 C 21 15, 27 44, 48 44"
          fill="none"
          pathLength={1}
          stroke="var(--ui-stroke-primary)"
          strokeDasharray="1"
          strokeDashoffset={sent ? 0 : 1}
          strokeWidth="1.5"
          style={{ transition: `stroke-dashoffset 440ms ${EASE}` }}
        />
      </svg>

      <span
        className="absolute -left-[5px] top-[40px] size-2.5 rounded-full border bg-(--ui-bg-elevated)"
        style={{
          borderColor: 'var(--ui-stroke-primary)',
          opacity: everywhere ? 0 : sent ? 1 : 0,
          transition: `opacity 380ms ${EASE}, border-color 380ms ${EASE}`
        }}
      />
    </>
  )
}
