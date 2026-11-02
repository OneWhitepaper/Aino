import './tool-panel.css'

import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import type { ContextSuggestion } from '@/app/types'
import { $newSessionTabAction, restoreTreePane } from '@/components/pane-shell/tree/store'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { SearchField } from '@/components/ui/search-field'
import { useI18n } from '@/i18n'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { requestGatewayForAgent } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $visiblePreviewTabs, openPreview } from '@/store/preview'
import { $toolSession, $toolWorkspaceCwd, toolSessionIsCurrent } from '@/store/tool-session'

import { openToolPanelResource } from './tool-panel-actions'

export function ToolPanelChooser() {
  const { t } = useI18n()
  const copy = t.toolPanel
  const cwd = useStore($toolWorkspaceCwd)
  const session = useStore($toolSession)
  const tabs = useStore($visiblePreviewTabs)
  const auxiliaryChat = useStore($newSessionTabAction)
  const [query, setQuery] = useState('')

  const [resultState, setResultState] = useState<{ owner: string; items: ContextSuggestion[] }>({
    owner: '',
    items: []
  })

  const [loading, setLoading] = useState(false)
  const fileIntent = useRef(0)
  const owner = JSON.stringify([session.sourceKey, session.scope, session.storedId, cwd, query])
  const results = resultState.owner === owner ? resultState.items : []

  useEffect(() => {
    if (!cwd || !query.trim()) {
      setResultState({ owner, items: [] })
      setLoading(false)

      return
    }

    let current = true

    const timer = window.setTimeout(() => {
      setLoading(true)
      void requestGatewayForAgent<{ items?: ContextSuggestion[] }>(
        session.scope.connectionId,
        session.scope.profile,
        'complete.path',
        {
          word: `@file:${query}`,
          cwd,
          ...(session.runtimeId ? { session_id: session.runtimeId } : {})
        }
      )
        .then(result => {
          if (current && toolSessionIsCurrent(session)) {
            setResultState({ owner, items: (result.items ?? []).filter(item => !item.text.endsWith('/')) })
          }
        })
        .catch(() => {
          if (current) {
            setResultState({ owner, items: [] })
          }
        })
        .finally(() => {
          if (current) {
            setLoading(false)
          }
        })
    }, 150)

    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [cwd, owner, query, session])

  const openFile = async (path: string) => {
    const intent = ++fileIntent.current

    if (!toolSessionIsCurrent(session)) {
      return
    }

    try {
      const target = await normalizeOrLocalPreviewTarget(path, cwd || undefined)

      if (target && intent === fileIntent.current && toolSessionIsCurrent(session)) {
        openPreview(target, session.storedId, session.runtimeId, session.scope.profile)
      }
    } catch (error) {
      if (toolSessionIsCurrent(session)) {
        notifyError(error, t.rightSidebar.previewUnavailable)
      }
    }
  }

  const tools = [
    { id: 'files', icon: 'folder-opened', label: t.sidebar.files, description: copy.filesDescription },
    { id: 'browser', icon: 'globe', label: t.preview.browserTab, description: copy.browserDescription },
    { id: 'terminal', icon: 'terminal', label: t.sidebar.terminal, description: copy.terminalDescription },
    { id: 'review', icon: 'git-pull-request', label: t.sidebar.review, description: copy.reviewDescription }
  ] as const

  const recent = tabs
    .filter(tab => tab.target.kind === 'file')
    .slice(-5)
    .reverse()

  return (
    <div className="aino-tool-chooser" data-tool-chooser="">
      <h2>{t.zones.newTab}</h2>
      <p>{copy.description}</p>
      <div className="aino-tool-choices">
        {tools.map(tool => (
          <Button
            aria-label={tool.label}
            className="aino-tool-choice"
            key={tool.id}
            onClick={() => openToolPanelResource(tool.id)}
            variant="outline"
          >
            <Codicon name={tool.icon} size="1.25rem" />
            <span>
              <strong>{tool.label}</strong>
              <small>{tool.description}</small>
            </span>
          </Button>
        ))}
      </div>
      {cwd && (
        <SearchField
          containerClassName="mt-6 w-full"
          loading={loading}
          onChange={setQuery}
          placeholder={copy.search}
          value={query}
          variant="box"
        />
      )}
      {query ? (
        <div className="aino-tool-file-list">
          {results.length === 0 && !loading && <p>{copy.noMatches}</p>}
          {results.map(result => {
            const path = result.text.replace(/^@(?:file|folder):/, '').replace(/^"|"$/g, '')

            return (
              <Button
                className="aino-tool-recent"
                key={result.text}
                onClick={() => void openFile(path)}
                variant="ghost"
              >
                <FileTypeIcon path={path} />
                <span>{result.display || path}</span>
              </Button>
            )
          })}
        </div>
      ) : (
        recent.length > 0 && (
          <>
            <h3>{copy.recent}</h3>
            {recent.map(tab => (
              <Button
                className="aino-tool-recent"
                key={tab.id}
                onClick={() => restoreTreePane(`preview-tile:${tab.id}`)}
                variant="ghost"
              >
                <FileTypeIcon path={tab.target.path || tab.target.source} />
                <span>{tab.target.label}</span>
              </Button>
            ))}
          </>
        )
      )}
      {auxiliaryChat && (
        <>
          <h3>{copy.collaboration}</h3>
          <Button onClick={auxiliaryChat} variant="ghost">
            <Codicon name="comment-discussion" />
            {copy.auxiliaryChat}
            <Codicon name="arrow-up-right" />
          </Button>
        </>
      )}
      {cwd && (
        <p className="aino-tool-project">
          <Codicon name="folder" />
          {copy.project}: <span>{cwd.split(/[/\\]/).filter(Boolean).at(-1)}</span>
        </p>
      )}
    </div>
  )
}
