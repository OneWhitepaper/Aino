import { useI18n } from '@/i18n'
import type { ConnectionTarget } from '@/store/connection-request'

/** The backend's non-secret configuration is the exact proposal the row approves. */
export function McpSetupReview({ target }: { target: ConnectionTarget }) {
  const { t } = useI18n()
  const config = target.mcpConfig

  if (!config) {
    return null
  }

  const copy = t.connectorsPage.add

  const rows = [
    { label: copy.name, value: target.name },
    ...(config.url ? [{ label: copy.url, value: config.url }] : []),
    ...(config.command ? [{ label: copy.command, value: config.command }] : []),
    ...(config.args ? [{ label: copy.args, value: JSON.stringify(config.args) }] : []),
    { label: copy.auth, value: config.auth === 'oauth' ? copy.authOauth : copy.authNone },
    ...(config.transport ? [{ label: copy.type, value: config.transport }] : [])
  ]

  return (
    <div
      className="mb-2 ml-6.5 grid min-w-0 gap-2 text-[length:var(--aino-text-caption)]"
      data-mcp-review={target.name}
    >
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(row => (
          <div className="contents" key={row.label}>
            <dt className="text-(--ui-text-tertiary)">{row.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-(--ui-text-secondary)">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {config.command ? <p className="text-(--ui-text-tertiary)">{t.settings.mcp.deepLinkStdioWarning}</p> : null}
      <details className="min-w-0 text-(--ui-text-tertiary)">
        <summary className="cursor-pointer">{t.settings.mcp.serverJson}</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono">{JSON.stringify(config, null, 2)}</pre>
      </details>
    </div>
  )
}
