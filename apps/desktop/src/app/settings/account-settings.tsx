import { useStore } from '@nanostores/react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { Users } from '@/lib/icons'

import { useAccountActions } from '../account/account-context'

import { PlatformWallet } from './platform-billing/wallet-view'
import { ListRow, SectionHeading, SettingsContent, SettingsGroup } from './primitives'

export function AccountSettings() {
  const { t } = useI18n()
  const copy = t.settings.account
  const actions = useAccountActions()
  const state = useStore(actions.state)
  const account = state.account
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saved, setSaved] = useState(false)
  const hintId = useId()
  const trimmedName = nameDraft.trim()

  const validName =
    trimmedName.length > 0 && Array.from(trimmedName).length <= 32 && !/[\p{Cc}\p{Cs}]/u.test(trimmedName)

  const saveName = async () => {
    if (!validName || state.loading) {
      return
    }

    const result = await actions.updateProfile(trimmedName)

    if (result) {
      setEditing(false)
      setSaved(true)
    }
  }

  return (
    <SettingsContent>
      <div className="mx-auto w-full max-w-2xl pt-6">
        <SectionHeading icon={Users} title={copy.title} />
        <p className="mb-5 text-sm text-(--ui-text-tertiary)">{copy.signedInDescription}</p>
        {state.phase === 'offline' && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-(--aino-radius-control) bg-(--ui-bg-quaternary) px-3 py-2">
            <p className="text-sm text-(--ui-text-secondary)">{copy.offlineDescription}</p>
            <Button disabled={state.loading} onClick={() => void actions.retry()} size="sm" variant="ghost">
              {copy.refresh}
            </Button>
          </div>
        )}
        <SettingsGroup>
          <ListRow
            action={
              editing ? (
                <form
                  className="grid min-w-0 gap-2"
                  onSubmit={event => {
                    event.preventDefault()
                    void saveName()
                  }}
                >
                  <Input
                    aria-describedby={hintId}
                    aria-label={copy.displayNameLabel}
                    autoFocus
                    disabled={state.loading}
                    onChange={event => setNameDraft(event.target.value)}
                    value={nameDraft}
                  />
                  <p className="text-xs text-(--ui-text-secondary)" id={hintId}>
                    {copy.displayNameHint}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      disabled={state.loading}
                      onClick={() => setEditing(false)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t.common.cancel}
                    </Button>
                    <Button
                      disabled={state.loading || !validName || trimmedName === account?.display_name}
                      size="sm"
                      type="submit"
                    >
                      {state.loading ? t.common.saving : t.common.save}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex min-w-0 items-center gap-3">
                  <span className="min-w-0 break-words">{account?.display_name}</span>
                  <Button
                    disabled={state.loading}
                    onClick={() => {
                      setNameDraft(account?.display_name ?? '')
                      setSaved(false)
                      setEditing(true)
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {copy.editDisplayName}
                  </Button>
                </div>
              )
            }
            below={
              saved ? (
                <p className="mt-2 text-sm text-(--ui-text-secondary)" role="status">
                  {copy.displayNameSaved}
                </p>
              ) : undefined
            }
            title={copy.displayNameLabel}
          />
          {account?.phone_masked && (
            <ListRow action={<span className="break-all">{account.phone_masked}</span>} title={copy.phoneMaskedLabel} />
          )}
          {account?.email && (
            <ListRow action={<span className="break-all">{account.email}</span>} title={copy.emailVerifiedLabel} />
          )}
          <ListRow
            action={<span className="break-all font-mono text-xs">{account?.id}</span>}
            title={copy.accountIdLabel}
          />
        </SettingsGroup>
        <PlatformWallet />
        <div className="mt-6">
          <Button disabled={state.loading} onClick={() => void actions.logout()} variant="outline">
            {copy.signOut}
          </Button>
          {state.error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {copy.platformError(state.error.code, state.error.retryAfter)}
            </p>
          )}
        </div>
      </div>
    </SettingsContent>
  )
}
