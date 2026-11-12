import { Alert, AlertDescription, Button, Codicon, randomUuid } from '@hermes/plugin-sdk'
import { type Ref, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'

import { downloadCanonicalAttachment } from './canonical-attachment-download'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { type CanonicalGroupBinding, canonicalGroupRequest } from './canonical-groups'

export interface CanonicalGroupAttachment {
  attachment_id?: string
  event_id?: string
  kind: string
  name: string
  mime: string
  size?: number
}
type Attachment = CanonicalGroupAttachment
interface DownloadedAttachment extends Attachment {
  data_base64: string
}
export interface CanonicalGroupUploader {
  upload: (files: File[]) => void
  pick: () => void
}

export async function fetchCanonicalGroupAttachment(
  binding: CanonicalGroupBinding,
  eventId: string,
  attachmentId: string
) {
  const result = await canonicalGroupRequest<DownloadedAttachment>(binding, 'groups.attachment.download', {
    room_id: binding.roomId,
    event_id: eventId,
    attachment_id: attachmentId
  })

  return {
    name: result.name,
    mime: result.mime,
    bytes: Uint8Array.from(atob(result.data_base64), char => char.charCodeAt(0))
  }
}

function kindFor(file: File): string {
  if (file.type.startsWith('image/')) {
    return 'image'
  }

  if (file.type === 'application/pdf') {
    return 'pdf'
  }

  return 'file'
}

export function CanonicalGroupAttachments({
  binding,
  attachments,
  onChange,
  onUploadingChange,
  disabled,
  readOnly = false,
  trigger = 'button',
  uploads = true,
  downloads = true,
  ref
}: {
  binding: CanonicalGroupBinding
  attachments: Attachment[]
  disabled: boolean
  trigger?: 'button' | 'none'
  uploads?: boolean
  downloads?: boolean
  // C21: the form holds Send while a selected file's manifest is not committed yet.
  onUploadingChange?: (uploading: boolean) => void
  // Paste and drop in the composer reuse this upload path.
  ref?: Ref<CanonicalGroupUploader>
} & ({ readOnly: true; onChange?: never } | { readOnly?: false; onChange: (attachments: Attachment[]) => void })) {
  const labels = useCanonicalGroupLabels()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  // Files still to upload in the running batch; a paste or drop during it joins instead of being lost.
  const queued = useRef<File[] | null>(null)

  useLayoutEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller

    if (disabled) {
      controller.abort()
    }

    setBusy(false)

    return () => controller.abort()
  }, [binding.connectionId, binding.profile, binding.roomId, disabled, readOnly])

  useImperativeHandle(ref, () => ({
    upload: files => {
      if (!disabled) {
        void upload(files)
      }
    },
    pick: () => {
      if (!disabled && !busy) {
        input.current?.click()
      }
    }
  }))

  async function upload(files: File[]) {
    if (readOnly) {
      return
    }

    if (queued.current) {
      queued.current.push(...files)

      return
    }

    const pending = [...files]
    queued.current = pending
    setBusy(true)
    setError('')
    onUploadingChange?.(true)
    let next = attachments

    try {
      for (let file = pending.shift(); file; file = pending.shift()) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',', 2)[1])
          reader.onerror = () => reject(reader.error ?? new Error(labels.uploadFailed))
          reader.readAsDataURL(file)
        })

        const result = await canonicalGroupRequest<Attachment>(binding, 'groups.attachment.upload', {
          room_id: binding.roomId,
          upload_id: randomUuid(),
          kind: kindFor(file),
          name: file.name,
          mime: file.type || 'application/octet-stream',
          data_base64: data
        })

        // Upload receipts include storage metadata; Send accepts only the manifest.
        const { attachment_id, kind, name, mime, size } = result
        next = [...next, { attachment_id, kind, name, mime, size }]
        onChange?.(next)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      queued.current = null
      setBusy(false)
      onUploadingChange?.(false)
    }
  }

  async function download(attachment: Attachment) {
    const signal = lifetime.current?.signal

    if (!signal || signal.aborted || !attachment.attachment_id || !attachment.event_id) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await fetchCanonicalGroupAttachment(binding, attachment.event_id, attachment.attachment_id)

      if (signal.aborted) {
        return
      }

      downloadCanonicalAttachment(result.bytes, result.name, result.mime, signal)
    } catch (e) {
      if (!signal.aborted) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (!signal.aborted) {
        setBusy(false)
      }
    }
  }

  return (
    <div className="aino-group-attachments">
      {!readOnly && uploads && (
        <>
          <input
            hidden
            multiple
            onChange={e => {
              const files = [...(e.target.files ?? [])]

              if (files.length) {
                void upload(files)
              }

              e.currentTarget.value = ''
            }}
            ref={input}
            type="file"
          />
          {trigger === 'button' && (
            <Button disabled={disabled || busy} onClick={() => input.current?.click()} type="button" variant="ghost">
              <Codicon name="attach" />
              {labels.attachFiles}
            </Button>
          )}
        </>
      )}
      {attachments.map(a => (
        <span className="aino-group-attachment" key={`${a.event_id ?? ''}:${a.attachment_id ?? a.name}`}>
          <Codicon name={a.kind === 'image' ? 'file-media' : 'file'} />
          <span className="aino-group-attachment-name" title={a.name}>
            {a.name}
          </span>
          {readOnly && (
            <Button
              aria-label={`${labels.download} ${a.name}`}
              disabled={disabled || busy || !downloads || !a.attachment_id || !a.event_id}
              onClick={() => void download(a)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Codicon name="cloud-download" />
            </Button>
          )}
          {!readOnly && (
            <Button
              aria-label={labels.removeAttachment}
              disabled={disabled || busy}
              onClick={() => onChange?.(attachments.filter(item => item !== a))}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Codicon name="close" />
            </Button>
          )}
        </span>
      ))}
      {error && (
        <Alert variant="destructive">
          <Codicon aria-hidden className="mt-0.5 text-destructive" name="error" />
          <AlertDescription>
            {labels.uploadFailed}: {error}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
