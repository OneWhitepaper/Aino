import './account-login.css'

import { useEffect, useState } from 'react'

import accountLogo from '@/assets/aino-account/logo.png'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { Loader2 } from '@/lib/icons'
import { isBrowserHostedDesktop } from '@/lib/platform'
import type { AccountError } from '@/store/account'

import type {
  PhoneChallengeDTO,
  PhoneVerifyDTO,
  PlatformAuthResult,
  PlatformPublicCapabilities
} from '../../../shared/platform-contract'

import { AccountLoginLinks, AccountPhoneLoginHelp, AccountRememberControl } from './account-login-support'

type LoginStep = 'phone' | 'code' | 'existing' | 'totp' | 'wechat'

export interface AccountLoginCardProps {
  capabilities?: PlatformPublicCapabilities | null
  error?: AccountError | null
  fixedCodeHint?: boolean
  loading?: boolean
  onRequestPhoneCode: (phone: string) => Promise<PhoneChallengeDTO | null>
  onVerifyPhoneCode: (input: PhoneVerifyDTO) => Promise<PlatformAuthResult | null>
  onLoginExisting: (input: { email: string; password: string; remember: boolean }) => Promise<PlatformAuthResult | null>
  onCompleteSecondFactor: (code: string) => Promise<unknown>
}

