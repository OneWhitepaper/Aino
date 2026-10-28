import type * as React from 'react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { ErrorBanner } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import type { MessagingEnvVarInfo, MessagingPlatformInfo, PairingUser, TelegramOnboardingApplyResponse } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { localizedMessagingPlatformName } from '@/i18n/messaging-platforms'
import { PRODUCT_NAME } from '@/lib/brand'
import { openExternalLink } from '@/lib/external-link'
import { ExternalLink, Save, Trash2 } from '@/lib/icons'

import { CREDENTIAL_CONTROL_CLASS } from '../settings/credential-key-ui'
import { credentialPreview } from '../settings/helpers'
import { ListRow } from '../settings/primitives'

import { AllowlistField } from './allowlist-field'
import { TelegramQrSetup } from './telegram-qr-setup'

const pairingKey = (user: PairingUser) => user.platform + ':' + user.user_id
const pairingLabel = (user: PairingUser) => user.user_name || user.user_id

const FIELD_COPY: Record<string, { advanced?: boolean }> = {
  TELEGRAM_PROXY: { advanced: true },
  DISCORD_REPLY_TO_MODE: { advanced: true },
  DISCORD_ALLOW_ALL_USERS: { advanced: true },
  DISCORD_HOME_CHANNEL: { advanced: true },
  DISCORD_HOME_CHANNEL_NAME: { advanced: true },
  BLUEBUBBLES_ALLOW_ALL_USERS: { advanced: true },
  MATTERMOST_ALLOW_ALL_USERS: { advanced: true },
  MATTERMOST_HOME_CHANNEL: { advanced: true },
  QQ_ALLOW_ALL_USERS: { advanced: true },
  QQBOT_HOME_CHANNEL: { advanced: true },
  QQBOT_HOME_CHANNEL_NAME: { advanced: true },
  WHATSAPP_ENABLED: { advanced: true },
  WHATSAPP_MODE: { advanced: true }
}

function fieldCopy(field: MessagingEnvVarInfo, m: Translations['messaging']) {
  const copy = FIELD_COPY[field.key] || {}
  const localized = m.fieldCopy[field.key] || {}

  return {
    label: localized.label || field.prompt || field.key,
    help: localized.help || field.description,
    placeholder: localized.placeholder || field.prompt,
    advanced: Boolean(copy.advanced || field.advanced)
  }
}

