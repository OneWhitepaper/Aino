import './notifications.css'

import { useStore } from '@nanostores/react'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { CopyButton } from '@/components/ui/copy-button'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useI18n } from '@/i18n'
import { AlertCircle, AlertTriangle, CheckCircle2, type IconComponent, Info } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { noticeIdForToast, recordFriction } from '@/store/desktop-metrics'
import {
  $notifications,
  type AppNotification,
  clearNotifications,
  dismissNotification,
  type NotificationKind,
  pauseNotification,
  resumeNotification,
  runNotificationAction
} from '@/store/notifications'

const tone: Record<NotificationKind, { icon: IconComponent; iconClass: string }> = {
  error: { icon: AlertCircle, iconClass: 'text-destructive' },
  warning: { icon: AlertTriangle, iconClass: 'text-(--ui-yellow)' },
  info: { icon: Info, iconClass: 'text-muted-foreground' },
  success: { icon: CheckCircle2, iconClass: 'text-(--ui-green)' }
}

function userDismiss(id: string) {
  recordFriction('notice_dismissed', noticeIdForToast(id))
  dismissNotification(id)
}

function summaryKey(notification: AppNotification) {
  return JSON.stringify([notification.epoch, notification.instance, notification.id])
}

function NoticeIcon({ notification }: { notification: AppNotification }) {
  const style = tone[notification.kind]
  const Icon = style.icon

  return notification.icon ? (
    <Codicon
      className={style.iconClass}
      name={notification.icon}
      size="1rem"
      style={notification.accentColor ? { color: notification.accentColor } : undefined}
    />
  ) : (
    <Icon
      className={cn('size-4 shrink-0', style.iconClass)}
      style={notification.accentColor ? { color: notification.accentColor } : undefined}
    />
  )
}

function NoticeActions({ notification, compact = false }: { notification: AppNotification; compact?: boolean }) {
  const { t } = useI18n()

  return (
    <div className="notification-actions">
      {(['action', 'secondaryAction'] as const).map(slot => {
        const action = notification[slot]

        if (!action) {
          return null
        }

        return (
          <Button
            disabled={Boolean(notification.pendingAction)}
            key={slot}
            onClick={() => void runNotificationAction(notification.id, slot)}
            size="sm"
            type="button"
            variant={compact ? 'text' : slot === 'action' ? 'default' : 'ghost'}
          >
            {notification.pendingAction === slot ? t.common.loading : action.label}
          </Button>
        )
      })}
    </div>
  )
}

/** In-flow desktop chrome: a bounded summary and a dedicated reading panel.
 * The existing notification store remains the sole queue and action owner. */
export function NotificationStack({ children, active = true }: { children?: ReactNode; active?: boolean }) {
  const notifications = useStore($notifications)
  const { t } = useI18n()
  const copy = t.notificationCenter
  const narrow = useMediaQuery('(max-width: 64rem)')
  const [selection, setPanel] = useState<'list' | AppNotification | null>(null)

  const { selectedItem, panel, panelKey, detailId } = notificationSelectionState(selection, notifications)

  const [hiddenSummaries, setHiddenSummaries] = useState<Set<string>>(() => new Set())
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const readingId = focusedId ?? hoveredId
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const panelBody = useRef<HTMLDivElement>(null)
  const available = notifications.filter(item => !hiddenSummaries.has(summaryKey(item)))
  const summary = available.find(item => summaryKey(item) === readingId) ?? available[0]
  const liveDetail = selectedItem
  const summaryId = summary?.id
  const panelOpen = active && Boolean(panel)
  const actionError = liveDetail?.actionError

  useEffect(() => {
    if (actionError && panelBody.current) {
      panelBody.current.scrollTop = 0
    }
  }, [actionError])

  useEffect(() => {
    if (!active || !panelKey) {
      return
    }

    close.current?.focus()
  }, [active, panelKey])

  useEffect(() => {
    if (active && narrow && panelOpen && !panelRef.current?.contains(document.activeElement)) {
      close.current?.focus()
    }
  }, [active, narrow, panelOpen])

  useEffect(() => {
    if (!active || !detailId) {
      return
    }

    pauseNotification(detailId, 'panel')

    return () => resumeNotification(detailId, 'panel')
  }, [active, detailId])

  useEffect(() => {
    const id = summaryId

    return () => {
      if (id) {
        resumeNotification(id, 'hover')
        resumeNotification(id, 'focus')
      }
    }
  }, [active, summaryId, panelOpen])

  useEffect(() => {
    if (selection && selection !== 'list' && !selectedItem) {
      setPanel('list')
    }
  }, [selectedItem, selection])

  useEffect(() => {
    if (!active) {
      setHoveredId(null)
      setFocusedId(null)
    }
  }, [active])

  function openPanel(next: 'list' | AppNotification) {
    setHoveredId(null)
    setFocusedId(null)
    setPanel(next)
  }

  function closePanel() {
    setPanel(null)
    trigger.current?.focus()
  }

  return (
    <section className="notification-workspace" data-notification-workspace="">
      {active && (notifications.length > 0 || panel) && (
        <div className="notification-bar">
          <Button
            aria-expanded={Boolean(panel)}
            aria-label={copy.title}
            className="notification-trigger"
            onClick={() => (panel ? closePanel() : openPanel('list'))}
            ref={trigger}
            size="sm"
            variant="ghost"
          >
            <Codicon name="bell" size="1rem" />
            <span>{copy.title}</span>
            {notifications.length > 0 && <span className="notification-count">{notifications.length}</span>}
          </Button>
          {!panel && summary && (
            <NotificationSummary
              onFocusChange={setFocusedId}
              onHide={() => setHiddenSummaries(current => new Set([...current, summaryKey(summary)]))}
              onHoverChange={setHoveredId}
              openPanel={openPanel}
              summary={summary}
            />
          )}
        </div>
      )}
      <div className="notification-workspace-row">
        <div
          aria-hidden={Boolean(panelOpen && narrow) || undefined}
          className={cn('notification-workspace-content', panelOpen && narrow && 'notification-content-hidden')}
          inert={Boolean(panelOpen && narrow)}
        >
          {children}
        </div>
        {active && panel && (
          <NotificationPanel
            close={close}
            closePanel={closePanel}
            liveDetail={liveDetail}
            notifications={notifications}
            openPanel={openPanel}
            panel={panel}
            panelBody={panelBody}
            panelRef={panelRef}
            setPanel={setPanel}
          />
        )}
      </div>
    </section>
  )
}

