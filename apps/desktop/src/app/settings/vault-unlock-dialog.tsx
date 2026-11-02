import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { KeyRound } from '@/lib/icons'

import type { VaultSource, VaultSourceName } from './vault-settings'

interface VaultUnlockDialogProps {
  target: VaultSource | null
  masterPassword: string
  error: string | null
  busy: boolean
  onClose: () => void
  onPasswordChange: (value: string) => void
  onUnlock: (name: VaultSourceName) => void
}

export function VaultUnlockDialog({
  target,
  masterPassword,
  error,
  busy,
  onClose,
  onPasswordChange,
  onUnlock
}: VaultUnlockDialogProps) {
  const { t } = useI18n()
  const v = t.settings.vault

  return (
    <Dialog onOpenChange={open => !open && onClose()} open={target !== null}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle icon={KeyRound}>{v.sources.unlockTitle(target?.display_name ?? '')}</DialogTitle>
          <DialogDescription>{v.sources.unlockDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={e => {
            e.preventDefault()

            if (target && masterPassword) {
              onUnlock(target.name)
            }
          }}
        >
          <Input
            autoComplete="current-password"
            autoFocus
            disabled={busy}
            onChange={e => onPasswordChange(e.target.value)}
            placeholder={v.sources.masterPasswordPlaceholder}
            type="password"
            value={masterPassword}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={busy || !masterPassword} type="submit">
              {busy ? v.sources.unlocking : v.sources.unlock}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
