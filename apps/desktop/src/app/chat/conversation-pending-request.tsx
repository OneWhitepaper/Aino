import { ApprovalBarSurface } from '@/components/assistant-ui/tool/approval'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'

import { ConversationClarify, type ConversationRequestProps } from './conversation-clarify'
import { ConversationMcpSetup } from './conversation-mcp-setup'

export function ConversationPendingRequest(props: ConversationRequestProps) {
  if (props.request.method === 'approval')
    return (
      <ApprovalBarSurface
        request={{
          command: String(props.request.params.command ?? ''),
          description: String(props.request.params.description ?? ''),
          choices: Array.isArray(props.request.params.choices)
            ? props.request.params.choices.map(String)
            : ['once', 'deny'],
          allowPermanent: props.request.params.allow_permanent === true
        }}
        onRespond={choice => props.respond(props.request.id, { choice })}
      />
    )

  if (props.request.method === 'clarify') {
    return <ConversationClarify {...props} />
  }

  if (props.request.method === 'mcp.setup') {
    return <ConversationMcpSetup {...props} />
  }

  return <CredentialOrApproval {...props} />
}

function CredentialOrApproval({ request, respond }: ConversationRequestProps) {
  const { t } = useI18n()
  const copy = t.composer.conversation
  const [value, setValue] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [error, setError] = useState<string | null>(null)
  const params = request.params

  const answer = (result: Record<string, unknown>) => {
    try {
      respond(request.id, result)
      setValue('')
      setIdentifier('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const saveLogin = request.method === 'vault.save_login'
  const code = request.method === 'vault.code'

  const titles: Record<string, string> = {
    sudo: t.prompts.sudoTitle,
    secret: t.prompts.secretTitle,
    'vault.code': t.prompts.vaultCodeTitle(String(params.site ?? '')),
    'vault.save_login': t.prompts.vaultSaveTitle(String(params.site ?? params.origin ?? '')),
    'vault.unlock_prompt': t.prompts.vaultUnlockTitle(String(params.display_name ?? params.backend ?? ''))
  }

  const prompt = [params.question, params.command, params.prompt, params.description].find(
    item => typeof item === 'string'
  )

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <strong>{titles[request.method]}</strong>
      {typeof prompt === 'string' && <p className="whitespace-pre-wrap break-words">{prompt}</p>}
      {typeof params.env_var === 'string' && <p>{params.env_var}</p>}
      {typeof params.origin === 'string' && <p>{params.origin}</p>}
      {typeof params.hint === 'string' && <p>{params.hint}</p>}
      <form
        className="space-y-2"
        onSubmit={event => {
          event.preventDefault()
          answer({ value: saveLogin ? JSON.stringify({ identifier: identifier.trim(), password: value }) : value })
        }}
      >
        {saveLogin && (
          <Input
            aria-label={t.prompts.vaultSaveIdentifierLabel}
            autoComplete="username"
            onChange={event => setIdentifier(event.target.value)}
            value={identifier}
          />
        )}
        <Input
          aria-label={code ? t.prompts.vaultCodeLabel : copy.answer}
          autoComplete={code ? 'one-time-code' : 'off'}
          onChange={event => setValue(event.target.value)}
          type={code ? 'text' : 'password'}
          value={value}
        />
        <div className="flex gap-2">
          <Button disabled={!value || (saveLogin && !identifier.trim())} type="submit">
            {t.composer.send}
          </Button>
          <Button onClick={() => answer({ value: '' })} type="button" variant="outline">
            {t.common.cancel}
          </Button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
