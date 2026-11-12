import './about-settings.css'

import { useStore } from '@nanostores/react'
import { type ReactElement, useEffect, useId } from 'react'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { UpdateStatusCard, VersionHero } from '@/components/update-status'
import { VersionDetails } from '@/components/version-details'
import { useI18n } from '@/i18n'
import { aboutPageCopy } from '@/i18n/about-page'
import { RELEASES_URL, WEBSITE_URL } from '@/lib/brand'
import { ExternalLink } from '@/lib/external-link'
import { $cloudOwnsUpdates } from '@/store/cloud-updates'
import { $connection } from '@/store/session'
import {
  $backendUpdateApply,
  $backendUpdateStatus,
  $desktopVersion,
  checkBackendUpdates,
  refreshDesktopVersion
} from '@/store/updates'

import { SettingsContent } from './primitives'
import { SETTING_IDS, settingElementId } from './settings-manifest'
import { UninstallSection } from './uninstall-section'
import { UpdateChannelRow } from './update-channel-row'
import { useSettingDeepLink } from './use-setting-deep-link'

interface AboutSettingsProps {
  subpage?: string
}

export function AboutSettings({ subpage }: AboutSettingsProps = {}): ReactElement {
  useSettingDeepLink('about', page => subpage === undefined || page === subpage)
  const { locale, t } = useI18n()
  const copy = aboutPageCopy(locale)
  const remoteAttentionId = useId()
  const version = useStore($desktopVersion)
  const connection = useStore($connection)
  const remoteStatus = useStore($backendUpdateStatus)
  const remoteApply = useStore($backendUpdateApply)
  const remote = connection?.mode === 'remote'
  // Hermes Cloud updates its agents itself: no checker, channel or Update button for what it owns.
  const cloudOwned = useStore($cloudOwnsUpdates)
  const showBackend = remote && !cloudOwned.backend

  const remoteAttention =
    showBackend &&
    Boolean(
      remoteStatus?.error ||
      remoteStatus?.retirement ||
      remoteStatus?.updateAvailable ||
      (remoteStatus?.behind ?? 0) > 0 ||
      remoteApply.applying ||
      remoteApply.stage === 'restart' ||
      remoteApply.error
    )

  useEffect((): void => {
    void refreshDesktopVersion()

    if (showBackend) {
      void checkBackendUpdates()
    }
  }, [connection, showBackend])

  return (
    <SettingsContent>
      <div className="about-page">
        <VersionHero variant="compact" version={version} />
        {!cloudOwned.client && (
          <section
            aria-label={t.settings.about.updates}
            className="about-update"
            id={settingElementId(SETTING_IDS.about.updates)}
          >
            <UpdateStatusCard target="client" variant="compact" version={version} />
          </section>
        )}
        <div className="about-links">
          <ExternalLink href={WEBSITE_URL} native showExternalIcon>
            {copy.website}
          </ExternalLink>
          <span aria-hidden>·</span>
          <ExternalLink href={RELEASES_URL} native showExternalIcon>
            {t.updates.releaseNotes}
          </ExternalLink>
        </div>
        <div className="about-utilities">
          <Dialog>
            <DialogTrigger asChild>
              <button
                aria-describedby={remoteAttention ? remoteAttentionId : undefined}
                aria-label={copy.installationInfo}
                className="about-utility-link"
                type="button"
              >
                {copy.installationInfo}
                {remoteAttention && (
                  <span
                    aria-label={copy.remoteAttention}
                    className="about-attention-dot"
                    id={remoteAttentionId}
                    role="img"
                  />
                )}
              </button>
            </DialogTrigger>
            <DialogContent
              aria-describedby={undefined}
              bodyClassName="about-installation-body"
              className="about-installation-dialog"
            >
              <DialogTitle>{copy.installationInfo}</DialogTitle>
              {version && (
                <>
                  <p className="about-installation-version">
                    {version.appVersion ? t.updates.version(version.appVersion) : t.updates.versionUnavailable}
                  </p>
                  <details className="about-technical-details">
                    <summary>{copy.technicalDetails}</summary>
                    <VersionDetails version={version} />
                  </details>
                </>
              )}
              {!cloudOwned.client && <UpdateChannelRow />}
              {showBackend && <UpdateStatusCard showReleaseNotes={false} target="backend" version={version} />}
              <DialogFooter>
                {version && (
                  <CopyButton
                    buttonSize="sm"
                    buttonVariant="outline"
                    label={copy.copyInfo}
                    text={JSON.stringify(version, null, 2)}
                  />
                )}
                <DialogClose asChild>
                  <Button size="sm">{copy.close}</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <UninstallSection defaultOpen={subpage === 'uninstall'} dialog />
        </div>
        <p className="about-copyright">{copy.copyright}</p>
      </div>
    </SettingsContent>
  )
}
