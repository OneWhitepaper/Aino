export interface SummaryTranslations {
  aria: string
  title: string
  close: string
  environment: {
    title: string
    local: string
    remote: string
    project: string
    workingDirectory: string
    model: string
    provider: string
    profile: string
    branch: string
    connection: string
    noProject: string
    noSession: string
  }
  changes: {
    title: string
    files: (count: number) => string
    additions: string
    deletions: string
    staged: (count: number) => string
    noChanges: string
    unavailable: string
    viewDiff: string
    refresh: string
    stage: string
    unstage: string
    revert: string
  }
  git: {
    title: string
    branch: string
    tracking: string
    ahead: (count: number) => string
    behind: (count: number) => string
    commit: string
    pullRequest: string
    push: string
    reviewAndCommit: string
    clean: string
    unavailable: string
    noRepository: string
  }
  agents: {
    title: string
    dispatched: (count: number) => string
    finished: string
    status: Record<'running' | 'queued' | 'completed' | 'failed' | 'interrupted' | 'dispatched', string>
    running: (count: number) => string
    completed: (count: number) => string
    failed: (count: number) => string
    viewAll: string
    none: string
  }
  context: {
    title: string
    noData: string
  }
  outputs: {
    title: string
    create: string
    prompt: string
  }
  plan: {
    title: string
    progress: (done: number, total: number) => string
    recorded: string
    status: Record<'pending' | 'in_progress' | 'completed' | 'cancelled', string>
  }
  background: {
    title: string
    status: Record<'running' | 'done' | 'failed', string>
  }
  sources: {
    title: string
    add: string
    image: string
    skill: string
    tool: string
    attachments: string
    previews: string
    links: string
    none: string
    open: string
  }
  resources: {
    title: string
    ram: string
    gpu: string
    unavailable: string
    retry: string
  }
  state: {
    loading: string
    unavailable: string
    noData: string
    retry: string
    showAll: (count: number) => string
    showLess: string
    details: string
    historyUnavailable: string
  }
}
