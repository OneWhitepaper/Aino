import './account-settings.css'

import { useStore } from '@nanostores/react'
import { useId, useState } from 'react'

import { AvatarChip } from '@/components/ui/avatar-chip'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
import { CheckCircle2, LogIn, Pencil, Users } from '@/lib/icons'

import { useAccountActions } from '../account/account-context'

import { PlatformWallet } from './platform-billing/wallet-view'
import { SectionHeading, SettingsContent, SettingsGroup } from './primitives'

export function AccountSettings() {
  const { t } = useI18n()
  const copy = t.settings.account
  const actions = useAccountActions()
  const state = useStore(actions.state)

  return (
    <SettingsContent>
      <div className="account-settings-page" data-settings-account="">
        <header className="account-page-intro">
          <SectionHeading icon={Users} page title={copy.title} />
          <p>{t.accountPage.description}</p>
        </header>
        {state.phase === 'offline' && (
          <div className="account-offline-notice" role="status">
            <p>{copy.offlineDescription}</p>
            <Button disabled={state.loading} onClick={() => void actions.retry()} size="sm" variant="ghost">
              {copy.refresh}
            </Button>
          </div>
        )}
        <AccountProfile key={`profile:${state.account?.id}`} />
        <PlatformWallet />
        <AccountFooter key={`footer:${state.account?.id}`} />
      </div>
    </SettingsContent>
  )
}

function AccountProfile() {
  const { t } = useI18n()
  const copy = t.settings.account
  const actions = useAccountActions()
  const state = useStore(actions.state)
  const account = state.account
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const label = account?.display_name || copy.title

  return (
    <>
      <SettingsGroup aria-label={copy.title} className="account-profile-card">
        <div className="account-profile-header">
          <AvatarChip aria-hidden className="account-profile-avatar" name={label}>
            {Array.from(label)[0]?.toLocaleUpperCase()}
          </AvatarChip>
          <div className="account-profile-identity">
            <h2>{label}</h2>
            <p>{t.accountPage.profileDescription}</p>
          </div>
          <Button
            disabled={state.loading}
            onClick={() => {
              setSaved(false)
              setEditing(true)
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Pencil />
            {copy.editDisplayName}
          </Button>
        </div>
        <dl className="account-profile-details">
          {account?.phone_masked && (
            <div>
              <dt>{copy.phoneMaskedLabel}</dt>
              <dd className="tabular-nums">{account.phone_masked}</dd>
            </div>
          )}
          {account?.email && (
            <div>
              <dt>
                {copy.emailVerifiedLabel}
                <CheckCircle2 aria-hidden />
              </dt>
              <dd>{account.email}</dd>
            </div>
          )}
          <div>
            <dt>{copy.accountIdLabel}</dt>
            <dd className="tabular-nums">{account?.id}</dd>
          </div>
        </dl>
      </SettingsGroup>
      {saved && (
        <p className="account-profile-saved" role="status">
          {copy.displayNameSaved}
        </p>
      )}
      {editing && (
        <AccountNameDialog
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            setSaved(true)
          }}
        />
      )}
    </>
  )
}

function AccountNameDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const copy = t.settings.account
  const actions = useAccountActions()
  const state = useStore(actions.state)
  const [nameDraft, setNameDraft] = useState(state.account?.display_name ?? '')
  const [attempted, setAttempted] = useState(false)
  const hintId = useId()
  const trimmedName = nameDraft.trim()

  const validName =
    trimmedName.length > 0 && Array.from(trimmedName).length <= 32 && !/[\p{Cc}\p{Cs}]/u.test(trimmedName)

  const saveName = async () => {
    if (!validName || state.loading || trimmedName === state.account?.display_name) {
      return
    }

    setAttempted(true)
    const result = await actions.updateProfile(trimmedName)

    if (result) {
      onSaved()
    }
  }

  return (
    <Dialog onOpenChange={open => !open && !state.loading && onClose()} open>
      <DialogContent className="account-name-dialog">
        <DialogHeader>
          <DialogTitle>{copy.editDisplayName}</DialogTitle>
          <DialogDescription>{t.accountPage.editNameDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="account-name-form"
          onSubmit={event => {
            event.preventDefault()
            void saveName()
          }}
        >
          <label className="account-name-field">
            <span>{copy.displayNameLabel}</span>
            <Input
              aria-describedby={hintId}
              autoFocus
              disabled={state.loading}
              onChange={event => setNameDraft(event.target.value)}
              value={nameDraft}
            />
          </label>
          <p className="account-name-hint" id={hintId}>
            {copy.displayNameHint}
          </p>
          {attempted && state.error && (
            <p className="account-inline-error" role="alert">
              {copy.platformError(state.error.code, state.error.retryAfter)}
            </p>
          )}
          <DialogFooter>
            <Button disabled={state.loading} onClick={onClose} type="button" variant="outline">
              {t.common.cancel}
            </Button>
            <Button disabled={state.loading || !validName || trimmedName === state.account?.display_name} type="submit">
              {state.loading ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AccountFooter() {
  const { t } = useI18n()
  const actions = useAccountActions()
  const state = useStore(actions.state)
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <footer className="account-page-footer">
        <p>{t.accountPage.serviceDescription}</p>
        <Button disabled={state.loading} onClick={() => setConfirming(true)} size="sm" variant="ghost">
          <LogIn className="rotate-180" />
          {t.settings.account.signOut}
        </Button>
      </footer>
      {state.error && state.phase !== 'offline' && !confirming && (
        <p className="account-inline-error" role="alert">
          {t.settings.account.platformError(state.error.code, state.error.retryAfter)}
        </p>
      )}
      <ConfirmDialog
        confirmLabel={t.settings.account.signOut}
        description={t.accountPage.signOutDescription}
        destructive
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          const result = await actions.logout()

          if (!result) {
            const error = actions.state.get().error
            throw new Error(t.settings.account.platformError(error?.code ?? 'platform_error', error?.retryAfter))
          }
        }}
        open={confirming}
        title={t.accountPage.signOutTitle}
      />
    </>
  )
}
