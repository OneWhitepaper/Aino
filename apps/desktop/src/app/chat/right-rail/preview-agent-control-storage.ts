import { onPersistenceEvent, readKey, writeKey } from '@/lib/storage'

const CONTROL_PREFIX = 'hermes.desktop.previewControl.tab.v1:'
const TABS_KEY = 'hermes.desktop.previewTabs.v2'
const RELAY_TYPE = 'preview-agent-control-change'

export function storedPreviewHumanControl(tabId: string): boolean {
  return readKey(CONTROL_PREFIX + tabId) === 'human'
}

export function storedPreviewHumanTabs(): string[] {
  const tabs: string[] = []

  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index)

      if (key?.startsWith(CONTROL_PREFIX) && readKey(key) === 'human') {
        tabs.push(key.slice(CONTROL_PREFIX.length))
      }
    }
  } catch {
    // A renderer with unavailable storage still retains its local control state.
  }

  return tabs
}

export function persistPreviewHumanControl(tabId: string, human: boolean): void {
  writeKey(CONTROL_PREFIX + tabId, human ? 'human' : null)
  window.hermesDesktop?.windowRelay?.send({ type: RELAY_TYPE, tabId })
}

function storedTabIds(raw: null | string): Set<string> | null {
  if (raw === null) {
    return new Set()
  }

  try {
    const stored: unknown = JSON.parse(raw)

    if (!stored || typeof stored !== 'object') {
      return null
    }

    const tabs: unknown[] = Array.isArray(stored) ? stored : Object.values(stored).flat()

    return new Set(
      tabs.flatMap(tab => (tab && typeof tab === 'object' && 'id' in tab && typeof tab.id === 'string' ? [tab.id] : []))
    )
  } catch {
    return null
  }
}

/** Storage owns the tab mode; the existing relay only asks sibling renderers to refresh it. */
export function watchPreviewHumanControl(onChange: (tabId: string, human: boolean) => void): () => void {
  let previousTabs = storedTabIds(readKey(TABS_KEY))
  const refresh = (tabId: string) => onChange(tabId, storedPreviewHumanControl(tabId))

  const tabsChanged = (raw: null | string) => {
    const next = storedTabIds(raw)

    if (next) {
      const removed = [...(previousTabs ?? [])].filter(tabId => !next.has(tabId))
      previousTabs = next

      for (const tabId of removed) {
        persistPreviewHumanControl(tabId, false)
      }
    }
  }

  const storageChanged = (key: null | string, value: null | string) => {
    if (key?.startsWith(CONTROL_PREFIX)) {
      refresh(key.slice(CONTROL_PREFIX.length))
    } else if (key === TABS_KEY) {
      tabsChanged(value)
    }
  }

  const stopPersistence = onPersistenceEvent(event => {
    if (event.op !== 'read') {
      if (event.key.startsWith(CONTROL_PREFIX)) {
        onChange(event.key.slice(CONTROL_PREFIX.length), event.value === 'human')
      } else {
        storageChanged(event.key, event.value)
      }
    }
  })

  const onStorage = (event: StorageEvent) => storageChanged(event.key, event.newValue)
  window.addEventListener('storage', onStorage)

  const stopRelay = window.hermesDesktop?.windowRelay?.onMessage(payload => {
    if (
      payload &&
      typeof payload === 'object' &&
      'type' in payload &&
      payload.type === RELAY_TYPE &&
      'tabId' in payload &&
      typeof payload.tabId === 'string'
    ) {
      refresh(payload.tabId)
    }
  })

  return () => {
    stopPersistence()
    stopRelay?.()
    window.removeEventListener('storage', onStorage)
  }
}
