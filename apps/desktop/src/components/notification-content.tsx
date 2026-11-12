import { useI18n } from '@/i18n'
import { notificationPresentationCopy } from '@/i18n/notification-presentation'
import type { AppNotification } from '@/store/notifications'

export function NotificationMetadata({ notification }: { notification: AppNotification }) {
  const { locale } = useI18n()
  const copy = notificationPresentationCopy(locale)

  return (
    <div className="notification-metadata">
      <span>{notification.source ?? copy.application}</span>
      <NotificationTime label={copy.received} timestamp={notification.createdAt} />
      {notification.deferredUntil && (
        <span className="notification-deferred">
          {copy.deferred} <NotificationTime timestamp={notification.deferredUntil} />
        </span>
      )}
    </div>
  )
}

function NotificationTime({ timestamp, label }: { timestamp: number; label?: string }) {
  const { locale } = useI18n()
  const date = new Date(timestamp)

  const formatted = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)

  return (
    <time aria-label={label ? `${label}: ${formatted}` : undefined} dateTime={date.toISOString()}>
      {formatted}
    </time>
  )
}

export function NotificationFacts({ notification }: { notification: AppNotification }) {
  const { locale } = useI18n()
  const copy = notificationPresentationCopy(locale)

  if (!notification.facts?.length) {
    return notification.sourceKey === 'sessions.auto_prune' ? (
      <p className="notification-meta">{copy.factsUnavailable}</p>
    ) : null
  }

  return (
    <dl className="notification-facts">
      {notification.facts.map((fact, index) => (
        <div key={`${fact.label}:${index}`}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
