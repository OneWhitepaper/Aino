import type { Translations } from './types'

export const sidebarMode: Pick<
  Translations['zones'],
  | 'switchConversation'
  | 'sidebarModeMenu'
  | 'sidebarSessionsDescription'
  | 'showTabStrip'
  | 'hideTabStrip'
  | 'showStripTab'
  | 'hideStripTab'
  | 'toggleStripTab'
> = {
  switchConversation: '切换会话',
  sidebarModeMenu: '切换会话模式',
  sidebarSessionsDescription: '项目、文件与日常对话',
  showTabStrip: '显示标签',
  hideTabStrip: '隐藏标签',
  showStripTab: title => `显示 ${title}`,
  hideStripTab: title => `隐藏 ${title}`,
  toggleStripTab: title => `切换 ${title} 标签`
}
