// The sidebar's projects-section copy, composed by en.ts.
import type { Translations } from './types'
export const enProjects: Translations['sidebar']['projects'] = {
  showAllSessions: 'Show all sessions',
  sectionLabel: 'Projects',
  home: 'Home',
  autoDiscovered: 'Auto-discovered',
  newButton: 'New project',
  createTitle: 'Create project',
  createDesc: 'Enter a name, then choose where to create its folder. You can also add an existing folder.',
  renameTitle: 'Rename project',
  addFolderTitle: 'Add folder',
  namePlaceholder: 'Project name',
  foldersLabel: 'Source folders',

  noFolders: 'No folders added yet.',
  addFolder: 'Add folder',
  primaryBadge: 'primary',
  removeFolder: 'Remove',
  create: 'Create project',
  menu: 'Actions',
  menuRename: 'Rename…',
  menuAppearance: 'Appearance',
  noColor: 'No color',
  menuAddFolder: 'Add folder',
  menuSetActive: 'Set active',
  menuDelete: 'Remove project',
  moveToProject: 'Move to project',
  movedTo: name => `Moved to ${name}`,
  moveFailed: 'Could not move session',
  moveNoFolder: 'That project has no folder to move into',
  moveNoProjects: 'No other projects',
  reveal: 'Reveal in folder',
  copyPath: 'Copy path',
  removeFromSidebar: 'Hide from sidebar',
  createdInPreviousContext:
    "Project created on the previous connection or profile. Switch back to find it; IDEA.md wasn't written.",
  hiddenFromSidebar: 'Hidden from sidebar',
  undoHide: 'Undo',
  createFailed: 'Could not create project',
  staleBackend:
    'Update the Hermes backend to create projects — your backend is older than this desktop app (Settings → Updates → Backend).',
  deleteConfirm:
    'Only the project registration is removed from Aino. Chats, local files, git repositories, and worktrees are kept.',
  startWork: 'New worktree',
  newWorktreeTitle: 'New worktree',
  newWorktreeDesc: 'Name the branch for this worktree.',
  branchPlaceholder: 'e.g. my-feature',
  branchOff: () => ({ after: '', before: 'branch off ' }),
  baseBranchPlaceholder: 'Search branches…',
  baseBranchNone: 'No branches found',
  startWorkFailed: 'Could not create worktree',
  worktreeStaleBackend:
    'Update the Hermes backend to create worktrees over this remote connection — it predates the git worktree API.',
  worktreeProjectLabel: 'Project',
  worktreeProjectPlaceholder: 'Search projects…',
  worktreeProjectNone: 'No projects with a folder',
  convertBranch: 'Convert a branch…',
  convertBranchTitle: 'Convert a branch',
  convertBranchDesc: 'Open checked-out branches, or create a worktree for a free branch.',
  convertBranchPlaceholder: 'Search branches…',
  convertBranchInstead: 'Convert an existing branch',
  branchOpenExisting: 'open',
  branchSwitchHome: 'switch home',
  branchCreateWorktree: 'new worktree',
  branchTrackRemote: 'track remote',
  branchesLoading: 'Loading branches…',
  noBranches: 'No branches found',
  removeWorktree: 'Remove worktree',
  removeWorktreeFailed: 'Could not remove worktree (uncommitted changes?)',
  removeWorktreeConfirm:
    'Remove it from git (deletes the worktree directory; the branch stays), or just hide the lane from the sidebar and leave the worktree on disk.',
  removeWorktreeDirty:
    'This worktree has uncommitted changes. Force-remove it (discards those changes), or just hide the lane and keep it on disk.',
  forceRemove: 'Force remove',
  enter: label => `Open ${label}`,
  reorder: label => `Reorder ${label}`,
  toggle: (label, open) => `${open ? 'Show' : 'Hide'} ${label} sessions`,
  showAllCount: count => `Show all ${count} sessions`,
  back: 'All projects',
  empty: 'No open projects',

  createFolderLocation: name => `Choose where to create “${name}”`,

  folderSourceLocal: 'Add folders on this computer',

  folderSourceRemote: 'Add folders on the connected host',

  add: 'Add',

  manageFolders: 'Manage folders',

  setPrimaryFolder: 'Set as primary folder',

  foldersDescription: 'New chats use the primary folder. Removing a folder here keeps its files and chats.',

  keepOneFolder: 'Keep at least one folder',

  contextChanged: 'The conversation or workspace changed. Reopen this dialog to continue.',

  menuClose: 'Close project',

  unavailableAllProfiles: 'Project settings are read-only in All profiles. Select a workspace in Settings to edit.',

  activeProfileChanged: 'Active Hermes profile changed while connecting'
}