export function AccountLoginCard({
  capabilities,
  error,
  fixedCodeHint = false,
  loading = false,
  onRequestPhoneCode,
  onVerifyPhoneCode,
  onLoginExisting,
  onCompleteSecondFactor
}: AccountLoginCardProps) {
  const { t } = useI18n()
  const copy = t.settings.account
  const [phone, setPhone] = useState('')
  const [challenge, setChallenge] = useState<PhoneChallengeDTO | null>(null)
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [step, setStep] = useState<LoginStep>('phone')
  const [secondFactorReturn, setSecondFactorReturn] = useState<'code' | 'existing'>('existing')
  const [retryAt, setRetryAt] = useState(0)
  const [retrySeconds, setRetrySeconds] = useState(0)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [termsRequired, setTermsRequired] = useState(false)
  const browserHosted = isBrowserHostedDesktop()
  const [remember, setRemember] = useState(!browserHosted)
  const [legalDocument, setLegalDocument] = useState<number | null>(null)
  const [openingRegistration, setOpeningRegistration] = useState(false)
  const [registrationOpened, setRegistrationOpened] = useState(false)
  const [registrationError, setRegistrationError] = useState(false)
  const [dismissedError, setDismissedError] = useState<AccountError | null | undefined>(null)

  const busy = loading || openingRegistration
  const agreementRequired = capabilities?.login_agreement_enabled === true

  const invitationRequired = Boolean(
    capabilities?.registration_enabled &&
    capabilities.phone_registration_enabled &&
    capabilities.invitation_code_enabled
  )

  const phoneEnabled = capabilities?.phone_login_enabled === true

  const phoneRegistrationEnabled =
    phoneEnabled && capabilities?.registration_enabled && capabilities.phone_registration_enabled

  const codeLength = Math.max(1, Math.min(64, capabilities?.phone_code_length ?? 6))

  const dismissFeedback = () => {
    setTermsRequired(false)
    setRegistrationError(false)

    // Only dismiss this form's feedback. Missing capabilities still need the
    // account gate's service error and Retry action, owned by the account store.
    if (capabilities) {
      setDismissedError(error)
    }
  }

  const changeStep = (nextStep: LoginStep) => {
    dismissFeedback()
    setStep(nextStep)
  }

  useEffect(() => {
    if (capabilities && !phoneEnabled && step === 'phone') {
      setStep('existing')
    }
  }, [capabilities, phoneEnabled, step])

  useEffect(() => {
    if (!retryAt) {
      return
    }

    const update = () => setRetrySeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)

    return () => window.clearInterval(timer)
  }, [retryAt])

  useEffect(() => {
    if (error?.retryAfter === undefined) {
      return
    }

    setRetryAt(Date.now() + error.retryAfter * 1000)
    setRetrySeconds(error.retryAfter)
  }, [error])

  const requestCode = async () => {
    const value = phone.trim()

    if (!value || busy || !phoneEnabled || retrySeconds > 0) {
      return
    }

    setRegistrationError(false)

    if (agreementRequired && !acceptedTerms) {
      setTermsRequired(true)

      return
    }

    const result = await onRequestPhoneCode(value)

    if (!result) {
      return
    }

    setPhone(value)
    setChallenge(result)
    setCode('')
    setRetryAt(Date.now() + result.retry_after * 1000)
    setRetrySeconds(result.retry_after)
    changeStep('code')
  }

  const verifyCode = async () => {
    if (!challenge || code.length !== codeLength || busy) {
      return
    }

    setRegistrationError(false)

    const result = await onVerifyPhoneCode({
      phone,
      challenge_id: challenge.challenge_id,
      code,
      register_if_new: Boolean(capabilities?.registration_enabled && capabilities.phone_registration_enabled),
      agreement_revision: capabilities?.login_agreement_revision ?? '',
      ...(invitationCode.trim() ? { invitation_code: invitationCode.trim() } : {}),
      remember
    })

    if (result?.status === 'requires_2fa') {
      setTotpCode('')
      setSecondFactorReturn('code')
      changeStep('totp')
    }
  }

  const loginExisting = async () => {
    if (!email.trim() || !password || busy) {
      return
    }

    setRegistrationError(false)
    const result = await onLoginExisting({ email: email.trim(), password, remember })
    setPassword('')

    if (result?.status === 'requires_2fa') {
      setTotpCode('')
      setSecondFactorReturn('existing')
      changeStep('totp')
    }
  }

  const completeSecondFactor = async () => {
    const value = totpCode.replace(/\D/g, '')

    if (!value || busy) {
      return
    }

    setRegistrationError(false)
    await onCompleteSecondFactor(value)
  }

  const openRegistration = async () => {
    const url = capabilities?.registration_url

    if (!capabilities?.registration_enabled || !url || busy) {
      return
    }

    setOpeningRegistration(true)
    setRegistrationError(false)

    try {
      await window.hermesDesktop.openExternal(url)
      setRegistrationOpened(true)
      changeStep('existing')
    } catch {
      setRegistrationError(true)
    } finally {
      setOpeningRegistration(false)
    }
  }

  const visibleError = error && (!capabilities || error !== dismissedError) ? error : null

  const errorText = termsRequired
    ? copy.termsRequired
    : registrationError
      ? copy.registrationOpenFailed
      : visibleError
        ? copy.platformError(visibleError.code, visibleError.retryAfter)
        : null

  const documents = capabilities?.login_agreement_documents ?? []
  const activeDocument = legalDocument === null ? null : documents[legalDocument]

  const rememberControl = (
    <AccountRememberControl browserHosted={browserHosted} loading={busy} onChange={setRemember} remember={remember} />
  )

  return (
    <div className="aino-account-login" data-account-login-card="">
      <div aria-hidden="true" className="aino-account-chrome" />
      <div className="aino-account-body">
        <p className="aino-account-brand">AINO</p>
        <img alt="" className="aino-account-mark" height={96} src={accountLogo} width={96} />
        {step === 'phone' && (
          <form
            className="aino-account-form"
            onSubmit={event => {
              event.preventDefault()
              void requestCode()
            }}
          >
            <Input
              aria-label={copy.phoneLabel}
              autoComplete="tel"
              className="aino-account-input"
              disabled={busy}
              inputMode="tel"
              onChange={event => {
                dismissFeedback()
                setPhone(event.target.value)
              }}
              placeholder={copy.phonePlaceholder}
              value={phone}
            />
            {invitationRequired && (
              <Input
                aria-label={copy.invitationCodeLabel}
                autoComplete="off"
                className="aino-account-input aino-account-secondary-input"
                disabled={busy}
                onChange={event => {
                  dismissFeedback()
                  setInvitationCode(event.target.value)
                }}
                placeholder={copy.invitationCodePlaceholder}
                value={invitationCode}
              />
            )}
            <Button
              className="aino-account-submit"
              disabled={busy || !phoneEnabled || !phone.trim() || retrySeconds > 0}
              type="submit"
            >
              {loading && <Loader2 className="animate-spin" />}
              {retrySeconds > 0 ? copy.resendIn(retrySeconds) : copy.sendCode}
            </Button>
            {capabilities && !fixedCodeHint && phoneRegistrationEnabled && <AccountPhoneLoginHelp disabled={busy} />}
            {agreementRequired && (
              <div className="aino-account-terms">
                <Checkbox
                  aria-label={copy.termsLabel}
                  checked={acceptedTerms}
                  className="aino-account-checkbox"
                  disabled={busy}
                  onCheckedChange={value => {
                    setAcceptedTerms(value === true)
                    setTermsRequired(false)
                  }}
                />
                <span>
                  {copy.termsPrefix}{' '}
                  <Button onClick={() => setLegalDocument(0)} size="inline" type="button" variant="link">
                    {documents[0]?.title || copy.terms}
                  </Button>
                  {documents[1] && (
                    <>
                      {' '}
                      {copy.and}{' '}
                      <Button onClick={() => setLegalDocument(1)} size="inline" type="button" variant="link">
                        {documents[1].title || copy.privacy}
                      </Button>
                    </>
                  )}
                </span>
              </div>
            )}
            {rememberControl}
          </form>
        )}
        {step === 'code' && (
          <form
            className="aino-account-form"
            onSubmit={event => {
              event.preventDefault()
              void verifyCode()
            }}
          >
            <div className="aino-account-recipient">
              <p>{fixedCodeHint ? copy.developmentCodeFor : copy.codeSentTo}</p>
              <p>{phone}</p>
            </div>
            <Input
              aria-label={copy.codeLabel}
              autoComplete="one-time-code"
              className="aino-account-input aino-account-code"
              disabled={busy}
              inputMode="numeric"
              maxLength={codeLength}
              onChange={event => {
                dismissFeedback()
                setCode(event.target.value.replace(/\D/g, '').slice(0, codeLength))
              }}
              placeholder={copy.codePlaceholder}
              value={code}
            />
            <Button className="aino-account-submit" disabled={busy || code.length !== codeLength} type="submit">
              {loading && <Loader2 className="animate-spin" />}
              {copy.verify}
            </Button>
            <Button
              className="aino-account-resend"
              disabled={busy || retrySeconds > 0}
              onClick={() => void requestCode()}
              size="inline"
              type="button"
              variant="text"
            >
              {retrySeconds > 0 ? copy.resendIn(retrySeconds) : copy.resend}
            </Button>
            <Button
              className="aino-account-back"
              disabled={busy}
              onClick={() => changeStep('phone')}
              size="inline"
              type="button"
              variant="text"
            >
              {copy.back}
            </Button>
          </form>
        )}
        {step === 'existing' && (
          <form
            className="aino-account-form"
            onSubmit={event => {
              event.preventDefault()
              void loginExisting()
            }}
          >
            {registrationOpened && (
              <p className="mb-4 text-center text-xs text-(--ui-text-tertiary)" role="status">
                {copy.registrationReturnHint}
              </p>
            )}
            <Input
              aria-label={copy.emailLabel}
              autoComplete="username"
              className="aino-account-input"
              disabled={busy}
              onChange={event => {
                dismissFeedback()
                setEmail(event.target.value)
              }}
              placeholder={copy.emailPlaceholder}
              type="email"
              value={email}
            />
            <Input
              aria-label={copy.passwordLabel}
              autoComplete="current-password"
              className="aino-account-input aino-account-secondary-input"
              disabled={busy}
              onChange={event => {
                dismissFeedback()
                setPassword(event.target.value)
              }}
              placeholder={copy.passwordPlaceholder}
              type="password"
              value={password}
            />
            <Button className="aino-account-submit" disabled={busy || !email.trim() || !password} type="submit">
              {loading && <Loader2 className="animate-spin" />}
              {copy.continueExisting}
            </Button>
            {rememberControl}
            <Button
              className="aino-account-back"
              disabled={busy}
              onClick={() => changeStep('phone')}
              size="inline"
              type="button"
              variant="text"
            >
              {copy.back}
            </Button>
          </form>
        )}
        {step === 'totp' && (
          <form
            className="aino-account-form"
            onSubmit={event => {
              event.preventDefault()
              void completeSecondFactor()
            }}
          >
            <p className="aino-account-recipient">{copy.totpDescription}</p>
            <Input
              aria-label={copy.totpLabel}
              autoComplete="one-time-code"
              className="aino-account-input aino-account-code"
              disabled={busy}
              inputMode="numeric"
              maxLength={8}
              onChange={event => {
                dismissFeedback()
                setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 8))
              }}
              placeholder={copy.codePlaceholder}
              value={totpCode}
            />
            <Button className="aino-account-submit" disabled={busy || !totpCode} type="submit">
              {loading && <Loader2 className="animate-spin" />}
              {copy.completeSecondFactor}
            </Button>
            <Button
              className="aino-account-back"
              disabled={busy}
              onClick={() => changeStep(secondFactorReturn)}
              size="inline"
              type="button"
              variant="text"
            >
              {copy.back}
            </Button>
          </form>
        )}
        {step === 'wechat' && (
          <>
            <p className="aino-account-wechat-title">{copy.wechatTitle}</p>
            <div className="aino-account-wechat-unavailable" role="status">
              {copy.wechatUnavailable}
            </div>
            <Button
              className="aino-account-switch"
              disabled={busy}
              onClick={() => changeStep('phone')}
              size="inline"
              variant="text"
            >
              {copy.switchPhone}
            </Button>
          </>
        )}
        {(step === 'phone' || step === 'existing') && (
          <AccountLoginLinks
            disabled={busy}
            onExisting={() => changeStep('existing')}
            onRegistration={() => void openRegistration()}
            onWechat={() => changeStep('wechat')}
            phoneStep={step === 'phone'}
            registrationClosed={capabilities?.registration_enabled === false}
            registrationEnabled={Boolean(capabilities?.registration_enabled && capabilities.registration_url)}
            showRegistration={!fixedCodeHint && Boolean(capabilities)}
          />
        )}
        {errorText && (
          <p className="mt-4 text-center text-sm text-destructive" role="alert">
            {errorText}
          </p>
        )}
        {fixedCodeHint && <p className="mt-4 text-center text-xs text-(--ui-text-tertiary)">{copy.developmentHint}</p>}
      </div>
      <Dialog onOpenChange={open => !open && setLegalDocument(null)} open={activeDocument !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activeDocument?.title ?? copy.terms}</DialogTitle>
            <DialogDescription className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-left">
              {activeDocument?.content_md ?? copy.agreementUnavailable}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  )
}
