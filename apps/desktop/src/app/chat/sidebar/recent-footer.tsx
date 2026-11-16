import { useI18n } from '@/i18n'
import { SESSION_SEARCH_FOCUS_EVENT } from '@/store/layout'

import { SidebarLoadMoreRow } from './load-more-row'

interface SidebarRecentFooterProps {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}

export function SidebarRecentFooter({ hasMore, loading, onLoadMore }: SidebarRecentFooterProps) {
  const { t } = useI18n()

  return (
    <div className="aino-sidebar-recent-footer">
      <button onClick={() => window.dispatchEvent(new CustomEvent(SESSION_SEARCH_FOCUS_EVENT))} type="button">
        {t.sidebar.viewAllSessions}
      </button>
      {hasMore && <SidebarLoadMoreRow loading={loading} onClick={onLoadMore} step={0} />}
    </div>
  )
}
