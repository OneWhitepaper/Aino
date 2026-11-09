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
  switchConversation: 'Switch conversation',
  sidebarModeMenu: 'Switch conversation mode',
  sidebarSessionsDescription: 'Projects, files and everyday conversations',
  showTabStrip: 'Show tabs',
  hideTabStrip: 'Hide tabs',
  showStripTab: title => `Show ${title}`,
  hideStripTab: title => `Hide ${title}`,
  toggleStripTab: title => `Toggle ${title} tab`
}
