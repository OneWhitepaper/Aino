import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  addMcpServer,
  getActionStatus,
  getMcpCatalog,
  installMcpCatalogEntry,
  type McpCatalogEntry,
  removeMcpServer,
  setMcpServerEnabled
} from '@/hermes'
import { useI18n } from '@/i18n'
import { completeMcpDesktopOAuth, McpOAuthCancelled } from '@/lib/mcp-dashboard-oauth'
import { directoryEntry } from '@/lib/mcp-directory'
import type { McpSetupOutcome } from '@/store/mcp-setup'

import type { ConversationRequestProps } from './conversation-clarify'
import { requireConversationRuntime } from './conversation-runtime-controls'

/** Existing MCP install/OAuth APIs, explicitly scoped to the participant who requested consent. */
export function ConversationMcpSetup({ owner, request, respond }: ConversationRequestProps) {
  const { t } = useI18n()
  const copy = t.assistant.mcpSetup
  const server = String(request.params.server ?? '')
  const action = String(request.params.action ?? 'install')
  const [entry, setEntry] = useState<McpCatalogEntry | null>()
  const [env, setEnv] = useState<Record<string, string>>({})
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  const completed = useRef(false)
  useEffect(
    () => () => {
      cancelled.current = true
    },
    []
  )

  const scope = useCallback(() => {
    const { binding } = requireConversationRuntime(owner, request.coordinates)

    return { connectionId: owner.connectionId, profile: binding.participant.profile }
  }, [owner, request.coordinates])

  useEffect(() => {
    if (action !== 'install') {
      return
    }

    let disposed = false
    void Promise.resolve()
      .then(() => getMcpCatalog(scope()))
      .then(result => {
        if (!disposed) {
          setEntry(result.entries.find(item => item.name === server) ?? null)
        }
      })
      .catch(reason => {
        if (!disposed) {
          setError(String(reason instanceof Error ? reason.message : reason))
        }
      })

    return () => {
      disposed = true
    }
  }, [request.id, action, scope, server])

  const finish = (outcome: McpSetupOutcome) => {
    if (completed.current) {
      return
    }

    respond(request.id, { value: JSON.stringify(outcome) })
    completed.current = true
    setEnv({})
  }

  const decline = () => {
    try {
      finish({ server, status: 'declined' })
      cancelled.current = true
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason))
    }
  }

  const approve = async () => {
    cancelled.current = false
    setWorking(true)
    setError(null)

    try {
      const captured = scope()

      const check = () => {
        if (cancelled.current) {
          throw new McpOAuthCancelled()
        }
      }

      let outcome: McpSetupOutcome

      if (action === 'enable') {
        const result = await setMcpServerEnabled(server, true, captured)

        if (!result.ok) {
          throw new Error(copy.failed(server))
        }

        outcome = { server, status: 'enabled' }
      } else if (action === 'authorize') {
        const result = await completeMcpDesktopOAuth({
          serverName: server,
          profile: captured,
          cancelled: () => cancelled.current
        })

        if (result.status !== 'approved') {
          throw new Error(result.error || copy.failed(server))
        }

        outcome = { server, status: 'authorized', tools: result.tools?.map(tool => tool.name) }
      } else if (entry) {
        const result = await installMcpCatalogEntry(server, env, captured)

        if (!result.ok) {
          throw new Error(copy.failed(server))
        }

        if (result.background && result.action) {
          const deadline = Date.now() + 10 * 60_000

          for (;;) {
            check()

            if (Date.now() > deadline) {
              throw new Error(copy.failed(server))
            }

            const state = await getActionStatus(result.action, 1, captured)
            check()

            if (!state.running) {
              if (state.exit_code !== 0) {
                throw new Error(copy.failed(server))
              }

              break
            }

            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }

        outcome = { server, status: 'installed' }
      } else {
        const known = directoryEntry(server)

        if (!known) {
          throw new Error(copy.notInCatalog(server))
        }

        await addMcpServer({ name: known.name, url: known.url }, captured)

        try {
          const result = await completeMcpDesktopOAuth({
            serverName: server,
            profile: captured,
            cancelled: () => cancelled.current
          })

          if (result.status !== 'approved') {
            throw new Error(result.error || copy.failed(server))
          }

          outcome = { server, status: 'installed', tools: result.tools?.map(tool => tool.name) }
        } catch (reason) {
          await removeMcpServer(server, captured)
          throw reason
        }
      }

      check()

      // Configuration changes apply to a new participant generation; this running tool schema stays pinned.
      outcome.detail = t.composer.conversation.mcpDeferred
      check()
      finish(outcome)
    } catch (reason) {
      if (!(reason instanceof McpOAuthCancelled)) {
        const detail = reason instanceof Error ? reason.message : String(reason)
        setError(detail)

        try {
          finish({ server, status: 'error', detail })
        } catch (responseError) {
          setError(responseError instanceof Error ? responseError.message : String(responseError))
        }
      }
    } finally {
      setWorking(false)
    }
  }

  const missing = entry?.required_env.some(item => item.required && !env[item.name]?.trim())

  const label =
    action === 'enable' ? copy.enableAction : action === 'authorize' ? copy.authorizeAction : copy.installAction

  return (
    <section className="space-y-3">
      <strong>{server}</strong>
      <p className="text-sm">{t.composer.conversation.mcpDeferred}</p>
      <p>{String(request.params.reason ?? '')}</p>
      {entry && (
        <p className="break-words text-sm">
          {entry.description} · {entry.url || entry.command || entry.source}
        </p>
      )}
      {entry?.required_env.map(item => (
        <label className="block" key={item.name}>
          {item.prompt}
          <Input
            disabled={working}
            onChange={event => setEnv(current => ({ ...current, [item.name]: event.target.value }))}
            type="password"
            value={env[item.name] ?? ''}
          />
        </label>
      ))}
      <div className="flex gap-2">
        <Button
          disabled={working || missing || (action === 'install' && entry === undefined)}
          onClick={() => void approve()}
        >
          {label}
        </Button>
        <Button onClick={decline} variant="outline">
          {copy.decline}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
