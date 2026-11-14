import type { Session } from 'electron'

export interface PreviewGuestOwner {
  getType: () => string
  isDestroyed: () => boolean
}

export interface PreviewOwnedGuest extends PreviewGuestOwner {
  hostWebContents?: PreviewGuestOwner | null
  session?: Session
}

interface NativePreviewRegistration {
  owner: PreviewGuestOwner | null
  listeners: Set<() => void>
}

const previewGuestSessions = new WeakSet<Session>()
const nativeGuests = new WeakMap<PreviewOwnedGuest, NativePreviewRegistration>()

/** Only the preview-family attach/create path admits a cookie jar. */
export function admitPreviewGuestSession(session: Session): void {
  previewGuestSessions.add(session)
}

export function isPreviewGuestSession(session: Session | undefined): boolean {
  return Boolean(session && previewGuestSessions.has(session))
}

/** A native view has no hostWebContents; its explicit registration is authority. */
export function isOwnedPreviewGuest<T extends PreviewOwnedGuest>(
  owner: PreviewGuestOwner,
  guest: T | null | undefined
): guest is T {
  if (
    owner.isDestroyed() ||
    owner.getType() !== 'window' ||
    !guest ||
    guest.isDestroyed() ||
    !isPreviewGuestSession(guest.session)
  ) {
    return false
  }

  const native = nativeGuests.get(guest)

  return native ? native.owner === owner : guest.getType() === 'webview' && guest.hostWebContents === owner
}

function assertNativeOwner(guest: PreviewOwnedGuest, owner: PreviewGuestOwner): void {
  if (
    guest === owner ||
    guest.isDestroyed() ||
    owner.isDestroyed() ||
    owner.getType() !== 'window' ||
    !isPreviewGuestSession(guest.session)
  ) {
    throw new Error('Invalid native preview owner or session')
  }
}

/** Called only by the main-process native preview service, never by renderer IPC. */
export function registerNativePreviewGuest(guest: PreviewOwnedGuest, owner: PreviewGuestOwner): () => void {
  assertNativeOwner(guest, owner)

  if (nativeGuests.has(guest)) {
    throw new Error('Native preview guest is already registered')
  }

  const registration = { owner, listeners: new Set<() => void>() }
  nativeGuests.set(guest, registration)

  return () => {
    if (nativeGuests.get(guest) !== registration) {
      return
    }

    nativeGuests.delete(guest)

    for (const listener of [...registration.listeners]) {
      listener()
    }

    registration.listeners.clear()
  }
}

/** Transfer ownership before notifying leases, so stale senders fail immediately. */
export function setNativePreviewOwner(guest: PreviewOwnedGuest, owner: PreviewGuestOwner | null): void {
  if (owner) {
    assertNativeOwner(guest, owner)
  }

  const registration = nativeGuests.get(guest)

  if (!registration) {
    throw new Error('Native preview guest is not registered')
  }

  if (registration.owner === owner) {
    return
  }

  registration.owner = owner

  for (const listener of [...registration.listeners]) {
    listener()
  }
}

/** Legacy webviews never transfer; their existing lifecycle listeners remain authority. */
export function watchNativePreviewOwner(guest: PreviewOwnedGuest, listener: () => void): () => void {
  const registration = nativeGuests.get(guest)
  registration?.listeners.add(listener)

  return () => registration?.listeners.delete(listener)
}

export function nativePreviewOwner(guest: PreviewOwnedGuest): PreviewGuestOwner | null | undefined {
  return nativeGuests.get(guest)?.owner
}
