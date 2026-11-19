export interface PreviewBrowserApp {
  id: string
  name: string
  icon?: string
}

export interface PreviewBrowserAppsBridge {
  list: () => Promise<PreviewBrowserApp[]>
  open: (id: string, data: Uint8Array) => Promise<void>
}
