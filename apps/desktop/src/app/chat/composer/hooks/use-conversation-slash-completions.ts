import type { ConversationCapabilities } from '@hermes/shared/gateway-events'
import { useEffect, useMemo, useState } from 'react'

import type { HermesGateway } from '@/hermes'
import { type CommandsCatalogLike, isDesktopSlashExtensionCommand } from '@/lib/desktop-slash-commands'
import { peekCachedSlashCompletion } from '@/lib/slash-completion-cache'
import type { ConversationOwner } from '@/store/conversation-owner'
import { requestGatewayForAgent } from '@/store/gateway'

import type { CompletionEntry } from './use-live-completion-adapter'
import { useSlashCompletions } from './use-slash-completions'

const commandName = (value: string) => value.trim().replace(/^\//, '').split(/\s/)[0].toLowerCase()

/** Catalog reads are explicitly scoped; they never prepare or activate a runtime. */
export function conversationCommandReader(
  owner: ConversationOwner,
  profile: string,
  readCommands: readonly string[],
  request = requestGatewayForAgent,
  initialSkills: readonly string[] = []
): Pick<HermesGateway, 'request'> {
  const readable = new Set(readCommands.map(commandName))
  const skills = new Set(initialSkills.filter(isDesktopSlashExtensionCommand).map(commandName))

  return {
    request: async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
      if (method === 'commands.catalog') {
        const result = await request<CommandsCatalogLike>(owner.connectionId, 'default', method, { ...params, profile })

        for (const name of Object.keys(result.skills ?? {})) {
          if (isDesktopSlashExtensionCommand(name)) {
            skills.add(commandName(name))
          }
        }

        const allowed = ([name]: [string, string]) => readable.has(commandName(name)) || skills.has(commandName(name))

        return {
          ...result,
          pairs: result.pairs?.filter(allowed),
          categories: result.categories?.map(section => ({ ...section, pairs: section.pairs.filter(allowed) }))
        } as T
      }

      if (method !== 'complete.slash') {
        throw new Error('Unsupported conversation discovery method')
      }
      const text = String(params?.text ?? '')
      const argumentsStage = /^\/\S+\s/.test(text)

      if (argumentsStage && (readable.has(commandName(text)) || !skills.has(commandName(text)))) {
        return { items: [] } as T
      }

      const result = await request<{ items?: CompletionEntry[]; replace_from?: number }>(
        owner.connectionId,
        'default',
        method,
        { ...params, profile }
      )

      const items = (result.items ?? []).filter(
        item =>
          argumentsStage ||
          (item.kind === 'skill' && isDesktopSlashExtensionCommand(item.text)) ||
          readable.has(commandName(item.text))
      )

      for (const item of items) {
        if (item.kind === 'skill') {
          skills.add(commandName(item.text))
        }
      }

      return { ...result, items } as T
    }
  }
}

export function useConversationSlashCompletions(
  owner: ConversationOwner,
  profile: string,
  generation: number,
  discovering = true
) {
  const sourceKey = JSON.stringify([owner.connectionId, owner.installId])
  const [snapshot, setSnapshot] = useState<{ source: string; value: ConversationCapabilities } | null>(null)
  const capabilities = snapshot?.source === sourceKey ? snapshot.value : null
  useEffect(() => {
    if (!discovering || capabilities) {
      return
    }
    let disposed = false
    void requestGatewayForAgent<ConversationCapabilities>(
      owner.connectionId,
      'default',
      'conversations.capabilities',
      {}
    )
      .then(value => {
        if (!disposed) {
          setSnapshot({ source: sourceKey, value })
        }
      })
      .catch(() => {
        if (!disposed) {
          setSnapshot(null)
        }
      })

    return () => {
      disposed = true
    }
  }, [sourceKey, discovering])
  const enabled = capabilities?.scoped_commands === true
  const cacheScope = JSON.stringify([owner.connectionId, owner.installId, owner.conversationId, profile, generation])

  const reader = useMemo(
    () =>
      enabled
        ? conversationCommandReader(
            owner,
            profile,
            capabilities.supported_read_commands ?? [],
            requestGatewayForAgent,
            Object.keys(peekCachedSlashCompletion<CommandsCatalogLike>('catalog', cacheScope)?.skills ?? {})
          )
        : null,
    [enabled, owner.connectionId, owner.installId, owner.conversationId, profile, generation, capabilities]
  )

  const completion = useSlashCompletions({
    gateway: reader,
    allowSessionNavigation: false,
    cacheScope
  })

  return { ...completion, enabled }
}
