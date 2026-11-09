import { useStore } from '@nanostores/react'

import type { ProfileScope } from '@/api/client'
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
import { Check, Globe, Loader2, Plus, Trash2, Zap } from '@/lib/icons'
import { $settingsRequestProfile } from '@/store/settings-scope'

import { customModelConfigCopy } from './custom-model-config-copy'
import { CustomModelEditor } from './custom-model-editor'
import { EmptyState, Pill, SectionHeading, SettingsContent, SettingsSkeleton } from './primitives'
import { SettingsProfileScope } from './profile-scope'
import { type CustomEndpointEditor, useCustomEndpointEditor } from './use-custom-endpoint-editor'

interface CustomEndpointsSettingsProps {
  embedded?: boolean
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
}

interface CustomModelConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope?: ProfileScope
  onConfigSaved?: () => void
}

export function CustomModelConfigDialog({ open, onOpenChange, scope, onConfigSaved }: CustomModelConfigDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open && (
        <CustomModelConfigDialogContent onConfigSaved={onConfigSaved} onOpenChange={onOpenChange} scope={scope} />
      )}
    </Dialog>
  )
}

function CustomModelConfigDialogContent({
  onOpenChange,
  scope,
  onConfigSaved
}: Omit<CustomModelConfigDialogProps, 'open'>) {
  const { locale, t } = useI18n()
  const copy = customModelConfigCopy(locale)
  const editor = useCustomEndpointEditor({ autoSelect: false, makeDefault: false, onConfigSaved, scope })

  return (
    <DialogContent bodyClassName="gap-5 p-6" className="max-w-[540px]">
      <DialogHeader className="gap-1.5 pr-6 text-left">
        <DialogTitle className="text-[length:var(--aino-text-title)]">{copy.title}</DialogTitle>
        <DialogDescription className="text-[length:var(--aino-text-caption)]">{copy.description}</DialogDescription>
      </DialogHeader>
      {editor.loading ? <SettingsSkeleton sections={[{ rows: 3 }]} /> : <CustomModelEditor dialog editor={editor} />}
      <DialogFooter className="flex-row justify-end gap-2 border-t border-border/50 pt-4">
        <Button className="min-w-18" onClick={() => onOpenChange(false)} type="button" variant="outline">
          {t.common.cancel}
        </Button>
        <Button
          className="min-w-18"
          disabled={editor.loading || editor.saving || Boolean(editor.deleting) || editor.testing || !editor.canSave}
          onClick={async () => {
            if (await editor.save()) {
              onOpenChange(false)
            }
          }}
          type="button"
        >
          {editor.saving && <Loader2 className="size-3.5 animate-spin" />}
          {editor.saving ? t.settings.customEndpoints.saving : t.settings.customEndpoints.save}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function EndpointList({ editor }: { editor: CustomEndpointEditor }) {
  const { t } = useI18n()
  const c = t.settings.customEndpoints

  return (
    <div className="divide-y divide-border/40 rounded-xl border border-border/50">
      {editor.endpoints.length ? (
        editor.endpoints.map(endpoint => (
          <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={endpoint.id}>
            <button
              className="min-w-0 text-left"
              disabled={editor.saving || Boolean(editor.deleting) || Boolean(editor.activating)}
              onClick={() => editor.select(endpoint)}
              type="button"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[length:var(--aino-text-ui)] font-medium">{endpoint.name}</span>
                {endpoint.is_current && (
                  <Pill tone="primary">
                    <Check className="size-3" />
                    {c.active}
                  </Pill>
                )}
                {endpoint.source === 'direct-config' && <Pill>config.yaml</Pill>}
              </div>
              <div className="mt-1 truncate text-[length:var(--aino-text-caption)] text-muted-foreground">
                {endpoint.base_url}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[length:var(--aino-text-caption)] text-muted-foreground">
                <span>{endpoint.model}</span>
                {endpoint.has_api_key && <span>{c.apiKeySet}</span>}
              </div>
            </button>
            <div className="flex items-center gap-2 sm:justify-end">
              <Button
                disabled={
                  endpoint.is_current || editor.saving || Boolean(editor.activating) || Boolean(editor.deleting)
                }
                onClick={() => void editor.activate(endpoint)}
                size="sm"
                variant="outline"
              >
                {editor.activating === endpoint.id ? <Loader2 className="animate-spin" /> : <Zap />}
                {c.use}
              </Button>
              {endpoint.source !== 'direct-config' && (
                <Button
                  aria-label={c.deleteEndpoint}
                  className="hover:text-destructive"
                  disabled={editor.saving || Boolean(editor.deleting) || Boolean(editor.activating)}
                  onClick={() => void editor.remove(endpoint)}
                  size="icon-sm"
                  variant="ghost"
                >
                  {editor.deleting === endpoint.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              )}
            </div>
          </div>
        ))
      ) : (
        <EmptyState description={c.emptyDescription} title={c.emptyTitle} />
      )}
    </div>
  )
}

export function CustomEndpointsSettings({
  embedded = false,
  onConfigSaved,
  onMainModelChanged
}: CustomEndpointsSettingsProps) {
  const { t } = useI18n()
  const c = t.settings.customEndpoints
  const scope = useStore($settingsRequestProfile)
  const editor = useCustomEndpointEditor({ onConfigSaved, onMainModelChanged, scope })

  const content = (
    <>
      {!embedded && <SettingsProfileScope className="mb-5" />}
      {editor.loading ? (
        <SettingsSkeleton sections={[{ heading: true, rows: 3 }]} />
      ) : (
        <div className="space-y-6">
          <section>
            {!embedded && <SectionHeading icon={Globe} meta={`${editor.endpoints.length}`} page title={c.title} />}
            <EndpointList editor={editor} />
          </section>
          <section>
            <SectionHeading icon={Plus} title={editor.form.id ? c.editTitle : c.addTitle} />
            <div className="rounded-xl border border-border/50 p-5">
              <CustomModelEditor editor={editor} />
              <div className="mt-5 flex items-center justify-end gap-2 border-t border-border/50 pt-4">
                {editor.form.id && (
                  <Button
                    disabled={editor.saving || Boolean(editor.deleting)}
                    onClick={editor.reset}
                    type="button"
                    variant="ghost"
                  >
                    {c.newEndpoint}
                  </Button>
                )}
                <Button
                  disabled={
                    editor.saving ||
                    Boolean(editor.deleting) ||
                    Boolean(editor.activating) ||
                    editor.testing ||
                    !editor.canSave
                  }
                  onClick={() => void editor.save()}
                  type="button"
                >
                  {editor.saving && <Loader2 className="size-3.5 animate-spin" />}
                  {editor.saving ? c.saving : c.save}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  )

  return embedded ? <div>{content}</div> : <SettingsContent>{content}</SettingsContent>
}
