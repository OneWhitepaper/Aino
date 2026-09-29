import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { artifactImageSrc } from '@/app/artifacts/artifact-utils'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { openArtifact } from '@/store/artifacts'
import { revealFileInTree } from '@/store/layout'
import { notifyError } from '@/store/notifications'
import { openPreview } from '@/store/preview'

import type { SummaryResource } from './session-content'
import { type SummarySession, summarySessionIsCurrent } from './use-summary-session'

const RESOURCE_ICONS: Record<SummaryResource['kind'], string> = {
  file: 'file',
  folder: 'folder',
  image: 'file-media',
  skill: 'book',
  tool: 'plug',
  url: 'globe'
}

function ResourceGlyph({ item, session }: { item: SummaryResource; session: SummarySession }) {
  const image = useQuery({
    queryKey: ['summary-image', session.scope.connectionId, session.scope.profile, item.target],
    queryFn: () => artifactImageSrc(item.target),
    enabled: item.kind === 'image' && summarySessionIsCurrent(session),
    retry: false,
    staleTime: Infinity,
    gcTime: 60_000
  })

  return image.data ? (
    <img alt="" className="size-8 shrink-0 rounded-sm object-cover" src={image.data} />
  ) : (
    <Codicon className="shrink-0 text-(--ui-text-tertiary)" name={RESOURCE_ICONS[item.kind]} />
  )
}

export function SummaryResourceList({ items, session }: { items: SummaryResource[]; session: SummarySession }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, 4)

  const open = async (item: SummaryResource) => {
    if (!summarySessionIsCurrent(session)) {
      return
    }

    try {
      if (item.artifactId) {
        openArtifact(item.artifactId)
      } else if (item.kind === 'folder') {
        revealFileInTree(item.target)
      } else {
        const preview = item.target.startsWith('data:image/')
          ? {
              kind: 'file' as const,
              label: item.label,
              previewKind: 'image' as const,
              dataUrl: item.target,
              source: item.id,
              url: item.target,
              transient: true
            }
          : await normalizeOrLocalPreviewTarget(item.target, item.cwd || session.cwd || undefined)

        if (!summarySessionIsCurrent(session)) {
          return
        }

        if (preview) {
          openPreview(preview)
        }
      }
    } catch (error) {
      notifyError(error, t.summary.state.unavailable)
    }
  }

  return (
    <div className="grid min-w-0 gap-1">
      {visible.map(item => {
        const informational = item.kind === 'tool' || item.kind === 'skill'

        const content = (
          <>
            <ResourceGlyph item={item} session={session} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {informational && (
              <span className="shrink-0 text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
                {item.kind === 'skill' ? t.summary.sources.skill : t.summary.sources.tool}
              </span>
            )}
          </>
        )

        return (
          <Tip key={item.id} label={item.target.startsWith('data:') ? item.label : item.target}>
            {informational ? (
              <div className="flex min-w-0 items-center gap-2 py-1.5">{content}</div>
            ) : (
              <Button
                aria-label={`${t.summary.sources.open}: ${item.label}`}
                className="min-w-0 justify-start text-left"
                disabled={!summarySessionIsCurrent(session)}
                onClick={() => void open(item)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {content}
              </Button>
            )}
          </Tip>
        )
      })}
      {items.length > 4 && (
        <Button
          aria-expanded={expanded}
          className="mt-1 justify-start"
          onClick={() => setExpanded(value => !value)}
          size="inline"
          type="button"
          variant="text"
        >
          {expanded ? t.summary.state.showLess : t.summary.state.showAll(items.length)}
        </Button>
      )}
    </div>
  )
}
