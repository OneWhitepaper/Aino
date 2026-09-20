import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { hermesApi } from '@/api/client'
import { TreeSkeleton } from '@/components/chat/skeletons'
import { Button } from '@/components/ui/button'
import type { HermesReadDirResult } from '@/global'
import { useI18n } from '@/i18n'
import type { ConversationOwner } from '@/store/conversation-owner'
import { type OpenSharedProject, sharedOpenKey, sharedProjectWindow } from '@/store/shared-project-windows'
import { projectSourceKey } from '@/store/shared-projects'

import { SharedProjectPreview } from './shared-project-preview'
import { ProjectTree } from './tree'
import type { TreeNode } from './use-project-tree'

/** Only the requester is source-specific; rows and interactions reuse the existing browser. */
function SharedDirectory({ entry, onFile }: { entry: OpenSharedProject; onFile: (path: string) => void }) {
  const copy = useI18n().t.sharedProjects
  const [directories, setDirectories] = useState<Record<string, HermesReadDirResult>>({})
  const [openState, setOpenState] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<{ path: string; message: string } | null>(null)
  const live = useRef(true)

  const load = useCallback(
    async (path: string) => {
      const source = entry.source

      if (!source || entry.project.environment_id !== 'local') {
        setError({ path, message: copy.unsupported })

        return
      }

      try {
        const result = await hermesApi<HermesReadDirResult>({
          connectionId: entry.connectionId,
          profile: source.registration_profile,
          path: `/api/fs/list?path=${encodeURIComponent(path)}`
        })

        if (!live.current) {
          return
        }

        if (result.error) {
          throw new Error(result.error)
        }
        setError(null)
        setDirectories(previous => ({ ...previous, [path]: result }))
      } catch (reason) {
        if (live.current) {
          setError({ path, message: reason instanceof Error ? reason.message : String(reason) })
        }
      }
    },
    [entry, copy.unsupported]
  )

  // eslint-disable-next-line no-restricted-syntax -- lifecycle cancellation flag, not a mirrored reactive value
  useEffect(() => {
    live.current = true
    void load(entry.project.canonical_path)

    return () => {
      live.current = false
    }
  }, [entry.project.canonical_path, load])

  function nodes(path: string): TreeNode[] | undefined {
    return directories[path]?.entries.map(item => ({
      id: item.path,
      name: item.name,
      isDirectory: item.isDirectory,
      children: item.isDirectory ? nodes(item.path) : undefined
    }))
  }

  const data = nodes(entry.project.canonical_path)

  return (
    <div aria-label={entry.project.canonical_path} className="flex h-64 min-h-0 flex-col">
      {error && (
        <div role="alert">
          {error.message}
          <Button onClick={() => void load(error.path)} size="inline" variant="text">
            {copy.retry}
          </Button>
        </div>
      )}
      {!data ? (
        <TreeSkeleton />
      ) : (
        <ProjectTree
          collapseNonce={0}
          cwd={entry.project.canonical_path}
          data={data}
          onActivateFile={onFile}
          onActivateFolder={path => void load(path)}
          onLoadChildren={load}
          onNodeOpenChange={(id, open) => setOpenState(previous => ({ ...previous, [id]: open }))}
          onPreviewFile={onFile}
          openState={openState}
          scopedReadOnly
        />
      )}
    </div>
  )
}

export function SharedProjectTree({ owner }: { owner: ConversationOwner }) {
  const copy = useI18n().t.sharedProjects
  const [preview, setPreview] = useState<{ entry: OpenSharedProject; path: string } | null>(null)

  const opened = useStore(sharedProjectWindow.opened).filter(
    entry => entry.connectionId === owner.connectionId && entry.project.install_id === owner.installId
  )

  return (
    <aside
      aria-label="Opened project folders"
      className="h-full overflow-auto p-3 pt-(--titlebar-height)"
      data-file-browser=""
    >
      <h2>{copy.opened}</h2>
      {opened.length === 0 && <p>{copy.empty}</p>}
      {opened.map(entry => (
        <section aria-label={entry.project.name} key={sharedOpenKey(entry)}>
          <div className="flex items-center justify-between">
            <h3>{entry.project.name}</h3>
            <Button onClick={() => sharedProjectWindow.close(entry)} variant="ghost">
              {copy.close}
            </Button>
          </div>
          <SharedDirectory
            entry={entry}
            key={JSON.stringify([sharedOpenKey(entry), projectSourceKey(entry.source)])}
            onFile={path => setPreview({ entry, path })}
          />
        </section>
      ))}
      {preview &&
        opened.some(
          entry =>
            sharedOpenKey(entry) === sharedOpenKey(preview.entry) &&
            projectSourceKey(entry.source) === projectSourceKey(preview.entry.source)
        ) && (
          <section aria-label={preview.path} className="min-h-64">
            <h3>{preview.path}</h3>
            <SharedProjectPreview
              key={JSON.stringify([sharedOpenKey(preview.entry), projectSourceKey(preview.entry.source), preview.path])}
              {...preview}
            />
          </section>
        )}
    </aside>
  )
}
