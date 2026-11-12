import { useEffect, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'

import { ToggleRow } from './primitives'
import { SETTING_IDS, settingElementId } from './settings-manifest'

export interface KeychainEncryption {
  busy: boolean
  on: boolean
  set: (on: boolean) => Promise<void>
  /** Both IPC halves exist; the browser host's bridge has neither. */
  supported: boolean
}

/**
 * Opt-in OS-keychain encryption for stored gateway secrets. Read lazily via
 * IPC (never touches the keychain); flipping it re-encodes stored secrets in
 * the main process and can legitimately prompt for keychain access.
 */
export function useKeychainEncryption(): KeychainEncryption {
  const { t } = useI18n()
  const g = t.settings.gateway
  const [keychainEncryption, setKeychainEncryptionState] = useState(false)
  const [keychainEncryptionBusy, setKeychainEncryptionBusy] = useState(false)
  const scope = useRef({ revision: 0, active: false }).current

  useEffect(() => {
    scope.active = true
    const request = ++scope.revision

    void window.hermesDesktop
      ?.getSecretStorageEncryption?.()
      .then(res => {
        if (scope.active && request === scope.revision && res) {
          setKeychainEncryptionState(res.on === true)
        }
      })
      .catch(() => {})

    return () => {
      scope.active = false
    }
  }, [scope])

  const setKeychainEncryption = async (on: boolean) => {
    const desktop = window.hermesDesktop
    const setEncryption = desktop?.setSecretStorageEncryption

    if (!setEncryption) {
      return
    }

    const request = ++scope.revision
    const previous = keychainEncryption
    setKeychainEncryptionBusy(true)
    // Optimistic paint; the IPC result (or a failure rollback) gets the last word.
    setKeychainEncryptionState(on)

    try {
      const res = await setEncryption(on)

      if (scope.active && request === scope.revision) {
        setKeychainEncryptionState(res?.on === true)
      }
    } catch (err) {
      if (!scope.active || request !== scope.revision) {
        return
      }

      // Native may have safely retained encryption after a partial rewrite.
      const actual = await desktop?.getSecretStorageEncryption?.().catch(() => null)

      if (scope.active && request === scope.revision) {
        setKeychainEncryptionState(actual ? actual.on === true : previous)
        notifyError(err, g.keychainEncryptionFailed)
      }
    } finally {
      if (scope.active && request === scope.revision) {
        setKeychainEncryptionBusy(false)
      }
    }
  }

  return {
    busy: keychainEncryptionBusy,
    on: keychainEncryption,
    set: setKeychainEncryption,
    supported:
      typeof window.hermesDesktop?.getSecretStorageEncryption === 'function' &&
      typeof window.hermesDesktop?.setSecretStorageEncryption === 'function'
  }
}

export function KeychainEncryptionSetting({ keychain }: { keychain: KeychainEncryption }) {
  const { t } = useI18n()
  const g = t.settings.gateway

  if (!keychain.supported) {
    return null
  }

  return (
    <ToggleRow
      checked={keychain.on}
      description={g.keychainEncryptionDesc}
      disabled={keychain.busy}
      id={settingElementId(SETTING_IDS.gateway.keychainEncryption)}
      label={g.keychainEncryptionTitle}
      onChange={on => void keychain.set(on)}
    />
  )
}
