import { useState } from 'react'

import { ApprovalBarSurface } from '@/components/assistant-ui/tool/approval'
import {
  SecretPromptSurface,
  SudoPromptSurface,
  VaultCodePromptSurface,
  VaultSaveLoginPromptSurface,
  VaultUnlockPromptSurface
} from '@/components/prompt-overlays'

import { ConversationClarify, type ConversationRequestProps } from './conversation-clarify'
import { ConversationMcpSetup } from './conversation-mcp-setup'
import { requireConversationRuntime } from './conversation-runtime-controls'

export function ConversationPendingRequest(props: ConversationRequestProps) {
  if (props.request.method === 'approval') {
    return (
      <ApprovalBarSurface
        onRespond={choice => props.respond(props.request.id, { choice })}
        request={{
          command: String(props.request.params.command ?? ''),
          description: String(props.request.params.description ?? ''),
          choices: Array.isArray(props.request.params.choices)
            ? props.request.params.choices.map(String)
            : ['once', 'deny'],
          allowPermanent: props.request.params.allow_permanent === true
        }}
      />
    )
  }

  if (props.request.method === 'clarify') {
    return <ConversationClarify {...props} />
  }

  if (props.request.method === 'mcp.setup') {
    return <ConversationMcpSetup {...props} />
  }

  return (
    <ConversationCredentialRequest
      key={JSON.stringify([props.owner, props.request.id, props.request.coordinates])}
      {...props}
    />
  )
}

const credentialSurfaces = {
  sudo: SudoPromptSurface,
  secret: SecretPromptSurface,
  'vault.unlock_prompt': VaultUnlockPromptSurface,
  'vault.save_login': VaultSaveLoginPromptSurface,
  'vault.code': VaultCodePromptSurface
}

function ConversationCredentialRequest({ owner, request, respond }: ConversationRequestProps) {
  const [answered, setAnswered] = useState(false)
  const Surface = credentialSurfaces[request.method as keyof typeof credentialSurfaces]

  if (!Surface || answered) {
    return null
  }
  const params = request.params

  return (
    <Surface
      onAnswered={() => setAnswered(true)}
      onRespond={value => {
        requireConversationRuntime(owner, request.coordinates)

        return respond(request.id, { value })
      }}
      owned
      request={{
        requestId: request.id,
        sessionId: request.coordinates.runtime_id,
        envVar: String(params.env_var ?? ''),
        prompt: String(params.prompt ?? ''),
        backend: String(params.backend ?? ''),
        displayName: String(params.display_name ?? params.backend ?? ''),
        site: String(params.site ?? ''),
        origin: String(params.origin ?? ''),
        hint: String(params.hint ?? '')
      }}
    />
  )
}