interface NotificationPanelProps {
  panel: 'list' | AppNotification
  notifications: AppNotification[]
  liveDetail: AppNotification | undefined
  panelRef: RefObject<HTMLElement | null>
  panelBody: RefObject<HTMLDivElement | null>
  close: RefObject<HTMLButtonElement | null>
  closePanel: () => void
  openPanel: (value: 'list' | AppNotification) => void
  setPanel: (value: 'list' | AppNotification | null) => void
}

function NotificationPanel({
  panel,
  notifications,
  liveDetail,
  panelRef,
  panelBody,
  close,
  closePanel,
  openPanel,
  setPanel
}: NotificationPanelProps) {
  const { t } = useI18n()
  const copy = t.notificationCenter

  return (
    <aside
      aria-label={copy.title}
      className="notification-panel"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closePanel()
        }
      }}
      ref={panelRef}
    >
      <header className="notification-panel-header">
        {panel !== 'list' && (
          <Button aria-label={t.common.back} onClick={() => openPanel('list')} size="icon-sm" variant="ghost">
            <Codicon name="arrow-left" size="1rem" />
          </Button>
        )}
        <h2>{panel === 'list' ? copy.title : t.notifications.details}</h2>
        <Button aria-label={t.common.close} onClick={closePanel} ref={close} size="icon-sm" variant="ghost">
          <Codicon name="close" size="1rem" />
        </Button>
      </header>
      <div className="notification-panel-body" key={panel === 'list' ? 'list' : panel.id} ref={panelBody}>
        {panel === 'list' ? (
          <>
            <NotificationList notifications={notifications} openPanel={openPanel} />
          </>
        ) : (
          <>
            <NotificationDetail liveDetail={liveDetail} panel={panel} />
          </>
        )}
      </div>
      <footer className="notification-panel-footer">
        {panel === 'list' ? (
          <Button
            disabled={!notifications.some(item => !item.persistent && !item.pendingAction)}
            onClick={() => clearNotifications()}
            size="sm"
            variant="ghost"
          >
            {t.notifications.clearAll}
          </Button>
        ) : (
          liveDetail && (
            <>
              <NoticeActions notification={liveDetail} />
              <Button
                disabled={Boolean(liveDetail.pendingAction)}
                onClick={() => {
                  userDismiss(liveDetail.id)
                  setPanel('list')
                }}
                size="sm"
                variant="ghost"
              >
                {t.notifications.dismiss}
              </Button>
            </>
          )
        )}
      </footer>
    </aside>
  )
}

interface NotificationSummaryProps {
  summary: AppNotification
  openPanel: (notification: AppNotification) => void
  onFocusChange: (id: string | null) => void
  onHoverChange: (id: string | null) => void
  onHide: () => void
}

