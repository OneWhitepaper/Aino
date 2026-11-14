import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'

import { $previewAgentActivity, resumePreview, takeOverPreview } from './preview-agent-control'
import { previewAgentCopy } from './preview-agent-i18n'
import { PreviewWebsiteDialog } from './preview-website-dialog'

interface PreviewAgentStatusProps {
  tabId: string
}

export function PreviewAgentStatus({ tabId }: PreviewAgentStatusProps) {
  const { locale } = useI18n()
  const copy = previewAgentCopy(locale)
  const activity = useMemo(() => computed($previewAgentActivity, state => state[tabId] ?? 'idle'), [tabId])
  const phase = useStore(activity)
  const label = phase === 'idle' ? copy.ready : copy[phase]
  const icon = phase === 'human' ? 'account' : phase === 'confirmation' ? 'shield' : 'eye'

  return (
    <div className="flex h-6 w-40 shrink-0 items-center gap-1 text-[length:var(--aino-text-caption)] text-muted-foreground">
      <PreviewWebsiteDialog tabId={tabId} />
      <span aria-live="polite" className="flex min-w-0 flex-1 items-center gap-1" role="status" title={label}>
        <Codicon className="shrink-0" name={icon} size="0.75rem" />
        <span className="truncate">{label}</span>
      </span>
      {phase !== 'human' ? (
        <Button onClick={() => takeOverPreview(tabId)} size="xs" variant="ghost">
          {copy.takeOver}
        </Button>
      ) : (
        <Button onClick={() => resumePreview(tabId)} size="xs" variant="ghost">
          {copy.resume}
        </Button>
      )}
    </div>
  )
}
