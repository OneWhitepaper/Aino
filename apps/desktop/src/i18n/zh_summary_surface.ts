import type { SummaryTranslations } from './types_summary_surface'

export const zhSummary: SummaryTranslations = {
  aria: '会话资源',
  title: '会话资源',
  close: '关闭会话资源',
  environment: {
    title: '环境信息',
    project: '项目',
    workingDirectory: '工作目录',
    model: '模型',
    provider: '提供商',
    profile: '工作区',
    branch: '分支',
    connection: '连接状态',
    noProject: '未打开项目',
    noSession: '未选择会话',
    local: '本地',
    remote: '远程'
  },
  changes: {
    title: '工作区变更',
    files: count => `${count} 个文件`,
    additions: '新增',
    deletions: '删除',
    staged: count => `${count} 个已暂存`,
    noChanges: '没有未提交的变更',
    unavailable: '暂时无法获取代码变更',
    viewDiff: '查看差异',
    refresh: '刷新变更',
    stage: '暂存文件',
    unstage: '取消暂存',
    revert: '撤销文件'
  },
  git: {
    title: 'Git 状态',
    branch: '分支',
    tracking: '远程跟踪',
    ahead: count => `领先 ${count}`,
    behind: count => `落后 ${count}`,
    commit: '最近提交',
    pullRequest: '拉取请求',
    push: '推送',
    reviewAndCommit: '审查、提交或创建 PR',
    clean: '无领先或落后的提交',
    unavailable: '此工作区暂不可用 Git',
    noRepository: '此工作区不是 Git 仓库'
  },
  agents: {
    title: '子智能体',
    running: count => `运行中 ${count}`,
    completed: count => `已完成 ${count}`,
    failed: count => `失败 ${count}`,
    viewAll: '查看全部智能体',
    none: '此会话暂无子智能体',
    dispatched: count => `已派发 ${count}`,
    finished: '已结束',
    status: {
      running: '运行中',
      queued: '排队中',
      completed: '已完成',
      failed: '失败',
      interrupted: '已中断',
      dispatched: '已派发'
    }
  },
  context: {
    title: '上下文用量',
    noData: '暂时没有上下文数据'
  },
  sources: {
    title: '来源',
    add: '添加来源',
    image: '图片附件',
    skill: '技能',
    tool: '工具',
    attachments: '附件',
    previews: '预览',
    links: '链接',
    none: '此会话暂无来源',
    open: '打开来源'
  },
  outputs: {
    title: '输出内容',
    create: '创建文件或网页',
    prompt: '帮我创建文件或网页：'
  },
  plan: {
    title: '任务计划',
    progress: (done, total) => `已完成 ${done} / ${total} 项`,
    recorded: '会话中最后记录的计划',
    status: { pending: '待处理', in_progress: '进行中', completed: '已完成', cancelled: '已取消' }
  },
  background: {
    title: '后台进程',
    status: { running: '运行中', done: '已完成', failed: '失败' }
  },
  resources: {
    title: '系统资源',
    ram: '内存',
    gpu: 'GPU',
    unavailable: '系统资源暂不可用',
    retry: '重试资源查询'
  },
  state: {
    showAll: count => `查看全部（${count}）`,
    showLess: '收起',
    details: '详细信息',
    historyUnavailable: '暂时无法读取此会话的历史记录',
    loading: '加载中…',
    unavailable: '暂时不可用',
    noData: '暂无数据',
    retry: '重试'
  }
}
