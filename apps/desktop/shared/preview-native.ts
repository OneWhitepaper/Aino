/** The existing Browser surface's native lifetime/attachment contract. */
export const NATIVE_PREVIEW_RETAIN_LIMIT = 8

export interface NativePreviewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface NativePreviewMountRequest {
  tabId: string
  partition: string
  url: string
  bounds: NativePreviewBounds
  visible?: boolean
}

export interface NativePreviewSnapshot {
  token: string
  webContentsId: number
  url: string
  title: string
  back: boolean
  forward: boolean
  loading: boolean
  ready: boolean
  zoom: number
  zoomMode?: 'fit' | 'manual'
  muted: boolean
  loadFailure?: { code?: number; description: string; url: string }
}

export interface NativePreviewEvent {
  token: string
  type: string
  snapshot?: NativePreviewSnapshot
  [key: string]: unknown
}

export type NativePreviewCommand =
  | 'loadURL' | 'reload' | 'reloadIgnoringCache' | 'goBack' | 'goForward' | 'focus'
  | 'sendInputEvent' | 'openDevTools' | 'closeDevTools' | 'copy' | 'cut' | 'paste'
  | 'selectAll' | 'inspectElement' | 'replaceMisspelling' | 'setAudioMuted' | 'setPageZoom'

export interface NativePreviewBridge {
  mount: (request: NativePreviewMountRequest) => Promise<NativePreviewSnapshot>
  layout: (token: string, bounds: NativePreviewBounds, visible: boolean) => void
  command: (token: string, command: NativePreviewCommand, args: unknown[]) => Promise<unknown>
  release: (token: string) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  onEvent: (callback: (event: NativePreviewEvent) => void) => () => void
}
