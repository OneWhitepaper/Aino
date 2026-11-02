import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { localizedPreviewError } from '@/i18n/preview-errors'
import { desktopFsCacheKey, isDesktopFsRemoteMode } from '@/lib/desktop-fs'
import { Download, ExternalLink, Pencil } from '@/lib/icons'
import { openPreviewTargetInBrowser } from '@/lib/local-preview'
import { downloadGatewayFileWithFeedback } from '@/lib/media'
import { notifyError } from '@/store/notifications'
import type { PreviewTarget } from '@/store/preview'
import { $connection } from '@/store/session'

interface FilePreviewActionsProps {
  filePath: string
  onEdit?: () => void
  target: PreviewTarget
}

/** A transient remote HTML source can only render once its data URL is resolved. */
export function canRenderHtmlPreview(target: PreviewTarget, tabId?: string): boolean {
  return (
    Boolean(tabId) &&
    target.kind === 'file' &&
    target.previewKind === 'html' &&
    (!target.transient || Boolean(target.dataUrl))
  )
}

/** Visible doors to the same native/file actions used by the preview row and file tree. */
export function FilePreviewActions({ filePath, onEdit, target }: FilePreviewActionsProps) {
  const { t } = useI18n()
  const connection = useStore($connection)
  const owner = desktopFsCacheKey(connection)
  const canOpen = connection?.mode !== 'remote' && Boolean(window.hermesDesktop?.openPreviewInBrowser)
  const canDownload = Boolean(window.hermesDesktop?.saveGatewayFile)

  const openInSystem = async () => {
    // A remote path must never be opened as the same-named file on this computer.
    if (owner !== desktopFsCacheKey() || isDesktopFsRemoteMode()) {
      notifyError(new Error(t.fileMenu.revealUnavailable), t.preview.unavailable)

      return
    }

    try {
      await openPreviewTargetInBrowser(target)
    } catch (error) {
      notifyError(new Error(localizedPreviewError(t, error)), t.preview.unavailable)
    }
  }

  return (
    <>
      {onEdit && (
        <Tip label={`${t.preview.edit} (e)`}>
          <Button aria-label={t.preview.edit} onClick={onEdit} size="icon-xs" type="button" variant="ghost">
            <Pencil className="size-3.5" />
          </Button>
        </Tip>
      )}
      <CopyButton appearance="icon" buttonSize="icon-xs" label={t.fileMenu.copyPath} text={filePath} />
      {canOpen && (
        <Tip label={t.preview.openInExternal}>
          <Button
            aria-label={t.preview.openInExternal}
            className="aino-preview-open-system"
            onClick={() => void openInSystem()}
            size="xs"
            type="button"
            variant="ghost"
          >
            <ExternalLink className="size-3.5" />
            <span>{t.preview.openInExternal}</span>
          </Button>
        </Tip>
      )}
      {canDownload && (
        <Tip label={t.fileMenu.download}>
          <Button
            aria-label={t.fileMenu.download}
            onClick={() =>
              void downloadGatewayFileWithFeedback(filePath, {
                owner: { connectionId: connection?.connectionId, profile: connection?.profile },
                suggestedName: target.label
              })
            }
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Download className="size-3.5" />
          </Button>
        </Tip>
      )}
    </>
  )
}
