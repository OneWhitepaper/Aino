import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { PreviewSigninsResult } from '@/global'
import { type ProfileScope, profileScopeKey, saveHermesConfigRecord } from '@/hermes'
import { useI18n } from '@/i18n'
import { claimPreviewSigninsSync, syncPreviewSignins } from '@/lib/preview-signins'
import { $activeConnectionId } from '@/store/connections'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'

import { hermesConfigCacheWriter, useHermesConfigRecord } from '../hooks/use-config-record'

import { RowFootnoteAction, ToggleRow } from './primitives'

interface BrowserRealProfilePanelProps {
  /** Capabilities profile-scope override — the toggle reads/writes THIS
   *  profile's config.yaml instead of the app-wide active one. */
  profile?: ProfileScope
}

/** Shared with the Browser pane's first-open consent prompt, so both surfaces
 *  agree on what "on" means for `browser.use_real_profile`. */
export function readUseRealProfile(record: Record<string, unknown> | undefined): boolean {
  const browser = record?.browser

  if (browser && typeof browser === 'object' && !Array.isArray(browser)) {
    return Boolean((browser as Record<string, unknown>).use_real_profile)
  }

  return false
}

/**
 * The `browser.use_real_profile` consent toggle, rendered at the top of the
 * Capabilities → Tools → Browser detail pane (above the backend/provider
 * matrix). This is the GUI home of the real-profile browsing switch: without
 * it the only desktop path was the generic Settings → Config editor, which
 * users reasonably never found ("no toggle in the browser section").
 *
 * Semantics mirror the config comment: turning it ON consents to snapshotting
 * the default browser's profile (cookies/logins) into a Hermes-owned copy;
 * turning it OFF deletes the snapshot store on next use. The toggle writes
 * config.yaml through the same deep-merging PUT /api/config every other
 * settings surface uses — applies to new sessions. It also signs the in-app
 * Browser tab in with the profile's cookies (Electron main imports them for a
 * local backend; off removes them), and "Re-import sign-ins" refreshes them.
 */
export function BrowserRealProfilePanel({ profile }: BrowserRealProfilePanelProps) {
  const { t } = useI18n()
  const copy = t.settings.toolsets.browserRealProfile
  const { data: config, writeScope } = useHermesConfigRecord(profile)
  const setConfig = hermesConfigCacheWriter(profile)
  const [busy, setBusy] = useState(false)
  const connectionId = useStore($activeConnectionId)
  const activeProfile = useStore($activeGatewayProfile)
  const profileKey = profileScopeKey(profile)
  const revision = useRef(0)

  // eslint-disable-next-line no-restricted-syntax -- invalidates pending request generations; does not mirror an atom
  useEffect(() => {
    setBusy(false)

    return () => {
      // A pending save still belongs to its original writeScope. Its rollback
      // must not use the cache writer after this panel changes owners.
      revision.current += 1
    }
  }, [activeProfile, connectionId, profileKey])

  const enabled = readUseRealProfile(config)

  const reportSignins = useCallback(
    (result: null | PreviewSigninsResult, announce: boolean) => {
      if (!result) {
        return
      }

      if (result.status === 'error') {
        notify({ kind: 'warning', title: copy.signinsFailed, message: result.error || '' })
      } else if (result.status === 'imported' && (announce || result.imported > 0)) {
        notify({ kind: 'info', title: copy.signinsImportedTitle, message: copy.signinsImported(result.imported) })
      } else if (result.status === 'remote' && announce) {
        notify({ kind: 'info', title: copy.signinsImportedTitle, message: copy.signinsRemote })
      }
    },
    [copy]
  )

  const reimport = useCallback(async () => {
    const version = revision.current
    const isCurrent = () =>
      revision.current === version &&
      $activeConnectionId.get() === connectionId &&
      $activeGatewayProfile.get() === activeProfile
    setBusy(true)

    try {
      const result = await syncPreviewSignins(true, writeScope)

      if (isCurrent()) {
        reportSignins(result, true)
      }
    } catch (err) {
      if (isCurrent()) {
        notifyError(err, copy.signinsFailed)
      }
    } finally {
      if (isCurrent()) {
        setBusy(false)
      }
    }
  }, [activeProfile, connectionId, copy, reportSignins, writeScope])

  const toggle = useCallback(
    async (on: boolean) => {
      if (!config) {
        return
      }

      const browser =
        config.browser && typeof config.browser === 'object' && !Array.isArray(config.browser)
          ? (config.browser as Record<string, unknown>)
          : {}

      const next = { ...config, browser: { ...browser, use_real_profile: on } }
      const version = revision.current

      const isCurrent = () =>
        revision.current === version &&
        $activeConnectionId.get() === connectionId &&
        $activeGatewayProfile.get() === activeProfile

      setBusy(true)
      claimPreviewSigninsSync(on, writeScope)
      setConfig(next)

      try {
        // Sparse patch: PUT /api/config deep-merges, and echoing the cached
        // snapshot would overwrite keys other surfaces changed since it loaded.
        await saveHermesConfigRecord({ browser: { use_real_profile: on } }, writeScope ?? profile)

        if (!isCurrent()) {
          return
        }

        notify({
          kind: 'info',
          title: on ? copy.enabledTitle : copy.disabledTitle,
          message: on ? copy.enabledMessage : copy.disabledMessage
        })
        // After the save: the backend re-checks the key it just wrote before exporting anything.
        const result = await syncPreviewSignins(on, writeScope)

        if (isCurrent()) {
          reportSignins(result, false)
        }
      } catch (err) {
        if (isCurrent()) {
          setConfig(config)
          notifyError(err, copy.failedSave)
        }
      } finally {
        if (isCurrent()) {
          setBusy(false)
        }
      }
    },
    [activeProfile, config, connectionId, copy, profile, reportSignins, setConfig, writeScope]
  )

  return (
    <ToggleRow
      below={
        enabled ? (
          <RowFootnoteAction onClick={() => void reimport()}>{copy.reimportSignins}</RowFootnoteAction>
        ) : undefined
      }
      checked={enabled}
      description={copy.description}
      disabled={busy || !config}
      label={copy.label}
      onChange={on => void toggle(on)}
    />
  )
}
