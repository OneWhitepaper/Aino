import { useStore } from '@nanostores/react'
import { WandSparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { PlatformModelList, usePlatformModels } from '@/components/platform-model-list'
import { PlatformModelRate } from '@/components/platform-model-rate'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { controlVariants } from '@/components/ui/control'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { cn } from '@/lib/utils'
import { $activeConnectionId } from '@/store/connections'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { hasPlatformModelIdentity, type PlatformModel } from '../../../shared/platform-contract'

interface PlatformModelSettingsProps {
  scopeProfile?: string
  selectedId?: string
  onSelect: (model: PlatformModel) => void
  disabled?: boolean
}

interface ReauthorizationIntent {
  accountId: string
  scopeKey: string
}

/** The catalog only edits a draft; the parent owns the single default Apply action. */
export function PlatformModelSettings({ scopeProfile, selectedId, onSelect, disabled }: PlatformModelSettingsProps) {
  const { t } = useI18n()
  const catalog = usePlatformModels()
  const activeProfile = useStore($activeGatewayProfile)
  useStore($connection)
  useStore($activeConnectionId)
  const scope = platformDefaultScope(scopeProfile ?? activeProfile)
  const managed = useStore($gatewayManagedCapabilities)
  const capability = managedModelRouteCapabilityFrom(managed, scope.route)
  const [open, setOpen] = useState(false)
  const [reauthorize, setReauthorize] = useState<ReauthorizationIntent | null>(null)
  const accountId = catalog.account?.account?.id
  const selectedModel = catalog.models.find(model => model.id === selectedId)
  const selectedLabel = selectedModel?.display_name ?? t.settings.model.defaultMain.unconfigured

  // Issuance advances the revision before it settles; only a new owner cancels the intent.
  useEffect(() => {
    setOpen(false)
    setReauthorize(null)
  }, [scope.key, accountId, catalog.account?.mode])

  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-expanded={open}
            aria-label={`${t.platformModels.builtIn}: ${selectedLabel}`}
            className={cn(controlVariants(), 'platform-model-settings-trigger')}
            disabled={disabled}
            role="combobox"
            type="button"
          >
            <WandSparkles aria-hidden size={18} strokeWidth={1.65} />
            <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
            {selectedModel && <PlatformModelRate model={selectedModel} />}
            <Codicon
              aria-hidden
              className="shrink-0 text-muted-foreground"
              name={open ? 'chevron-up' : 'chevron-down'}
              size="1rem"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={t.platformModels.builtIn}
          className="platform-model-settings-dropdown"
          variant="menu"
        >
          <PlatformModelList
            detailsActions={
              window.hermesDesktop?.platformModels?.reauthorize &&
              catalog.account?.phase === 'signed_in' &&
              accountId ? (
                <Button
                  disabled={disabled}
                  onClick={() => {
                    setOpen(false)
                    setReauthorize({ accountId, scopeKey: scope.key })
                  }}
                  size="sm"
                  variant="outline"
                >
                  {t.platformModels.reauthorize}
                </Button>
              ) : null
            }
            disabled={disabled}
            fitContent
            managedCapability={capability}
            onApplied={() => setOpen(false)}
            onSelect={onSelect}
            selectedId={selectedId}
          />
        </PopoverContent>
      </Popover>
      <p
        className="default-main-model-connection"
        data-connected={hasPlatformModelIdentity(catalog.account) || undefined}
      >
        {hasPlatformModelIdentity(catalog.account)
          ? t.settings.model.defaultMain.ainoConnected
          : t.platformModels.not_authenticated}
      </p>
      <ConfirmDialog
        confirmLabel={t.platformModels.reauthorize}
        description={t.platformModels.reauthorizeDescription}
        key={JSON.stringify([scope.key, accountId])}
        onClose={() => setReauthorize(current => (current === reauthorize ? null : current))}
        onConfirm={async () => {
          if (
            !catalog.account ||
            reauthorize === null ||
            reauthorize.accountId !== accountId ||
            reauthorize.scopeKey !== scope.key
          ) {
            return
          }

          try {
            await window.hermesDesktop?.platformModels?.reauthorize?.(catalog.account.revision)
          } catch (error) {
            const code =
              error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'platform_error'

            const reason = ['RECENT_AUTH_REQUIRED', 'not_authenticated', 'refresh_token_revoked'].includes(code)
              ? 'reauthentication_required'
              : code

            throw new Error(t.settings.account.platformError(reason))
          }
        }}
        open={reauthorize !== null}
        title={t.platformModels.reauthorize}
      />
    </>
  )
}
