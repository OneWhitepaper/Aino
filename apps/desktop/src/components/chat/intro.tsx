import { useLayoutEffect, useRef, useState } from 'react'

import actionAnalyzeIcon from '@/assets/aino-home/action-analyze.svg'
import actionCodeReviewIcon from '@/assets/aino-home/action-code-review.svg'
import actionReportIcon from '@/assets/aino-home/action-report.svg'
import actionResearchIcon from '@/assets/aino-home/action-research.svg'
import { AinoDesignIcon } from '@/components/aino-design-icon'
import { Button } from '@/components/ui/button'
import { type Locale, useI18n } from '@/i18n'
import { AGENT_NAME, PRODUCT_NAME } from '@/lib/brand'
import { capitalize, normalize } from '@/lib/text'
import { cn } from '@/lib/utils'

import introCopyJsonl from './intro-copy.jsonl?raw'
import introCopyZhJsonl from './intro-copy.zh.jsonl?raw'
import { Wordmark } from './wordmark'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  /** Render the Figma-aligned landing surface (the default for new chats). */
  home?: boolean
  onInsertPrompt?: (text: string) => void
  onPickFiles?: () => void
  personality?: string
  seed?: number
}

type HomeActionKey = 'analyze' | 'review' | 'research' | 'report'

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'What are we moving today?',
    body: "Send a bug, branch, plan, or rough idea. I'll inspect the repo and turn it into the next concrete step."
  },
  {
    headline: "What's on your mind?",
    body: "Bring the code, question, or stuck part. I'll read the room before making changes."
  },
  {
    headline: `What should ${PRODUCT_NAME} look at?`,
    body: "Send the task, failing path, or half-formed plan. I'll help turn it into action."
  },
  {
    headline: 'Where should we start?',
    body: "Bring the problem, goal, or file. I'll inspect first and keep the next step concrete."
  },
  {
    headline: 'What needs attention?',
    body: "Send the context you have. I'll help sort it into a plan or a fix."
  }
]

const FALLBACK_COPY_ZH: IntroCopy[] = [
  {
    headline: '今天要处理什么？',
    body: '告诉我一个问题、计划或粗略想法。我会先查看，再把它变成下一步可执行的行动。'
  },
  {
    headline: '你在想什么？',
    body: '贴上代码、错误或文件路径。我会从这里开始，帮你推进工作。'
  },
  {
    headline: `让 ${PRODUCT_NAME} 看看什么？`,
    body: '描述任务或正在构建的东西。我会选择合适的工具，陪你把它做完。'
  },
  {
    headline: '从哪里开始？',
    body: '把问题、目标或文件交给我。我会先调查，并让下一步保持清晰。'
  },
  {
    headline: '有什么需要关注？',
    body: '分享你已有的上下文。我会帮你整理成计划或修复方案。'
  }
]

function normalizeKey(value?: string): string {
  return normalize(value)
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)
const INTRO_COPY_BY_PERSONALITY_ZH = parseIntroCopy(introCopyZhJsonl)

