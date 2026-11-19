'use client'

import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { CodeCardIcon } from '@/components/chat/code-card'
import { WIDGET_SHELL_CLASS } from '@/components/chat/widget-shell'
import { useI18n } from '@/i18n'
import type { ArtifactDetection } from '@/lib/artifact-detect'
import { Globe } from '@/lib/icons'
import { codiconForLanguage } from '@/lib/markdown-code'
import { cn } from '@/lib/utils'
import { $artifactRegistry, artifactsForSession, openArtifact, upsertArtifact } from '@/store/artifacts'

import { ArtifactOpenWith } from './artifact-open-with'

interface ArtifactCardProps {
  code: string
  detection: ArtifactDetection
  streaming?: boolean
}

interface WebPreviewCardProps {
  content: string
  description: string
  disabled: boolean
  onOpen: () => void
  streaming: boolean
  title: string
}

function WebPreviewCard({ content, description, disabled, onOpen, streaming, title }: WebPreviewCardProps) {
  const { t } = useI18n()

  return (
    <div
      className="my-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-(--aino-radius-card) border border-(--ui-stroke-tertiary) bg-(--ui-widget-surface-background) p-3"
      data-slot="aui_artifact-card"
    >
      <button
        aria-label={`${t.preview.openPreview}: ${title}`}
        className="flex min-w-0 flex-1 basis-36 items-center gap-2.5 rounded-(--aino-radius-control) text-start transition-colors enabled:cursor-pointer enabled:hover:bg-(--ui-row-hover-background) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        disabled={disabled}
        onClick={onOpen}
        type="button"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--ui-bg-quaternary) text-(--ui-blue) dark:text-[color:color-mix(in_srgb,var(--ui-blue)_72%,var(--ui-text-primary))]">
          <Globe className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-[length:var(--conversation-text-font-size)] leading-snug font-medium text-(--ui-text-primary)',
              streaming && 'shimmer text-foreground/55'
            )}
            title={title}
          >
            {title}
          </span>
          <span className="block truncate text-[length:var(--conversation-caption-font-size)] leading-snug text-(--ui-text-secondary)">
            {description}
          </span>
        </span>
      </button>
      <ArtifactOpenWith content={content} disabled={disabled} onOpen={onOpen} />
    </div>
  )
}

/**
 * Transcript stand-in for a fenced block that was promoted to an artifact.
 * Replaces the wall of code with a compact, openable card: icon, title, kind,
 * version badge. While the fence is still streaming
 * it shows a shimmer + line count instead of the growing source.
 *
 * Registration is automatic on completion (so version history accumulates
 * even if the user never opens the card) but opening the rail is strictly
 * click-driven — a background stream never steals the pane.
 */
export function ArtifactCard({ code, detection, streaming = false }: ArtifactCardProps) {
  const { t } = useI18n()
  const copy = t.artifactCard
  const view = useSessionView()
  const runtimeId = useStore(view.$runtimeId)
  const storedId = useStore(view.$storedId)
  const registry = useStore($artifactRegistry)
  const sessionId = storedId || runtimeId || ''

  const trimmed = code.trim()

  // Register/version the artifact once its fence has finished streaming.
  // upsertArtifact dedupes on content hash, so re-renders and transcript
  // replays are no-ops.
  useEffect(() => {
    if (!streaming && sessionId && trimmed) {
      upsertArtifact(sessionId, detection, trimmed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- detection derives from code
  }, [detection.kind, detection.language, detection.title, sessionId, streaming, trimmed])

  const record = useMemo(() => {
    void registry

    const slugMatch = artifactsForSession(sessionId).find(
      candidate => candidate.kind === detection.kind && candidate.versions.some(v => v.content === trimmed)
    )

    return slugMatch ?? null
  }, [detection.kind, registry, sessionId, trimmed])

  const lineCount = useMemo(() => trimmed.split('\n').length, [trimmed])
  const kindLabel = copy.kind[detection.kind]
  const versionCount = record?.versions.length ?? 0
  const title = (record?.title || detection.title || kindLabel).trim() || kindLabel

  const description = streaming
    ? copy.generating(lineCount)
    : versionCount > 1
      ? `${kindLabel} · ${copy.versionBadge(versionCount)}`
      : kindLabel

  const disabled = streaming || !sessionId || !trimmed

  const open = () => {
    if (disabled) {
      return
    }

    // Ensure the registry row exists even if the completion effect hasn't
    // fired yet (e.g. clicked in the same frame the stream sealed).
    const result = upsertArtifact(sessionId, detection, trimmed)

    if (!result) {
      return
    }

    // An older card opens at ITS version, not silently the newest — the user
    // clicked this specific iteration.
    const versionIndex = result.record.versions.findIndex(version => version.content === trimmed)

    openArtifact(result.artifactId, versionIndex === -1 ? undefined : versionIndex)
  }

  if (detection.kind === 'html') {
    return (
      <WebPreviewCard
        content={trimmed}
        description={description}
        disabled={disabled}
        onOpen={open}
        streaming={streaming}
        title={title}
      />
    )
  }

  return (
    <button
      className={cn(
        WIDGET_SHELL_CLASS,
        'group/artifact my-1.5 flex w-full max-w-md items-center gap-2.5 overflow-hidden text-left',
        streaming ? 'cursor-default' : 'cursor-pointer'
      )}
      data-slot="aui_artifact-card"
      disabled={streaming}
      onClick={open}
      type="button"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/55 text-muted-foreground">
        <CodeCardIcon
          className="text-[1rem]"
          name={detection.kind === 'code' ? codiconForLanguage(detection.language) : 'symbol-color'}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[length:var(--conversation-text-font-size)] font-medium text-foreground',
            streaming && 'shimmer text-foreground/55'
          )}
        >
          {title}
        </span>
        <span className="block truncate text-[length:var(--conversation-tool-font-size)] text-muted-foreground">
          {description}
        </span>
      </span>
      {!streaming && (
        <span className="shrink-0 text-[length:var(--conversation-tool-font-size)] font-medium text-muted-foreground opacity-0 transition-opacity group-hover/artifact:opacity-100">
          {copy.open}
        </span>
      )}
    </button>
  )
}
