import type { SummaryTranslations } from './types_summary_surface'

export const enSummary: SummaryTranslations = {
  aria: 'Session summary',
  title: 'Session summary',
  description: 'The outputs, tasks and activity from this conversation are collected here.',
  close: 'Collapse session summary',
  currentSession: 'Current conversation',
  environment: {
    title: 'Environment',
    project: 'Project',
    workingDirectory: 'Working directory',
    model: 'Model',
    provider: 'Provider',
    profile: 'Bot',
    branch: 'Branch',
    connection: 'Connection',
    noProject: 'No project is open',
    noSession: 'No session selected',
    local: 'Local',
    remote: 'Remote'
  },
  changes: {
    title: 'Project changes',
    files: count => `${count} file${count === 1 ? '' : 's'}`,
    additions: 'Added',
    deletions: 'Removed',
    staged: count => `${count} staged`,
    noChanges: 'No uncommitted changes',
    unavailable: 'Changes are temporarily unavailable',
    viewDiff: 'View diff',
    refresh: 'Refresh changes',
    stage: 'Stage file',
    unstage: 'Unstage file',
    revert: 'Revert file'
  },
  git: {
    title: 'Git status',
    branch: 'Branch',
    tracking: 'Tracking',
    ahead: count => `${count} ahead`,
    behind: count => `${count} behind`,
    commit: 'Recent commit',
    pullRequest: 'Pull request',
    push: 'Push',
    reviewAndCommit: 'Review, commit or create PR',
    clean: 'No commits ahead or behind',
    unavailable: 'Git is unavailable for this project',
    noRepository: 'This project is not a Git repository'
  },
  agents: {
    history: count => `Past subtasks (${count})`,
    title: 'Subagents',
    running: count => `${count} running`,
    completed: count => `${count} completed`,
    failed: count => `${count} failed`,
    viewAll: 'View all agents',
    none: 'No subagents in this session',
    dispatched: count => `${count} dispatched`,
    finished: 'Finished',
    status: {
      running: 'Running',
      queued: 'Queued',
      completed: 'Completed',
      failed: 'Failed',
      interrupted: 'Interrupted',
      dispatched: 'Dispatched'
    }
  },
  context: {
    title: 'Context usage',
    noData: 'No context data yet'
  },
  sources: {
    title: 'Sources',
    add: 'Add source',
    image: 'Image attachment',
    skill: 'Skill',
    tool: 'Tool',
    attachments: 'Attachments',
    previews: 'Previews',
    links: 'Links',
    none: 'Files and web pages you add appear here.',
    open: 'Open source'
  },
  outputs: {
    title: 'Outputs',
    none: 'No files have been generated in this conversation.',
    create: 'Create a file or website',
    prompt: 'Help me create a file or website: '
  },
  plan: {
    history: count => `Recorded plan (${count})`,
    title: 'Plan',
    progress: (done, total) => `${done} of ${total} completed`,
    recorded: 'Last recorded plan',
    status: { pending: 'Pending', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }
  },
  background: {
    title: 'Background processes',
    status: { running: 'Running', done: 'Completed', failed: 'Failed' }
  },
  resources: {
    title: 'System resources',
    ram: 'RAM',
    gpu: 'GPU',
    unavailable: 'System resources unavailable',
    retry: 'Retry resource check'
  },
  state: {
    showAll: count => `View all (${count})`,
    showLess: 'Show less',
    details: 'Details',
    historyUnavailable: 'Could not load this conversation’s history',
    loading: 'Loading…',
    unavailable: 'Temporarily unavailable',
    noData: 'No data yet',
    retry: 'Retry'
  }
}
