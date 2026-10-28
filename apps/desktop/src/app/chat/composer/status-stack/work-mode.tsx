import { useStore } from '@nanostores/react'

import { useSessionView } from '@/app/chat/session-view'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { HermesGitWorktree } from '@/global'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { isUnderPath } from '@/lib/path-compare'
import { openWorktreeDialog } from '@/store/coding-status'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import { projectIdForCwd } from '@/store/projects'
import { $connection } from '@/store/session'
import { $sessionOwnerHoldRevision, knownOwnerForSession } from '@/store/session-states'
import { resolveToolSessionScope, toolSessionHasCurrentSource } from '@/store/tool-session'

import { $projectBindingSessions, canSelectDraftProject, captureProjectSelection } from '../project-selection'
import { useComposerScope } from '../scope'

interface ComposerWorkModeProps {
  cwd: string
  projectId: string
  worktrees: HermesGitWorktree[]
}

/** Work location is derived from Git, never a separately persisted mode flag. */
export function ComposerWorkMode({ cwd, projectId, worktrees }: ComposerWorkModeProps) {
  const { t } = useI18n()
  const s = t.statusStack.coding
  const view = useSessionView()
  const scope = useComposerScope()
  const runtimeId = useStore(view.$runtimeId)
  useStore(view.$storedId)
  useStore(view.$busy)
  useStore(view.$messagesEmpty)
  const connection = useStore($connection)
  useStore($activeGatewayProfile)
  useStore($sessionOwnerHoldRevision)
  const binding = useStore($projectBindingSessions).has(runtimeId ?? '')
  const draft = canSelectDraftProject(view)

  const sourceIsCurrent = () => {
    const id = view.$runtimeId.get() ?? view.$storedId.get()
    const owner = knownOwnerForSession(id)

    return toolSessionHasCurrentSource({ storedId: id, owner, scope: resolveToolSessionScope(owner) })
  }

  const localLabel = connection?.mode === 'remote' ? s.projectDirectory : s.localWork

  const current = worktrees.filter(tree => isUnderPath(tree.path, cwd)).sort((a, b) => b.path.length - a.path.length)[0]

  // Bare repositories lead the list but cannot host a conversation's files.
  const main = worktrees.find(tree => tree.isMain && (tree.branch || tree.detached))
  const available = sourceIsCurrent()

  const capture = () => {
    const selection = captureProjectSelection(view, scope.attachments)
    const isCurrent = () => selection.isCurrent() && sourceIsCurrent() && view.$cwd.get() === cwd

    return {
      isCurrent,
      select: async (path: string) => {
        if (isCurrent()) {
          await selection
            .select(path, projectIdForCwd(path) ?? projectId)
            .catch(error => notifyError(error, t.desktop.cwdChangeFailed))
        }
      }
    }
  }

  const select = (path: string) => void capture().select(path)

  const create = () => {
    const selection = capture()
    void openWorktreeDialog({
      repoPath: cwd,
      isCurrent: selection.isCurrent,
      onCreated: result => selection.select(result.path)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={s.workLocation}
          className="min-w-0 shrink-0 max-w-[40%]"
          disabled={binding || !current || !available}
          size="inline"
          variant="ghost"
        >
          <Codicon name={current?.isMain ? 'device-desktop' : 'worktree'} size="0.875rem" />
          <span className="truncate text-[length:var(--aino-text-ui)] font-normal">
            {current ? (current.isMain ? localLabel : s.worktreeWork) : s.workLocation}
          </span>
          <Codicon name="chevron-down" size="0.75rem" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-2rem)]" side="top">
        <DropdownMenuLabel>{draft ? s.workLocation : s.newChatLocation}</DropdownMenuLabel>
        <DropdownMenuLabel className="whitespace-normal break-all font-mono font-normal">
          {displayPath(cwd)}
        </DropdownMenuLabel>
        {main && (
          <DropdownMenuItem aria-label={localLabel} disabled={current?.isMain} onSelect={() => select(main.path)}>
            <Codicon name="device-desktop" size="0.875rem" />
            <span className="flex-1 truncate">{localLabel}</span>
            {current?.isMain && <Codicon name="check" size="0.875rem" />}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{s.worktreeWork}</DropdownMenuLabel>
        <div className="max-h-48 overflow-y-auto">
          {worktrees
            .filter(tree => !tree.isMain)
            .map(tree => (
              <DropdownMenuItem
                aria-label={tree.branch || displayPath(tree.path)}
                disabled={tree === current}
                key={tree.path}
                onSelect={() => select(tree.path)}
              >
                <Codicon name="worktree" size="0.875rem" />
                <span className="flex-1 truncate">{tree.branch || displayPath(tree.path)}</span>
                {tree === current && <Codicon name="check" size="0.875rem" />}
              </DropdownMenuItem>
            ))}
        </div>
        <DropdownMenuItem onSelect={create}>
          <Codicon name="add" size="0.875rem" />
          {s.createWorktree}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
