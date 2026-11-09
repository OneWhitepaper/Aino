import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { modelSourceCopy } from '@/i18n/model-source'
import type { ModelSettingsTranslations } from '@/i18n/types_model_settings'
import { Loader2 } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import { cn } from '@/lib/utils'

import { CONTROL_TEXT } from './constants'
import { ListRow } from './primitives'

interface MainModelConnectionEditorProps {
  m: ModelSettingsTranslations
  apiKeyDraft: string
  activating: boolean
  keyEnv?: string | null
  needsSetup: boolean
  onKeyChange: (value: string) => void
  onSave: () => Promise<void>
  onCancel: () => void
}

export function MainModelConnectionEditor({
  m,
  apiKeyDraft,
  activating,
  keyEnv,
  needsSetup,
  onKeyChange,
  onSave,
  onCancel
}: MainModelConnectionEditorProps) {
  const { t, locale } = useI18n()
  const copy = modelSourceCopy(locale)

  return (
    <ListRow
      action={
        <div className="grid w-full min-w-0 justify-items-end gap-2">
          <Input
            aria-label={m.defaultMain.connection}
            autoComplete="off"
            className={cn('w-full min-w-0', CONTROL_TEXT)}
            onChange={event => onKeyChange(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                void onSave()
              }
            }}
            placeholder={m.apiKeyPlaceholder(keyEnv ?? 'API key')}
            type="password"
            value={apiKeyDraft}
          />
          <div className="flex gap-2">
            {!needsSetup && (
              <Button onClick={onCancel} size="sm" variant="ghost">
                {t.common.cancel}
              </Button>
            )}
            <Button disabled={!apiKeyDraft.trim() || activating} onClick={() => void onSave()} size="sm">
              {activating && <Loader2 className="size-3.5 animate-spin" />}
              {activating ? m.activating : copy.fetchModels}
            </Button>
          </div>
        </div>
      }
      title={m.defaultMain.connection}
    />
  )
}

interface MainModelSetupEmptyProps {
  source: 'provider' | 'custom'
  onSetup: () => void
}

export function MainModelSetupEmpty({ source, onSetup }: MainModelSetupEmptyProps) {
  const { locale } = useI18n()
  const copy = modelSourceCopy(locale)

  return (
    <div className="py-4 text-[length:var(--aino-text-ui)] text-muted-foreground">
      <p className="mb-3 leading-relaxed">{source === 'custom' ? copy.customEmpty : copy.noProviders}</p>
      <Button onClick={onSetup} size="sm" variant="outline">
        {source === 'custom' ? copy.configureCustom : copy.configureProvider}
      </Button>
    </div>
  )
}