function neutralCopy(locale: Locale): IntroCopy[] {
  if (locale === 'zh') {
    return INTRO_COPY_BY_PERSONALITY_ZH.none || INTRO_COPY_BY_PERSONALITY_ZH.default || FALLBACK_COPY_ZH
  }

  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string, locale: Locale): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy(locale)
  }

  const label = titleize(personalityKey)

  if (locale === 'zh') {
    return [
      {
        headline: `${label} 模式已开启。我们要处理什么？`,
        body: '告诉我任务、文件或粗略想法。我会使用你配置的语气，并让工作扎根于这个仓库。'
      },
      {
        headline: `${label} 需要先看看什么？`,
        body: '带来上下文或卡住的部分。我会适应你配置的人格。'
      },
      {
        headline: `${label} 模式已就绪。`,
        body: '发送问题、文件或想法。我会遵循你配置的风格。'
      },
      {
        headline: `${label} 要解决什么？`,
        body: '把任务交给我。我会让工作始终扎根于这个仓库。'
      },
      {
        headline: '我们从哪里开始？',
        body: `给我上下文，我会用${label}模式回答。`
      }
    ]
  }

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo."
    },
    {
      headline: `What does ${label} ${PRODUCT_NAME} need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} ${PRODUCT_NAME} tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

const WORDMARK = AGENT_NAME.toUpperCase()

function resolveCopy(personality: string | undefined, seed: number | undefined, locale: Locale): IntroCopy {
  const personalityKey = normalizeKey(personality)
  const byPersonality = locale === 'zh' ? INTRO_COPY_BY_PERSONALITY_ZH : INTRO_COPY_BY_PERSONALITY

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? byPersonality[personalityKey] || neutralCopy(locale)
    : byPersonality[personalityKey] || fallbackCopyForPersonality(personalityKey, locale)

  return pickCopy(copies, seed) || (locale === 'zh' ? FALLBACK_COPY_ZH[0] : FALLBACK_COPY[0])
}

export function Intro({ home, onInsertPrompt, onPickFiles, personality, seed }: IntroProps) {
  const { locale, t } = useI18n()
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const copy = resolveCopy(personality, mountSeed + (seed ?? 0), locale)
  const showHome = home ?? Boolean(onInsertPrompt || onPickFiles)
  const homeLayoutRef = useRef<HTMLElement>(null)
  const homeContentRef = useRef<HTMLDivElement>(null)
  const homeSlotRef = useRef<HTMLDivElement>(null)

  // Own the measurement with the slot: the long-lived composer can mount
  // before this lazy intro, or survive its replacement on a project switch.
  // Ordinary positioning avoids Chromium's stale CSS-anchor paint layers.
  useLayoutEffect(() => {
    const layout = homeLayoutRef.current
    const content = homeContentRef.current
    const slot = homeSlotRef.current
    const surface = content?.closest<HTMLElement>('[data-chat-surface]')

    if (!layout || !content || !slot || !surface) {
      return
    }

    const syncTop = () => {
      surface.style.setProperty(
        '--aino-home-composer-top',
        `${slot.getBoundingClientRect().top - surface.getBoundingClientRect().top}px`
      )
    }

    syncTop()
    const observer = new ResizeObserver(syncTop)
    observer.observe(surface)
    observer.observe(content)
    // Parent clearance can reposition this fixed-size content without changing
    // either the content or chat surface bounds. Observe the sizing owner too.
    observer.observe(layout)

    return () => {
      observer.disconnect()
      surface.style.removeProperty('--aino-home-composer-top')
    }
  }, [showHome])

  if (showHome) {
    const homeCopy = t.home
    const subtitle = locale === 'en' || locale === 'zh' ? copy.body : homeCopy.subtitle

    const actions: Array<{
      description: string
      iconSrc: string
      key: HomeActionKey
      onClick: () => void
      title: string
    }> = [
      {
        description: homeCopy.actions.analyze.description,
        iconSrc: actionAnalyzeIcon,
        key: 'analyze',
        onClick: () => onPickFiles?.(),
        title: homeCopy.actions.analyze.label
      },
      {
        description: homeCopy.actions.review.description,
        iconSrc: actionCodeReviewIcon,
        key: 'review',
        onClick: () => homeCopy.actions.review.prompt && onInsertPrompt?.(homeCopy.actions.review.prompt),
        title: homeCopy.actions.review.label
      },
      {
        description: homeCopy.actions.research.description,
        iconSrc: actionResearchIcon,
        key: 'research',
        onClick: () => homeCopy.actions.research.prompt && onInsertPrompt?.(homeCopy.actions.research.prompt),
        title: homeCopy.actions.research.label
      },
      {
        description: homeCopy.actions.report.description,
        iconSrc: actionReportIcon,
        key: 'report',
        onClick: () => homeCopy.actions.report.prompt && onInsertPrompt?.(homeCopy.actions.report.prompt),
        title: homeCopy.actions.report.label
      }
    ]

    return (
      <section className="aino-home-layout" data-home-layout="" data-slot="aui_intro" ref={homeLayoutRef}>
        <div className="aino-home-content" ref={homeContentRef}>
          <h1 className="aino-home-title">{WORDMARK}</h1>
          <p className="aino-home-subtitle">{subtitle}</p>

          {/* The real composer is positioned over this reserved slot by ChatView.
              Keeping the slot in the intro preserves one source of truth for all
              composer behavior while matching the landing-page rhythm. */}
          <div aria-hidden="true" className="aino-home-composer-slot" ref={homeSlotRef} />

          <div className="aino-home-actions" role="group">
            {actions.map(action => {
              return (
                <Button
                  aria-label={action.title}
                  className={cn('aino-home-action', `aino-home-action-${action.key}`)}
                  key={action.key}
                  onClick={action.onClick}
                  type="button"
                  variant="outline"
                >
                  <AinoDesignIcon className="aino-home-action-icon" src={action.iconSrc} />
                  <span className="aino-home-action-copy">
                    <span className="aino-home-action-title">{action.title}</span>
                    <span className="aino-home-action-description">{action.description}</span>
                  </span>
                </Button>
              )
            })}
          </div>
        </div>
      </section>
    )
  }

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <div className="w-full min-w-0">
        <Wordmark className="mb-1" text={WORDMARK} />

        <p className="m-0 text-center leading-normal tracking-tight">{copy.body}</p>
      </div>
    </div>
  )
}
