import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import type { NewSessionPlacement } from '@/app/chat/new-session-drag'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { createProjectFolder, desktopFsCacheKey } from '@/lib/desktop-fs'
import { isSubmitEnter } from '@/lib/ime'
import { cn } from '@/lib/utils'
import { activeGateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $newProjectDropPlacement,
  $projectDialog,
  addProjectFolders,
  clearNewProjectDropPlacement,
  closeProjectDialog,
  createProject,
  goToProject,
  pickProjectFolder,
  pickProjectFolders,
  renameProject
} from '@/store/projects'
import { $connection } from '@/store/session'

import { ProjectFoldersDialog } from './projects/project-folders-dialog'
import { baseName } from './projects/workspace-groups'

// Single dialog mounted once in the sidebar; it renders create / rename /
// add-folder flows driven by the $projectDialog atom. Folders are chosen via
// the native directory picker (reused from the default-project-dir setting).
export function ProjectDialog() {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const state = useStore($projectDialog)
  const open = state !== null
  const mode = state?.mode ?? 'create'
  const connection = useStore($connection)
  const creating = mode === 'create'
  const folderSource = connection?.mode === 'remote' ? p.folderSourceRemote : p.folderSourceLocal

  const [name, setName] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const submitInFlight = useRef(false)

  // A "New project" DRAG arms where the project should start (tab-strip slot /
  // pane edge / pane center) before the dialog opens. Snapshot it per open —
  // the submit forwards it as `dropPlacement`, and closing clears the store's
  // arm so a later plain-click create never inherits a stale placement.
  let dropPlacement: NewSessionPlacement | undefined

  if (open) {
    dropPlacement = $newProjectDropPlacement.get() ?? undefined
  }

  useEffect(() => {
    if (!open) {
      clearNewProjectDropPlacement()
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setName(state?.name ?? '')
      setFolders([])
      setSubmitting(false)

      if (mode === 'create' || mode === 'rename') {
        window.setTimeout(() => nameRef.current?.select(), 0)
      }
    }
  }, [open, mode, state?.name])

  const onOpenChange = (next: boolean) => {
    if (!next) {
      closeProjectDialog()
    }
  }

  // One submit beat for every flow: guard re-entry, run the write, close on
  // success, surface a toast on failure. Callers pass only the write, plus an
  // optional hook that runs exactly when the write SUCCEEDS (before the close)
  // — the New-project drop arm is consumed there, so a failed attempt keeps
  // its placement for the retry while a successful one can't leak it forward.
  const runSubmit = async <T,>(
    write: (stillCurrent: () => boolean) => Promise<T>,
    onSuccess?: (result: T) => boolean | void
  ) => {
    if (submitInFlight.current) {
      return
    }

    const invocation = $projectDialog.get()
    const gateway = activeGateway()
    const profile = $activeGatewayProfile.get()
    const fsOwner = desktopFsCacheKey()

    const stillCurrent = () =>
      $projectDialog.get() === invocation &&
      activeGateway() === gateway &&
      $activeGatewayProfile.get() === profile &&
      desktopFsCacheKey() === fsOwner &&
      (invocation?.isCurrent?.() ?? true)

    submitInFlight.current = true
    setSubmitting(true)

    try {
      if (!stillCurrent()) {
        throw new Error(p.contextChanged)
      }

      const result = await write(stillCurrent)

      if (stillCurrent() && onSuccess?.(result) !== false) {
        closeProjectDialog()
      }
    } catch (err) {
      notifyError(err, p.createFailed)
    } finally {
      submitInFlight.current = false

      if ($projectDialog.get() === invocation) {
        setSubmitting(false)
      }
    }
  }

  const pickFolder = async () => {
    const invocation = $projectDialog.get()
    const gateway = activeGateway()
    const profile = $activeGatewayProfile.get()
    const fsOwner = desktopFsCacheKey()

    const stillCurrent = () =>
      $projectDialog.get() === invocation &&
      activeGateway() === gateway &&
      $activeGatewayProfile.get() === profile &&
      desktopFsCacheKey() === fsOwner &&
      (invocation?.isCurrent?.() ?? true)

    try {
      if (!stillCurrent()) {
        throw new Error(p.contextChanged)
      }

      // One pick can carry several folders (multi-select dialog, #68741):
      // add-folder mode submits them all in one beat; create mode extends
      // the accumulated list exactly as successive single picks would.
      const picked = (await pickProjectFolders()).filter(Boolean)

      if (!picked.length) {
        return
      }

      if (!stillCurrent()) {
        throw new Error(p.contextChanged)
      }

      const projectId = state?.projectId

      if (mode === 'add-folder' && projectId) {
        await runSubmit(() => addProjectFolders(projectId, picked, state?.ownerProfile))

        return
      }

      setFolders(prev => [...prev, ...picked.filter(dir => !prev.includes(dir))])

      // Picking a folder with no name typed names the project after the folder
      // (the ⌘O "Open folder…" naming), so one pick + Create is enough. The name
      // lands in the input, never in a hidden fallback the user cannot see.
      if (mode === 'create') {
        const first = picked[0]

        setName(prev => prev.trim() || baseName(first) || prev)
      }
    } catch (err) {
      notifyError(err, p.createFailed)
    }
  }

  const submit = async () => {
    const trimmed = name.trim()
    const projectId = state?.projectId

    if (mode === 'rename' && projectId) {
      if (trimmed) {
        await runSubmit(() => renameProject(projectId, trimmed, state?.ownerProfile))
      }

      return
    }

    // Projects are folder-backed. An empty folder is valid; if the user starts
    // with only a name, choose its parent and create a same-named directory.
    if (mode === 'create' && trimmed) {
      let selectedFolders = folders

      // The arm is consumed exactly on SUCCESS (before the close): a failed
      // create leaves the dialog open for a retry that still lands where it
      // was dropped; the open-state effect discards it on cancel/teardown.
      await runSubmit(
        async stillCurrent => {
          if (!selectedFolders.length) {
            const parent = await pickProjectFolder(p.createFolderLocation(trimmed))

            if (!parent) {
              return null
            }

            if (!stillCurrent()) {
              throw new Error(p.contextChanged)
            }

            selectedFolders = [await createProjectFolder(parent, trimmed)]

            if (!stillCurrent()) {
              throw new Error(p.contextChanged)
            }

            // If project registration fails, retry the existing directory.
            setFolders(selectedFolders)
          }

          return createProject({
            dropPlacement,
            folders: selectedFolders,
            name: trimmed,
            use: true
          })
        },
        created => {
          if (!created) {
            return false
          }

          clearNewProjectDropPlacement()

          if (created && !dropPlacement) {
            if (state?.onCreated) {
              state.onCreated(created)
            } else {
              goToProject(created.id, { newSession: true })
            }
          }
        }
      )
    }
  }

  if (mode === 'manage-folders' && state?.projectId) {
    return (
      <ProjectFoldersDialog
        key={state.projectId}
        name={state.name}
        ownerProfile={state.ownerProfile}
        projectId={state.projectId}
      />
    )
  }

  const title = mode === 'rename' ? p.renameTitle : mode === 'add-folder' ? p.addFolderTitle : p.createTitle

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        bodyClassName={creating ? 'gap-4 p-5 sm:p-6' : undefined}
        className={cn(
          'max-w-md',
          creating &&
            'max-w-[34rem] [&_[data-slot=dialog-close-button]]:right-4 [&_[data-slot=dialog-close-button]]:top-4'
        )}
        onInteractOutside={event => event.preventDefault()}
      >
        <DialogHeader className={creating ? 'text-left' : undefined}>
          <DialogTitle className={creating ? 'text-2xl font-semibold' : undefined}>{title}</DialogTitle>
          {creating && <DialogDescription className="sr-only">{p.createDesc}</DialogDescription>}
        </DialogHeader>

        {mode !== 'add-folder' && (
          <Input
            aria-label={p.namePlaceholder}
            autoFocus
            className={creating ? 'font-medium' : undefined}
            containerClassName={
              creating ? 'gap-3 rounded-xl py-0 pl-0 pr-3 [--ui-bg-editor:var(--ui-bg-elevated)]' : undefined
            }
            disabled={submitting}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                event.preventDefault()
                void submit()
              } else if (event.key === 'Escape') {
                onOpenChange(false)
              }
            }}
            placeholder={p.namePlaceholder}
            prefix={
              creating ? (
                <span className="flex h-10 w-10 items-center justify-center border-r border-(--ui-stroke-tertiary) text-foreground">
                  <Codicon name="folder" size="1.125rem" />
                </span>
              ) : undefined
            }
            ref={nameRef}
            size={creating ? 'lg' : undefined}
            value={name}
          />
        )}

        {creating && (
          <div className="flex min-w-0 flex-col gap-2.5">
            <span className="text-sm font-medium text-foreground">{p.foldersLabel}</span>
            <div className="flex min-h-28 min-w-0 flex-col justify-center gap-3 rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) p-4">
              {folders.length > 0 && (
                <ul className="flex max-h-44 flex-col gap-2 overflow-y-auto">
                  {folders.map((folder, index) => (
                    <li className="flex min-w-0 items-center gap-2 text-sm" key={folder}>
                      <Codicon className="shrink-0 text-(--ui-text-secondary)" name="folder" size="1rem" />
                      <span className="min-w-0 flex-1 truncate" title={folder}>
                        {folder}
                      </span>
                      {index === 0 && (
                        <span className="shrink-0 text-xs text-(--ui-text-tertiary)">{p.primaryBadge}</span>
                      )}
                      <Tip label={p.removeFolder}>
                        <Button
                          aria-label={p.removeFolder}
                          disabled={submitting}
                          onClick={() => setFolders(prev => prev.filter(f => f !== folder))}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <Codicon name="close" size="0.875rem" />
                        </Button>
                      </Tip>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col items-center gap-2">
                <Button
                  className="max-w-full whitespace-normal text-center"
                  disabled={submitting}
                  onClick={() => void pickFolder()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <span>{folderSource}</span>
                  <Codicon name="chevron-down" size="0.875rem" />
                </Button>
                <Button
                  aria-label={p.addFolder}
                  className="rounded-full"
                  disabled={submitting}
                  onClick={() => void pickFolder()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Codicon name="new-folder" size="1rem" />
                  {p.add}
                </Button>
              </div>
            </div>
          </div>
        )}

        {mode === 'add-folder' && (
          <Button disabled={submitting} onClick={() => void pickFolder()} type="button">
            <Codicon name="folder-opened" size="0.875rem" />
            {p.addFolder}
          </Button>
        )}

        {mode !== 'add-folder' && (
          <DialogFooter className={creating ? 'mt-4 flex-row justify-end gap-4' : undefined}>
            <Button
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              size={creating ? 'lg' : 'default'}
              type="button"
              variant="ghost"
            >
              {t.common.cancel}
            </Button>
            <Button
              aria-label={mode === 'rename' ? t.common.save : p.create}
              disabled={submitting || !name.trim()}
              loading={submitting}
              onClick={() => void submit()}
              size={creating ? 'lg' : 'default'}
              type="button"
            >
              {mode === 'rename' ? t.common.save : p.create}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
