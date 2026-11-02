import type { ModelOptionProvider } from '@hermes/shared'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { modelSourceCopy } from '@/i18n/model-source'
import { Eye, EyeOff, Loader2 } from '@/lib/icons'

import { customModelConfigCopy } from './custom-model-config-copy'

interface ProviderCredentialInputProps {
  provider: ModelOptionProvider
  apiKey: string
  busy: boolean
  showKey: boolean
  className: string
  onKeyChange: (value: string) => void
  onToggleVisibility: () => void
}

export function ProviderCredentialInput({
  provider,
  apiKey,
  busy,
  showKey,
  className,
  onKeyChange,
  onToggleVisibility
}: ProviderCredentialInputProps) {
  const { t, locale } = useI18n()
  const copy = modelSourceCopy(locale)
  const formCopy = customModelConfigCopy(locale)

  return (
    <label className={className}>
      {t.settings.customEndpoints.apiKey}
      <Input
        aria-label={t.settings.customEndpoints.apiKey}
        disabled={busy}
        onChange={event => onKeyChange(event.target.value)}
        placeholder={
          provider.authenticated ? copy.keySaved : t.settings.model.apiKeyPlaceholder(provider.key_env || 'API Key')
        }
        suffix={
          <Button
            aria-label={showKey ? formCopy.hideKey : formCopy.showKey}
            className="pointer-events-auto"
            onClick={onToggleVisibility}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            {showKey ? <EyeOff /> : <Eye />}
          </Button>
        }
        type={showKey ? 'text' : 'password'}
        value={apiKey}
      />
    </label>
  )
}

interface ProviderConnectionSubmitProps {
  provider: ModelOptionProvider
  apiKey: string
  busy: boolean
  onConnect: () => void
}

export function ProviderConnectionSubmit({ provider, apiKey, busy, onConnect }: ProviderConnectionSubmitProps) {
  const { locale } = useI18n()
  const copy = modelSourceCopy(locale)

  return (
    <div className="flex justify-end border-t border-(--ui-stroke-tertiary) pt-4">
      <Button
        disabled={busy || (!apiKey.trim() && !provider.authenticated)}
        onClick={onConnect}
        size="sm"
        type="button"
      >
        {busy && <Loader2 className="animate-spin" />}
        {provider.authenticated && !apiKey.trim() ? copy.refreshModels : copy.fetchModels}
      </Button>
    </div>
  )
}