function NotificationSummary({ summary, openPanel, onFocusChange, onHoverChange, onHide }: NotificationSummaryProps) {
  const { t } = useI18n()
  const copy = t.notificationCenter

  return (
    <article
      aria-live={summary.kind === 'error' ? 'assertive' : 'polite'}
      className="notification-summary"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          resumeNotification(summary.id, 'focus')
          onFocusChange(null)
        }
      }}
      onFocus={() => {
        pauseNotification(summary.id, 'focus')
        onFocusChange(summaryKey(summary))
      }}
      onMouseEnter={() => {
        pauseNotification(summary.id, 'hover')
        onHoverChange(summaryKey(summary))
      }}
      onMouseLeave={() => {
        resumeNotification(summary.id, 'hover')
        onHoverChange(null)
      }}
      role={summary.kind === 'error' ? 'alert' : 'status'}
    >
      <NoticeIcon notification={summary} />
      <div className="notification-summary-copy">
        {summary.title && <strong>{summary.title}</strong>}
        <p>{summary.message}</p>
        {summary.actionError && <p role="alert">{summary.actionError}</p>}
      </div>
      <div className="notification-summary-footer">
        {(summary.action || summary.secondaryAction) && <NoticeActions compact notification={summary} />}
        <Button className="notification-summary-details" onClick={() => openPanel(summary)} size="xs" variant="text">
          {t.notifications.details}
        </Button>
      </div>
      <Button
        aria-label={copy.hideSummary}
        className="notification-summary-hide"
        disabled={Boolean(summary.pendingAction)}
        onClick={() => {
          resumeNotification(summary.id, 'focus')
          resumeNotification(summary.id, 'hover')
          onFocusChange(null)
          onHoverChange(null)
          onHide()
        }}
        size="icon-xs"
        variant="ghost"
      >
        <Codicon name="close" size="0.875rem" />
      </Button>
    </article>
  )
}

function NotificationDetail({
  panel,
  liveDetail
}: {
  panel: AppNotification
  liveDetail: AppNotification | undefined
}) {
  const { t } = useI18n()
  const copy = t.notificationCenter

  return (
    <>
      <div className="notification-detail-heading">
        <NoticeIcon notification={panel} />
        <h3>{panel.title ?? panel.message}</h3>
      </div>
      {liveDetail?.actionError && (
        <div className="notification-action-error" role="alert">
          <p>{liveDetail.actionError}</p>
          {liveDetail.actionErrorDetail && (
            <details className="notification-technical">
              <summary>{copy.technical}</summary>
              <pre>{liveDetail.actionErrorDetail}</pre>
              <CopyButton appearance="inline" label={t.notifications.copyDetail} text={liveDetail.actionErrorDetail}>
                {t.notifications.copyDetail}
              </CopyButton>
            </details>
          )}
        </div>
      )}
      {panel.title && <p>{panel.message}</p>}
      {panel.meta && <p className="notification-meta">{panel.meta}</p>}
      {(panel.repeatCount ?? 0) > 1 && <p className="notification-meta">{copy.repeated(panel.repeatCount ?? 1)}</p>}
      {panel.sourceKey === 'sessions.auto_prune' && (
        <div className="notification-advice">
          <p>{copy.diskAdvice}</p>
          <p>{copy.diskLimits}</p>
        </div>
      )}
      {panel.detail && panel.detail !== panel.message && (
        <details className="notification-technical" open={panel.sourceKey !== 'sessions.auto_prune'}>
          <summary>{copy.technical}</summary>
          <pre data-selectable-text="true">{panel.detail}</pre>
          <CopyButton
            appearance="inline"
            errorMessage={t.notifications.copyDetailFailed}
            label={t.notifications.copyDetail}
            text={panel.detail}
          >
            {t.notifications.copyDetail}
          </CopyButton>
        </details>
      )}
      {!liveDetail && <p className="notification-meta">{copy.empty}</p>}
    </>
  )
}

function NotificationList({
  notifications,
  openPanel
}: {
  notifications: AppNotification[]
  openPanel: (notification: AppNotification) => void
}) {
  const { t } = useI18n()
  const copy = t.notificationCenter

  return (
    <>
      {!notifications.length && <p className="notification-empty">{copy.empty}</p>}
      <ul className="notification-list">
        {notifications.map(notification => (
          <li key={notification.id}>
            <button className="notification-list-item" onClick={() => openPanel(notification)} type="button">
              <NoticeIcon notification={notification} />
              <span>
                <strong>{notification.title ?? notification.message}</strong>
                {notification.title && <span>{notification.message}</span>}
                {(notification.repeatCount ?? 0) > 1 && <small>{copy.repeated(notification.repeatCount ?? 1)}</small>}
              </span>
              <Codicon name="chevron-right" size="0.875rem" />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

export function InlineNotice({
  kind = 'info',
  title,
  children,
  className
}: {
  kind?: NotificationKind
  title?: string
  children: ReactNode
  className?: string
}) {
  const Icon = tone[kind].icon

  return (
    <Alert className={cn('min-w-0', className)} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon className={tone[kind].iconClass} />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className={cn(!title && 'row-start-1')}>{children}</AlertDescription>
    </Alert>
  )
}

function notificationSelectionState(selection: 'list' | AppNotification | null, notifications: AppNotification[]) {
  const selectedItem =
    selection && selection !== 'list'
      ? notifications.find(
          item => item.id === selection.id && item.epoch === selection.epoch && item.instance === selection.instance
        )
      : undefined

  const panel = selection && selection !== 'list' ? (selectedItem ?? 'list') : selection

  return { selectedItem, panel, panelKey: panel === 'list' ? 'list' : selectedItem?.id, detailId: selectedItem?.id ?? null }
}
