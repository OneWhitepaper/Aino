import { useStore } from '@nanostores/react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { AlertTriangle, ShieldLock } from '@/lib/icons'
import { $previewScriptConsentQueue, answerPreviewScriptConsent } from '@/store/plugin-preview-grants'

/**
 * The app-owned consent prompt for `ctx.preview.executeJavaScript`. A plugin
 * never renders or answers it: the first call a plugin makes on a page origin
 * queues a request, this dialog shows the oldest one (plugin name + origin),
 * and only an explicit "Allow on this site" grants. Every other close path —
 * "Don't allow", Esc, the backdrop — funnels through `onOpenChange(false)` as
 * a refusal, so silence is never consent.
 */
export function PluginPreviewConsentDialog() {
  const { t } = useI18n()
  const copy = t.skills.plugins
  const request = useStore($previewScriptConsentQueue)[0]

  if (!request) {
    return null
  }

  return (
    <Dialog
      key={request.id}
      onOpenChange={open => {
        if (!open) {
          answerPreviewScriptConsent(request.id, false)
        }
      }}
      open
    >
      <DialogContent
        className="max-w-md"
        data-testid="plugin-preview-consent"
        footer={
          <DialogFooter>
            <Button
              className="max-w-full whitespace-normal"
              onClick={() => answerPreviewScriptConsent(request.id, false)}
              type="button"
              variant="ghost"
            >
              {copy.previewScriptDeny}
            </Button>
            <Button
              className="max-w-full whitespace-normal"
              onClick={() => answerPreviewScriptConsent(request.id, true)}
              type="button"
            >
              {copy.previewScriptAllow}
            </Button>
          </DialogFooter>
        }
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle icon={ShieldLock}>{copy.previewScriptPromptTitle(request.pluginName)}</DialogTitle>
          <DialogDescription>{copy.previewScriptPromptBody(request.pluginName, request.origin)}</DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-3 text-[0.8125rem] leading-5 [overflow-wrap:anywhere]">
          <code className="min-w-0 max-w-full w-fit whitespace-pre-wrap rounded bg-(--ui-bg-tertiary) px-1.5 py-0.5 text-foreground">
            {request.origin}
          </code>
          <Alert role="note" variant="warning">
            <AlertTriangle aria-hidden />
            <AlertDescription>{copy.previewScriptPromptRisk}</AlertDescription>
          </Alert>
          <p className="text-(--ui-text-secondary)">{copy.previewScriptPromptRevokeHint}</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
