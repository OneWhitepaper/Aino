import { applyDocumentLocale, isRecord } from '@hermes/shared/i18n'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { getHermesConfigRecord, type HermesConfigRecord, retainConfigReadOrigin, saveHermesConfig } from '@/hermes'
import { brandTranslationTree } from '@/lib/brand'

import { TRANSLATIONS } from './catalog'
import {
  DEFAULT_LOCALE,
  isSupportedLocaleValue,
  localeConfigValue,
  normalizeLocale,
  resolveInitialLocale
} from './languages'
import { setRuntimeI18nLocale } from './runtime'
import type { Locale, Translations } from './types'

export { LOCALE_META } from './languages'

export interface I18nConfigClient {
  getConfig: () => Promise<HermesConfigRecord>
  saveConfig: (config: HermesConfigRecord) => Promise<{ ok: boolean }>
}

const defaultConfigClient: I18nConfigClient = {
  getConfig: () => {
    if (typeof window === 'undefined' || !window.hermesDesktop?.api) {
      return Promise.resolve({})
    }

    // Merged defaults make an unset language indistinguishable from saved English.
    // Older backends ignore the option and keep returning English as before.
    return getHermesConfigRecord(undefined, { includeDefaults: false })
  },
  saveConfig: config => {
    if (typeof window === 'undefined' || !window.hermesDesktop?.api) {
      return Promise.resolve({ ok: true })
    }

    // No explicit scope: saveHermesConfig resolves the record's captured read
    // origin itself (resolveConfigWriteScope), and withConfigDisplayLanguage
    // retains that origin onto the derived record.
    return saveHermesConfig(config, undefined, { preserveLanguage: true })
  }
}

export function getConfigDisplayLanguage(config: HermesConfigRecord): unknown {
  return isRecord(config.display) ? config.display.language : undefined
}

export function withConfigDisplayLanguage(config: HermesConfigRecord, locale: Locale): HermesConfigRecord {
  const display = isRecord(config.display) ? config.display : {}

  return retainConfigReadOrigin(
    {
      ...config,
      display: {
        ...display,
        language: localeConfigValue(locale)
      }
    },
    config
  )
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export interface I18nContextValue {
  configLoadError: Error | null
  isLoadingConfig: boolean
  isSavingLocale: boolean
  locale: Locale
  saveError: Error | null
  setLocale: (next: Locale) => Promise<void>
  t: Translations
}

const I18nContext = createContext<I18nContextValue>({
  configLoadError: null,
  isLoadingConfig: false,
  isSavingLocale: false,
  locale: DEFAULT_LOCALE,
  saveError: null,
  setLocale: async () => {},
  // Keep components branded even when rendered outside the provider (for
  // example, an Electron error/first-run overlay mounted during bootstrap or
  // a lightweight host that does not install the React provider).
  t: brandTranslationTree(TRANSLATIONS[DEFAULT_LOCALE])
})

export interface I18nProviderProps {
  children: ReactNode
  configClient?: I18nConfigClient | null
  initialLocale?: unknown
}

export function I18nProvider({ children, configClient = defaultConfigClient, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => normalizeLocale(initialLocale))
  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [isSavingLocale, setIsSavingLocale] = useState(false)
  const [configLoadError, setConfigLoadError] = useState<Error | null>(null)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const [configResolved, setConfigResolved] = useState(() => !configClient)
  const localeRef = useRef(locale)
  // Set once the user picks a language through setLocale: a startup read that
  // resolves (or fails) after that must never overwrite an explicit choice.
  const userLocaleRef = useRef(false)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    localeRef.current = locale
    setRuntimeI18nLocale(locale)
    applyDocumentLocale(locale)

    // Electron menus and native dialogs sit outside React's tree. Keep the
    // main-process mirror best-effort so an older shell (or a non-Electron
    // test/browser host) remains fully usable when the optional bridge is
    // absent. When a config client exists, wait until its persisted language
    // has been resolved so the initial English state does not briefly replace
    // an OS-native Chinese menu before the real preference arrives.
    if (configClient && !configResolved) {
      return
    }

    const syncNativeLocale = typeof window !== 'undefined' ? window.hermesDesktop?.setLocale : undefined

    if (syncNativeLocale) {
      void Promise.resolve()
        .then(() => syncNativeLocale(locale))
        .catch(() => {
          // Native copy is an enhancement; renderer localization must not wait
          // on or fail because an older Electron main process lacks the channel.
        })
    }
  }, [configClient, configResolved, locale])

  useEffect(() => {
    if (!configClient) {
      return
    }

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryCount = 0

    setConfigResolved(false)
    // The desktop races its own backend at startup: the renderer mounts before
    // the backend is ready, so the first /api/config call can time out. We keep
    // the established permanent-failure contract — a rejected config load
    // settles on English so the UI stays usable — but bounded retries recover
    // transient startup failures, applying the persisted display.language once
    // the backend comes up.
    const MAX_LOCALE_RETRIES = 10
    const LOCALE_RETRY_DELAY_MS = 3_000

    const loadLocale = () => {
      setIsLoadingConfig(true)
      setConfigLoadError(null)

      return configClient
        .getConfig()
        .then(async config => {
          if (cancelled || userLocaleRef.current) {
            return
          }

          const saved = getConfigDisplayLanguage(config)

          // A saved choice needs no machine probe and always takes precedence.
          if (isSupportedLocaleValue(saved)) {
            setLocaleState(normalizeLocale(saved))

            return
          }

          // Keep inference unsaved so OS language changes apply on the next boot
          // until the user explicitly picks a language.
          const machineProfile = await window.hermesDesktop?.getMachineProfile?.().catch(() => null)

          if (!cancelled && !userLocaleRef.current) {
            setLocaleState(resolveInitialLocale(undefined, machineProfile?.locale))
          }
        })
        .catch(error => {
          if (cancelled || userLocaleRef.current) {
            return
          }

          setConfigLoadError(toError(error))
          setLocaleState(DEFAULT_LOCALE)

          if (retryCount < MAX_LOCALE_RETRIES) {
            retryCount += 1
            retryTimer = setTimeout(() => {
              loadLocale()
            }, LOCALE_RETRY_DELAY_MS)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setConfigResolved(true)
            setIsLoadingConfig(false)
          }
        })
    }

    loadLocale()

    return () => {
      cancelled = true

      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [configClient, initialLocale])

  const setLocale = useCallback(
    async (next: Locale) => {
      const previousLocale = localeRef.current

      userLocaleRef.current = true
      setSaveError(null)
      setLocaleState(next)

      if (!configClient) {
        return
      }

      setIsSavingLocale(true)

      try {
        const latestConfig = await configClient.getConfig()
        const result = await configClient.saveConfig(withConfigDisplayLanguage(latestConfig, next))

        if (!result.ok) {
          throw new Error(TRANSLATIONS[next].language.saveError)
        }
      } catch (error) {
        const nextError = toError(error)

        setLocaleState(previousLocale)
        setSaveError(nextError)

        throw nextError
      } finally {
        setIsSavingLocale(false)
      }
    },
    [configClient]
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      configLoadError,
      isLoadingConfig,
      isSavingLocale,
      locale,
      saveError,
      setLocale,
      // Locale files intentionally track upstream Hermes so future syncs stay
      // low-conflict. Apply the Aino product overlay at the React boundary so
      // every user-facing string (including newly added upstream keys) uses
      // the configured product identity while compatibility snippets inside
      // code spans remain untouched.
      t: brandTranslationTree(TRANSLATIONS[locale])
    }),
    [configLoadError, isLoadingConfig, isSavingLocale, locale, saveError, setLocale]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
