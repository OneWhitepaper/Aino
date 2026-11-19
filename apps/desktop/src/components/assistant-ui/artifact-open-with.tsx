import { useEffect, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { canOpenHtmlArtifactExternally, openHtmlArtifactExternally } from '@/lib/artifact-html'
import { PRODUCT_NAME } from '@/lib/brand'
import { ChevronDown, ExternalLink, Globe, Loader2 } from '@/lib/icons'

import type { PreviewBrowserApp } from '../../../shared/preview-browser-apps'

const appRow = 'min-h-7 gap-2 px-2 py-1 text-[length:var(--aino-text-ui)] leading-5'

function ExternalAppItems({ content }: { content: string }) {
  const { t } = useI18n()
  const bridge = window.hermesDesktop?.previewBrowserApps
  const [apps, setApps] = useState<PreviewBrowserApp[] | null>(null)

  useEffect(() => {
    if (!bridge) {
      return
    }

    let mounted = true

    const apply = (result: PreviewBrowserApp[]) => {
      if (mounted) {
        setApps(result)
      }
    }

    void bridge.list().then(apply, () => apply([]))

    return () => {
      mounted = false
    }
  }, [bridge])

  if (bridge && apps === null) {
    return (
      <DropdownMenuItem className={appRow} disabled>
        <Loader2 className="size-4 motion-safe:animate-spin" />
        {t.common.loading}
      </DropdownMenuItem>
    )
  }

  if (apps?.length) {
    return apps.map(({ icon, id, name }) => (
      <DropdownMenuItem className={appRow} key={id} onSelect={() => void openHtmlArtifactExternally(content, t, id)}>
        {icon ? <img alt="" className="size-4 shrink-0 object-contain" src={icon} /> : <Globe className="size-4" />}
        <span className="min-w-0">{name}</span>
      </DropdownMenuItem>
    ))
  }

  return canOpenHtmlArtifactExternally() ? (
    <DropdownMenuItem className={appRow} onSelect={() => void openHtmlArtifactExternally(content, t)}>
      <ExternalLink className="size-4" />
      {t.artifactPreview.openExternally}
    </DropdownMenuItem>
  ) : null
}

interface ArtifactOpenWithProps {
  content: string
  disabled: boolean
  onOpen: () => void
}

export function ArtifactOpenWith({ content, disabled, onOpen }: ArtifactOpenWithProps) {
  const { t } = useI18n()

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          className="ms-auto min-h-7 max-w-full gap-0 overflow-hidden rounded-(--aino-radius-toolbar) border border-(--ui-stroke-tertiary) p-0 whitespace-normal shadow-none hover:bg-(--ui-bg-quinary) aria-expanded:bg-(--ui-bg-quinary)"
          disabled={disabled}
          size="xs"
          type="button"
          variant="outline"
        >
          <span className="min-w-0 px-2 py-1">{t.artifactCard.openWith}</span>
          <span
            aria-hidden
            className="grid w-6 shrink-0 place-items-center self-stretch border-s border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) text-(--ui-text-secondary)"
          >
            <ChevronDown className="size-3" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-[min(13rem,calc(100vw-1rem))] p-1 shadow-md">
        <DropdownMenuItem aria-description={t.preview.openPreview} className={appRow} onSelect={onOpen}>
          <BrandMark className="size-4 rounded-none" />
          {PRODUCT_NAME}
        </DropdownMenuItem>
        <ExternalAppItems content={content} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