export function PlatformDetail({
  approved,
  approving,
  edits,
  onApprove,
  onClear,
  onEdit,
  onRevoke,
  onTelegramApplied,
  pending,
  platform,
  saving,
  scopeProfile
}: {
  approved: PairingUser[]
  approving: null | string
  edits: Record<string, string>
  onApprove: (user: PairingUser) => void
  onClear: (key: string) => void
  onEdit: (key: string, value: string) => void
  onRevoke: (user: PairingUser) => void
  onTelegramApplied: (result: TelegramOnboardingApplyResponse) => void
  pending: PairingUser[]
  platform: MessagingPlatformInfo
  saving: string | null
  scopeProfile: string | undefined
}) {
  const { t } = useI18n()
  const m = t.messaging
  const [showAdvanced, setShowAdvanced] = useState(false)
  const requiredFields = platform.env_vars.filter(field => field.required)
  const optionalFields = platform.env_vars.filter(field => !field.required && !fieldCopy(field, m).advanced)
  const advancedFields = platform.env_vars.filter(field => !field.required && fieldCopy(field, m).advanced)
  const hiddenCount = advancedFields.length

  return (
    <>
      <PlatformHint platform={platform} />

      {platform.error_message && <ErrorBanner>{platform.error_message}</ErrorBanner>}

      {/* Pending pairing requests. Rendered only when someone is actually
          waiting — an empty-state card here would be permanent chrome on a
          page that is usually about credentials, not approvals. */}
      {pending.length > 0 && (
        <section>
          <SectionTitle>{m.pendingRequests(pending.length)}</SectionTitle>
          <div className="mt-1 grid gap-1">
            {pending.map(user => {
              const busy = approving === pairingKey(user)
              const waited = typeof user.age_minutes === 'number' ? m.waitingSince(user.age_minutes) : null

              return (
                <ListRow
                  action={
                    <Button
                      disabled={busy || !user.request_id}
                      onClick={() => onApprove(user)}
                      size="sm"
                      variant="secondary"
                    >
                      {busy ? m.approving : m.approve}
                    </Button>
                  }
                  // An unnamed requester is only a user id — showing it as
                  // both title and description just repeats itself.
                  description={[user.user_name ? user.user_id : null, waited].filter(Boolean).join(' · ')}
                  key={pairingKey(user)}
                  title={pairingLabel(user)}
                  wide
                />
              )
            })}
          </div>
        </section>
      )}

      {approved.length > 0 && (
        <section>
          <SectionTitle>{m.approvedUsers(approved.length)}</SectionTitle>
          <div className="mt-1 grid gap-1">
            {approved.map(user => (
              <ListRow
                action={
                  <Button
                    aria-label={m.revokeAria(pairingLabel(user))}
                    onClick={() => onRevoke(user)}
                    size="sm"
                    variant="ghost"
                  >
                    {m.revoke}
                  </Button>
                }
                description={user.user_name ? user.user_id : undefined}
                key={pairingKey(user)}
                title={pairingLabel(user)}
                wide
              />
            ))}
          </div>
        </section>
      )}

      {platform.id === 'telegram' && (
        <section>
          <TelegramQrSetup onApplied={onTelegramApplied} platform={platform} scopeProfile={scopeProfile} />
        </section>
      )}

      <section>
        <SectionTitle>{m.getCredentials}</SectionTitle>
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {introCopy(platform, m)}
        </p>
        {platform.docs_url && (
          <div className="mt-3">
            <Button asChild size="sm" variant="textStrong">
              <a
                href={platform.docs_url}
                onClick={event => {
                  // Route through the validated external opener instead of
                  // letting Electron resolve the anchor. A packaged build's
                  // empty/relative href resolves to the app's own
                  // index.html file path, which shell.openPath then fails to
                  // open ("file not found"). Plugin platforms (Teams, etc.)
                  // ship no docs_url, so this guard + handler keeps the
                  // button from ever pointing at a local bundle path.
                  event.preventDefault()
                  openExternalLink(platform.docs_url)
                }}
                rel="noreferrer"
                target="_blank"
              >
                {m.openSetupGuide}
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
        )}
      </section>

      <section>
        <SectionTitle>{m.required}</SectionTitle>
        <div className="mt-3 grid gap-1">
          {requiredFields.length > 0 ? (
            requiredFields.map(field => (
              <MessagingField
                edits={edits}
                field={field}
                key={field.key}
                onClear={onClear}
                onEdit={onEdit}
                saving={saving}
              />
            ))
          ) : (
            <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
              {m.noTokenNeeded}
            </p>
          )}
        </div>
      </section>

      {optionalFields.length > 0 && (
        <section>
          <SectionTitle>{m.recommended}</SectionTitle>
          <div className="mt-3 grid gap-1">
            {optionalFields.map(field => (
              <MessagingField
                edits={edits}
                field={field}
                key={field.key}
                onClear={onClear}
                onEdit={onEdit}
                saving={saving}
              />
            ))}
          </div>
        </section>
      )}

      {hiddenCount > 0 && (
        <section>
          <button
            aria-expanded={showAdvanced}
            className="messaging-advanced-toggle"
            onClick={() => setShowAdvanced(value => !value)}
            type="button"
          >
            <span>{m.advanced(hiddenCount)}</span>
            <DisclosureCaret open={showAdvanced} size="0.875rem" />
          </button>
          {showAdvanced && (
            <div className="mt-3 grid gap-1">
              {advancedFields.map(field => (
                <MessagingField
                  edits={edits}
                  field={field}
                  key={field.key}
                  onClear={onClear}
                  onEdit={onEdit}
                  saving={saving}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  )
}

export function PlatformActionBar({
  hasEdits,
  onSave,
  onToggle,
  platform,
  saving
}: {
  hasEdits: boolean
  onSave: () => void
  onToggle: (enabled: boolean) => void
  platform: MessagingPlatformInfo
  saving: string | null
}) {
  const { locale, t } = useI18n()
  const m = t.messaging
  const name = localizedMessagingPlatformName(locale, platform.id, platform.name)
  const isSavingEnv = saving === `env:${platform.id}`

  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Switch
          aria-label={platform.enabled ? m.disableAria(name) : m.enableAria(name)}
          checked={platform.enabled}
          disabled={saving === `enabled:${platform.id}`}
          onCheckedChange={onToggle}
          size="xs"
        />
        {platform.enabled ? m.enabled : m.disabled}
      </label>

      <div className="messaging-save-actions ml-auto flex items-center gap-2">
        {hasEdits && <span className="text-xs text-muted-foreground">{m.unsavedChanges}</span>}
        <Button disabled={!hasEdits || isSavingEnv} onClick={onSave} size="sm">
          <Save />
          {isSavingEnv ? m.saving : m.saveChanges}
        </Button>
      </div>
    </>
  )
}

const PLATFORM_INTRO: Record<string, string> = {
  telegram:
    'In Telegram, talk to @BotFather, run /newbot, and copy the token it gives you. Then grab your numeric user ID from @userinfobot.',
  discord:
    'Open the Discord Developer Portal, create an application, add a Bot, then copy its token. Invite the bot to your server with the right scopes.',
  slack:
    'Create a Slack app, enable Socket Mode, install it to your workspace, then copy the bot token and app-level token.',
  mattermost:
    'On your Mattermost server, create a bot account or personal access token, then paste the server URL and token here.',
  matrix: 'Sign in to your homeserver with the bot account, then copy the access token, user ID, and homeserver URL.',
  signal: `Run a signal-cli REST bridge somewhere reachable, then point ${PRODUCT_NAME} at the URL and the registered phone number.`,
  whatsapp: `Start the WhatsApp bridge that ships with ${PRODUCT_NAME}, scan the QR code on first run, then enable the platform.`,
  bluebubbles: `Run BlueBubbles Server on a Mac with iMessage, expose its API, then point ${PRODUCT_NAME} at the URL with the server password.`,
  homeassistant:
    'In Home Assistant, open your profile and create a long-lived access token. Paste it here along with your HA URL.',
  email:
    'Use a dedicated mailbox. For Gmail/Workspace, create an app password and use imap.gmail.com / smtp.gmail.com.',
  sms: 'Get your Twilio Account SID and Auth Token from the Twilio console, plus a phone number that can send SMS.',
  dingtalk: 'Create a DingTalk app in the developer console, then copy the Client ID (App key) and Client Secret here.',
  feishu:
    'Create a Feishu / Lark app, configure the bot capability, and copy the App ID, App secret, and event encryption keys.',
  wecom:
    'Add a group robot in WeCom and copy its webhook key as WECOM_BOT_ID. Send-only — use the WeCom (app) option for two-way.',
  wecom_callback:
    'Set up a WeCom self-built app, expose its callback URL, and provide the corp ID, secret, agent ID, and AES key.',
  weixin: `Run \`hermes gateway setup\`, select Weixin, then scan and confirm the QR code with a personal WeChat account. ${PRODUCT_NAME} connects through Tencent's iLink Bot API and saves the credentials.`,
  qqbot: 'Register an app on the QQ Open Platform (q.qq.com) and copy the App ID and Client Secret.',
  api_server: `Expose ${PRODUCT_NAME} as an OpenAI-compatible API. Set an auth key, then point Open WebUI / LobeChat / etc. at the host:port.`,
  webhook:
    'Run an HTTP server that other tools (GitHub, GitLab, custom apps) can POST to. Use the secret to verify signatures.'
}

const introCopy = (platform: MessagingPlatformInfo, m: Translations['messaging']) =>
  m.platformIntro[platform.id] || PLATFORM_INTRO[platform.id] || platform.description

function MessagingField({
  edits,
  field,
  onClear,
  onEdit,
  saving
}: {
  edits: Record<string, string>
  field: MessagingEnvVarInfo
  onClear: (key: string) => void
  onEdit: (key: string, value: string) => void
  saving: string | null
}) {
  const { t } = useI18n()
  const m = t.messaging
  const copy = fieldCopy(field, m)
  const fieldId = `messaging-field-${field.key}`

  const tools = (
    <>
      {field.url && (
        <Tip label={m.openDocs}>
          <Button asChild className="size-8 shrink-0" variant="ghost">
            <a href={field.url} rel="noreferrer" target="_blank">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </Tip>
      )}
      {/* A list clears by removing its last entry and saving; a second trash icon would read as "remove row". */}
      {field.is_set && !field.is_list && (
        <Tip label={m.clearField(field.key)}>
          <Button
            className="size-8 shrink-0"
            disabled={saving === `clear:${field.key}`}
            onClick={() => onClear(field.key)}
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </Tip>
      )}
    </>
  )

  return (
    <div className="messaging-field">
      <div className="messaging-field-label">
        <label htmlFor={fieldId}>{copy.label}</label>
        {field.required && (
          <span aria-hidden="true" className="messaging-field-required">
            *
          </span>
        )}
        {field.is_set && <span className="messaging-field-saved">{m.saved}</span>}
      </div>
      {field.is_list ? (
        <AllowlistField
          field={field}
          fieldId={fieldId}
          label={copy.label}
          onEdit={onEdit}
          pending={edits[field.key]}
          tools={tools}
        />
      ) : (
        <div className="messaging-field-input">
          <Input
            className={CREDENTIAL_CONTROL_CLASS}
            id={fieldId}
            onChange={event => onEdit(field.key, event.target.value)}
            placeholder={field.is_set ? credentialPreview(field.redacted_value) || m.replaceValue : copy.placeholder}
            type={field.is_password ? 'password' : 'text'}
            value={edits[field.key] || ''}
          />
          <span className="messaging-field-tools">{tools}</span>
        </div>
      )}
      {copy.help && <p className="messaging-field-help">{copy.help}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</h4>
}

function PlatformHint({ platform }: { platform: MessagingPlatformInfo }) {
  const { t } = useI18n()

  // A served secondary's api_server/webhook live on the shared gateway listener under
  // /p/<profile>/: the state pill says connected, this line says where to point the client.
  if (platform.ingress_url) {
    return (
      <p className="mt-2 text-xs leading-5 text-muted-foreground break-all">
        {t.messaging.sharedListenerUrl}{' '}
        <code className="font-mono text-foreground" data-slot="ingress-url">
          {platform.ingress_url}
        </code>
      </p>
    )
  }

  if (!platform.enabled || platform.state === 'connected') {
    return null
  }

  const hint =
    platform.state === 'pending_restart'
      ? t.messaging.hintPendingRestart
      : platform.gateway_running
        ? null
        : t.messaging.hintGatewayStopped

  return hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null
}
