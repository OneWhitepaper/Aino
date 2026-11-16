import { useStore } from '@nanostores/react'
import { Eye, ShieldCheck, UserRound } from 'lucide-react'
import { computed } from 'nanostores'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
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
  const Icon = phase === 'human' ? UserRound : phase === 'confirmation' ? ShieldCheck : Eye

  return (
    <div data-preview-agent-status="">
      <PreviewWebsiteDialog tabId={tabId} />
      <span aria-live="polite" className="flex min-w-0 flex-1 items-center gap-1" role="status" title={label}>
        <Icon aria-hidden className="shrink-0" size={14} strokeWidth={1.65} />
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
