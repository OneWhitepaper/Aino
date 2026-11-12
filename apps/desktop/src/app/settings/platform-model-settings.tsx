import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { PlatformModelList, usePlatformModels } from '@/components/platform-model-list'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { ChevronDown } from '@/lib/icons'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { $activeConnectionId } from '@/store/connections'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { hasPlatformModelIdentity, type PlatformModel } from '../../../shared/platform-contract'

import { ListRow } from './primitives'

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
  const [candidateId, setCandidateId] = useState(selectedId)
  const [reauthorize, setReauthorize] = useState<ReauthorizationIntent | null>(null)
  const accountId = catalog.account?.account?.id
  const candidate = catalog.models.find(model => model.id === candidateId)
  const selected = catalog.models.find(model => model.id === selectedId)

  useEffect(() => {
    setOpen(false)
    setCandidateId(selectedId)
  }, [scope.key, catalog.account?.account?.id, catalog.account?.revision, selectedId])

  // Issuance advances the revision before it settles; only a new owner cancels the intent.
  useEffect(() => {
    setReauthorize(null)
  }, [scope.key, accountId])

  return (
    <>
      <ListRow
        action={
          <Button
            aria-haspopup="dialog"
            aria-label={t.settings.model.defaultMain.chooseBuiltIn}
            className="w-full justify-between"
            disabled={disabled}
            onClick={() => {
              setCandidateId(selectedId)
              setOpen(true)
            }}
            variant="outline"
          >
            <span className="min-w-0 truncate">
              {selected?.display_name || selectedId || t.settings.model.defaultMain.chooseBuiltIn}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        }
        title={t.settings.model.model}
      />
      <p
        className="default-main-model-connection"
        data-connected={hasPlatformModelIdentity(catalog.account) || undefined}
      >
        {hasPlatformModelIdentity(catalog.account)
          ? t.settings.model.defaultMain.ainoConnected
          : t.platformModels.not_authenticated}
      </p>
      {window.hermesDesktop?.platformModels?.reauthorize && catalog.account?.phase === 'signed_in' && accountId && (
        <Button
          disabled={disabled}
          onClick={() => setReauthorize({ accountId, scopeKey: scope.key })}
          size="sm"
          variant="outline"
        >
          {t.platformModels.reauthorize}
        </Button>
      )}
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
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent bodyClassName="gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-4">
            <DialogTitle>{t.settings.model.defaultMain.selectionTitle}</DialogTitle>
            <DialogDescription>{t.settings.model.defaultMain.selectionDescription}</DialogDescription>
          </DialogHeader>
          <PlatformModelList
            disabled={disabled}
            managedCapability={capability}
            onSelect={model => {
              setCandidateId(model.id)
            }}
            selectedId={candidateId}
          />
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <Button onClick={() => setOpen(false)} size="sm" variant="outline">
              {t.common.cancel}
            </Button>
            <Button
              disabled={disabled || capability !== 'supported' || candidate?.state !== 'available'}
              onClick={() => {
                if (candidate) {
                  onSelect(candidate)
                  setOpen(false)
                }
              }}
              size="sm"
            >
              {t.settings.model.defaultMain.confirmSelection}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
