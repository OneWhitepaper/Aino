export interface PreviewBrowserDialog {
  id: string
  type: string
  message: string
  url: string
  sensitive: boolean
  state: 'pending' | 'accepted' | 'dismissed' | 'closed'
}

export interface PreviewBrowserFileChooser {
  id: string
  url: string
  multiple: boolean
  frame_id?: string
  state: 'pending' | 'completed' | 'cancelled' | 'closed'
}

export interface PreviewBrowserDownload {
  id: string
  url: string
  filename: string
  state: 'progressing' | 'interrupted' | 'completed' | 'cancelled'
  received_bytes: number
  total_bytes: number
  path?: string
}

export interface PreviewBrowserInteractionRequest {
  action:
    | 'watch'
    | 'release'
    | 'revoke'
    | 'dialog_status'
    | 'dialog_respond'
    | 'dialog_manual'
    | 'dialog_manual_status'
    | 'upload_prepare'
    | 'upload_commit'
    | 'upload_cancel'
    | 'downloads_status'
    | 'download_prepare'
    | 'download_commit'
    | 'download_cancel'
    | 'chooser_manual'
    | 'chooser_cancel'
  scope: string
  authorization?: string
  chooserId?: string
  dialogId?: string
  accept?: boolean
  promptText?: string
  paths?: string[]
  downloadPath?: string
  downloadId?: string
  ticket?: string
}

export interface PreviewBrowserInteractionResult {
  success: boolean
  dialog_control?: 'aino' | 'system'
  note?: string
  url?: string
  error?: string
  dialogs?: PreviewBrowserDialog[]
  file_chooser?: PreviewBrowserFileChooser
  downloads?: PreviewBrowserDownload[]
  upload?: { state: 'prepared' | 'completed'; paths: string[]; filenames: string[] }
  download_path?: string
  ticket?: string
  default_text?: string
}
