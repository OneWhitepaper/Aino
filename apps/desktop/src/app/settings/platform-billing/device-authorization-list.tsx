import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { deviceAuthorizationCopy } from '@/i18n/device-authorizations'
import { ChevronRight } from '@/lib/icons'

import type { PlatformDevice } from '../../../../shared/platform-contract'
import { Pill } from '../primitives'

interface DeviceAuthorizationListProps {
  devices: PlatformDevice[]
  disabled: boolean
  onSelect: (deviceId: string) => void
}

function deviceStatus(device: PlatformDevice) {
  return (
    device.status ??
    (device.expires_at !== null && Date.parse(device.expires_at) <= Date.now()
      ? 'expired'
      : device.revoked
        ? 'revoked'
        : 'active')
  )
}

function DeviceAuthorizationRow({
  device,
  disabled,
  onSelect
}: Omit<DeviceAuthorizationListProps, 'devices'> & { device: PlatformDevice }) {
  const { t, locale } = useI18n()
  const copy = deviceAuthorizationCopy(locale)
  const status = deviceStatus(device)
  const info = device.device_info
  const os = info && { macos: 'macOS', windows: 'Windows', linux: 'Linux' }[info.os]

  const suffix =
    info && { desktop: copy.production, desktop_dev: copy.development, browser: copy.browser }[info.client_type]

  const name = info ? `${info.installation_name} ${suffix}` : device.is_current ? null : copy.unnamed
  const title = [device.is_current && copy.current, name, os].filter(Boolean).join(' · ')
  const kind = device.credential_type ?? (device.expires_at === null ? 'device' : 'lease')

  return (
    <div className="account-device" role="listitem">
      <div className="account-device-main">
        <div className="account-device-identity">
          <span>{title}</span>
          <Pill tone={status === 'active' ? 'success' : 'muted'}>
            {device.is_current && status === 'active' ? copy.inUse : t.platformDevices[status]}
          </Pill>
        </div>
        <Button
          disabled={status === 'revoked' || disabled}
          onClick={() => onSelect(device.device_id)}
          size="sm"
          variant="ghost"
        >
          {t.platformDevices.revoke}
        </Button>
      </div>
      <div className="account-device-times">
        <span>
          {t.platformDevices.lastUsed}: {new Date(device.last_used_at).toLocaleString(locale)}
        </span>
      </div>
      <details className="account-device-details">
        <summary>
          <ChevronRight aria-hidden="true" />
          {copy.details}
        </summary>
        <dl>
          <div>
            <dt>ID</dt>
            <dd>
              <bdi dir="ltr">{device.device_id}</bdi>
            </dd>
          </div>
          {info && (
            <div>
              <dt>{copy.version}</dt>
              <dd>{info.client_version}</dd>
            </div>
          )}
          <div>
            <dt>{kind === 'device' ? copy.permanent : copy.legacy}</dt>
            <dd>
              {t.platformDevices.expires}:{' '}
              {device.expires_at === null
                ? t.platformModels.permanent
                : new Date(device.expires_at).toLocaleString(locale)}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  )
}

export function DeviceAuthorizationList({ devices, disabled, onSelect }: DeviceAuthorizationListProps) {
  const { locale } = useI18n()
  const copy = deviceAuthorizationCopy(locale)

  const ordered = devices.toSorted(
    (a, b) =>
      Number(Boolean(b.is_current)) - Number(Boolean(a.is_current)) ||
      Date.parse(b.last_used_at) - Date.parse(a.last_used_at)
  )

  const current = ordered.filter(device => deviceStatus(device) === 'active' && device.is_current)
  const other = ordered.filter(device => deviceStatus(device) === 'active' && !device.is_current)
  const history = ordered.filter(device => deviceStatus(device) !== 'active')

  const rows = (items: PlatformDevice[]) =>
    items.map(device => (
      <DeviceAuthorizationRow device={device} disabled={disabled} key={device.device_id} onSelect={onSelect} />
    ))

  return (
    <div className="account-device-authorizations">
      {(current.length > 0 || other.length > 0) && (
        <div aria-label={copy.active} role="list">
          {rows(current)}
          {other.length > 0 && <p className="account-device-section">{copy.otherActive}</p>}
          {rows(other)}
        </div>
      )}
      {history.length > 0 && (
        <details className="account-device-history">
          <summary>
            <ChevronRight aria-hidden="true" />
            {copy.history(history.length)}
          </summary>
          <div role="list">{rows(history)}</div>
        </details>
      )}
    </div>
  )
}
