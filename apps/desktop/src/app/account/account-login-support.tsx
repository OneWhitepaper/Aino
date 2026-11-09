import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { Info } from '@/lib/icons'

interface AccountRememberControlProps {
  browserHosted: boolean
  loading: boolean
  remember: boolean
  onChange: (remember: boolean) => void
}

export function AccountRememberControl({ browserHosted, loading, remember, onChange }: AccountRememberControlProps) {
  const { t } = useI18n()
  const copy = t.settings.account

  return browserHosted ? (
    <p className="aino-account-remember">{copy.browserSessionOnly}</p>
  ) : (
    <label className="aino-account-remember">
      <Checkbox
        aria-label={copy.rememberLabel}
        checked={remember}
        disabled={loading}
        onCheckedChange={value => onChange(value === true)}
      />
      <span>{copy.rememberLabel}</span>
    </label>
  )
}

export function AccountPhoneLoginHelp({ disabled }: { disabled: boolean }) {
  const { t } = useI18n()
  const copy = t.settings.account

  return (
    <div className="aino-account-login-note">
      <p>{copy.phoneAutoRegister}</p>
      <Popover>
        <PopoverTrigger asChild>
          <Button aria-label={copy.loginHelp} disabled={disabled} size="micro" type="button" variant="text">
            <Info aria-hidden="true" className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="aino-account-login-help" showArrow={false} side="top">
          {copy.existingAccountPhoneHint}
        </PopoverContent>
      </Popover>
    </div>
  )
}

interface AccountLoginLinksProps {
  disabled: boolean
  onExisting: () => void
  onRegistration: () => void
  onWechat: () => void
  phoneStep: boolean
  registrationClosed: boolean
  registrationEnabled: boolean
  showRegistration: boolean
}

export function AccountLoginLinks({
  disabled,
  onExisting,
  onRegistration,
  onWechat,
  phoneStep,
  registrationClosed,
  registrationEnabled,
  showRegistration
}: AccountLoginLinksProps) {
  const { t } = useI18n()
  const copy = t.settings.account

  return (
    <>
      {(phoneStep || showRegistration) && (
        <div className="aino-account-login-actions">
          {phoneStep && (
            <>
              <Button
                className="aino-account-switch"
                disabled={disabled}
                onClick={onExisting}
                size="inline"
                type="button"
                variant="text"
              >
                {copy.existingAccount}
              </Button>
              <Button
                className="aino-account-switch"
                disabled={disabled}
                onClick={onWechat}
                size="inline"
                type="button"
                variant="text"
              >
                {copy.switchWechat}
              </Button>
            </>
          )}
          {showRegistration && (
            <Button
              className="aino-account-switch"
              disabled={disabled || !registrationEnabled}
              onClick={onRegistration}
              size="inline"
              type="button"
              variant="text"
            >
              {copy.registerAccount}
            </Button>
          )}
        </div>
      )}
      {showRegistration && registrationClosed && (
        <p className="mt-2 text-center text-xs text-(--ui-text-tertiary)">{copy.registrationClosed}</p>
      )}
    </>
  )
}
