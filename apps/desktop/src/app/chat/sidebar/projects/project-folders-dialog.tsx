import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { $activeGatewayProfile, $profileScope } from '@/store/profile'
import { projectFolderActions } from '@/store/project-folders'
import { $projectDialog, closeProjectDialog, pickProjectFolder } from '@/store/projects'
import type { ProjectInfo } from '@/types/hermes'

export function ProjectFoldersDialog({
  projectId,
  name,
  ownerProfile
}: {
  projectId: string
  name?: string
  ownerProfile?: string
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const actions = useMemo(() => projectFolderActions(projectId, ownerProfile), [projectId, ownerProfile])
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invocation] = useState(() => $projectDialog.get())
  const inFlight = useRef(false)
  useStore($activeGatewayProfile)
  useStore($profileScope)
  const current = actions.isCurrent()

  const load = useCallback(async () => {
    setError('')
    setBusy(true)

    try {
      const result = await actions.request('get')

      if ($projectDialog.get() === invocation) {
        setProject(result)
      }
    } catch (reason) {
      if ($projectDialog.get() === invocation) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if ($projectDialog.get() === invocation) {
        setBusy(false)
      }
    }
  }, [actions, invocation])

  useEffect(() => {
    void load()
  }, [load])

  const update = async (method: 'add_folder' | 'remove_folder' | 'set_primary', path?: string) => {
    if (inFlight.current || !actions.isCurrent()) {
      return
    }

    inFlight.current = true
    setBusy(true)
    setError('')

    try {
      const target = path ?? (await pickProjectFolder())

      if (!target || $projectDialog.get() !== invocation || !actions.isCurrent()) {
        return
      }

      const result = await actions.request(method, target)

      if ($projectDialog.get() === invocation) {
        setProject(result)
      }
    } catch (reason) {
      if ($projectDialog.get() === invocation) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      inFlight.current = false

      if ($projectDialog.get() === invocation) {
        setBusy(false)
      }
    }
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          closeProjectDialog()
        }
      }}
      open
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{p.manageFolders}</DialogTitle>
          <DialogDescription>{project?.name ?? name}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-(--ui-text-tertiary)">{p.foldersDescription}</p>
        {(!current || error) && (
          <div className="flex items-center gap-2 text-xs text-destructive" role="alert">
            <span className="min-w-0 break-words">{!current ? p.activeProfileChanged : error}</span>
            {current && !project && (
              <Button disabled={busy} onClick={() => void load()} size="sm" variant="ghost">
                <Codicon name="refresh" size="0.875rem" />
                {t.common.retry}
              </Button>
            )}
          </div>
        )}
        {!project && !error && current && <p className="text-xs text-(--ui-text-tertiary)">{t.common.loading}</p>}
        {project && current && (
          <ul aria-label={p.foldersLabel} className="max-h-72 divide-y divide-(--ui-stroke-tertiary) overflow-y-auto">
            {project.folders.map(folder => (
              <li className="flex min-w-0 items-center gap-2 py-2" key={folder.path}>
                <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="folder" size="0.875rem" />
                <span className="min-w-0 flex-1 break-all text-xs" title={folder.path}>
                  {folder.path}
                </span>
                {folder.is_primary ? (
                  <span className="shrink-0 text-xs text-(--ui-text-tertiary)">{p.primaryBadge}</span>
                ) : (
                  <Tip label={p.setPrimaryFolder}>
                    <Button
                      aria-label={p.setPrimaryFolder}
                      disabled={busy}
                      onClick={() => void update('set_primary', folder.path)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Codicon name="target" size="0.875rem" />
                    </Button>
                  </Tip>
                )}
                <Tip label={project.folders.length === 1 ? p.keepOneFolder : p.removeFolder}>
                  <Button
                    aria-label={p.removeFolder}
                    disabled={busy || project.folders.length === 1}
                    onClick={() => void update('remove_folder', folder.path)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Codicon name="close" size="0.875rem" />
                  </Button>
                </Tip>
              </li>
            ))}
          </ul>
        )}
        <Button
          className="self-start"
          disabled={busy || !project || !current}
          onClick={() => void update('add_folder')}
          size="sm"
          variant="ghost"
        >
          <Codicon name="add" size="0.875rem" />
          {p.addFolder}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
