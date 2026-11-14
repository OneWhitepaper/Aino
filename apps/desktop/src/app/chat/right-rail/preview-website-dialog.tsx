import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { type ReactNode, type RefObject, useRef, useState } from 'react'

import {
  $activeTreeGroup,
  $hoveredTreeGroup,
  $layoutTree,
  $paneVisible,
  isPaneVisible
} from '@/components/pane-shell/tree/store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { $confirmRequest } from '@/store/confirm'
import { $rightRailActiveTabId } from '@/store/layout'
import { $visiblePreviewTabs } from '@/store/preview'
import { isBrowserWindow, windowBrowserTabId } from '@/store/windows'

import { activePreviewTabFor } from './preview-active-tab'
import { previewAgentCopy } from './preview-agent-i18n'
import { $previewWebsiteDialogs, $previewWebsiteFileChoosers } from './preview-native-actions'

interface PreviewWebsiteDialogProps {
  tabId: string
}
interface WebsiteDialogBodyProps {
  pending: ReturnType<typeof $previewWebsiteDialogs.get>[string]
  returnFocus: RefObject<HTMLElement | null>
  tabId: string
}
interface WebsiteDialogContentProps {
  busy: boolean
  children: ReactNode
  initialFocus: RefObject<HTMLElement | null>
  returnFocus: RefObject<HTMLElement | null>
  tabId: string
}
interface WebsiteFileChooserProps {
  pending: ReturnType<typeof $previewWebsiteFileChoosers.get>[string]
  returnFocus: RefObject<HTMLElement | null>
  tabId: string
}

const chooserCopy: Record<string, readonly [string, string, string, string]> = {
  en: ['Choose files for this website', 'Choose files', 'Choose one file.', 'Choose one or more files.'],
  zh: ['为此网站选择文件', '选择文件', '请选择一个文件。', '请选择一个或多个文件。'],
  'zh-hant': ['為此網站選擇檔案', '選擇檔案', '請選擇一個檔案。', '請選擇一個或多個檔案。'],
  ja: [
    'このサイトのファイルを選択',
    'ファイルを選択',
    'ファイルを1つ選択してください。',
    'ファイルを1つ以上選択してください。'
  ],
  ar: ['اختر ملفات لهذا الموقع', 'اختر ملفات', 'اختر ملفًا واحدًا.', 'اختر ملفًا واحدًا أو أكثر.'],
  de: [
    'Dateien für diese Website auswählen',
    'Dateien auswählen',
    'Wählen Sie eine Datei aus.',
    'Wählen Sie eine oder mehrere Dateien aus.'
  ],
  es: ['Elegir archivos para este sitio', 'Elegir archivos', 'Elige un archivo.', 'Elige uno o varios archivos.'],
  fr: [
    'Choisir des fichiers pour ce site',
    'Choisir des fichiers',
    'Choisissez un fichier.',
    'Choisissez un ou plusieurs fichiers.'
  ],
  ru: ['Выберите файлы для этого сайта', 'Выбрать файлы', 'Выберите один файл.', 'Выберите один или несколько файлов.']
}

const $foregroundPreviewTabId = computed(
  [$visiblePreviewTabs, $rightRailActiveTabId, $layoutTree, $activeTreeGroup, $hoveredTreeGroup],
  () => activePreviewTabFor()?.id
)

function WebsiteDialogContent({ busy, children, initialFocus, returnFocus, tabId }: WebsiteDialogContentProps) {
  return (
    <DialogContent
      data-preview-website-dialog
      dismissDisabled={busy}
      onCloseAutoFocus={event => {
        event.preventDefault()
        const poppedOut = isBrowserWindow() && windowBrowserTabId() === tabId

        const foreground =
          activePreviewTabFor()?.id === tabId && (!$layoutTree.get() || isPaneVisible(`preview-tile:${tabId}`))

        if ($confirmRequest.get() || (!poppedOut && !foreground)) {
          return
        }

        if (!globalThis.document.querySelector('[role="dialog"]')) {
          returnFocus.current?.focus()
        }
      }}
      onOpenAutoFocus={event => {
        event.preventDefault()
        const focused = globalThis.document.activeElement

        if (focused instanceof HTMLElement && !focused.closest('[data-preview-website-dialog]')) {
          returnFocus.current = focused
        }

        initialFocus.current?.focus()
      }}
      showCloseButton={false}
    >
      {children}
    </DialogContent>
  )
}

function WebsiteDialogBody({ pending, returnFocus, tabId }: WebsiteDialogBodyProps) {
  const { locale, t } = useI18n()
  const copy = previewAgentCopy(locale)
  const { dialog } = pending
  const [text, setText] = useState(pending.defaultText ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const responding = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  const respond = async (accept: boolean) => {
    if (responding.current) {
      return
    }

    responding.current = true
    setBusy(true)
    setError('')

    try {
      await pending.respond(accept, dialog.type === 'prompt' ? text : undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      responding.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          void respond(false)
        }
      }}
      open
    >
      <WebsiteDialogContent
        busy={busy}
        initialFocus={dialog.type === 'prompt' ? input : cancel}
        returnFocus={returnFocus}
        tabId={tabId}
      >
        <DialogHeader>
          <DialogTitle className="whitespace-pre-wrap text-sm">{dialog.message}</DialogTitle>
          <DialogDescription className="break-all text-xs">{dialog.url}</DialogDescription>
        </DialogHeader>
        {dialog.type === 'prompt' && (
          <input
            aria-label={dialog.message}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            disabled={busy}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
              }
            }}
            ref={input}
            type={dialog.sensitive ? 'password' : 'text'}
            value={text}
          />
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => {
              void respond(false)
            }}
            ref={cancel}
            type="button"
            variant="outline"
          >
            {t.common.cancel}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void respond(true)
            }}
            type="button"
          >
            {copy.allowLabel}
          </Button>
        </DialogFooter>
      </WebsiteDialogContent>
    </Dialog>
  )
}

function WebsiteFileChooser({ pending, returnFocus, tabId }: WebsiteFileChooserProps) {
  const { locale, t } = useI18n()
  const copy = chooserCopy[locale] ?? chooserCopy.en
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const responding = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)

  const run = async (choose: boolean) => {
    if (responding.current) {
      return
    }

    responding.current = true
    setBusy(true)
    setError('')

    try {
      await (choose ? pending.choose() : pending.cancel())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      responding.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          void run(false)
        }
      }}
      open
    >
      <WebsiteDialogContent busy={busy} initialFocus={cancel} returnFocus={returnFocus} tabId={tabId}>
        <DialogHeader>
          <DialogTitle>{copy[0]}</DialogTitle>
          <DialogDescription className="break-all text-xs">{pending.chooser.url}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">{copy[pending.chooser.multiple ? 3 : 2]}</p>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => {
              void run(false)
            }}
            ref={cancel}
            type="button"
            variant="outline"
          >
            {t.common.cancel}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void run(true)
            }}
            type="button"
          >
            {copy[1]}
          </Button>
        </DialogFooter>
      </WebsiteDialogContent>
    </Dialog>
  )
}

/** Public website prompt remains usable while the guest document is suspended. */
export function PreviewWebsiteDialog({ tabId }: PreviewWebsiteDialogProps) {
  const pending = useStore($previewWebsiteDialogs)[tabId]
  const chooser = useStore($previewWebsiteFileChoosers)[tabId]
  const confirmation = useStore($confirmRequest)
  const selectedTabId = useStore($foregroundPreviewTabId)
  const tree = useStore($layoutTree)
  const visible = useStore($paneVisible(`preview-tile:${tabId}`))
  const returnFocus = useRef<HTMLElement | null>(null)

  const foreground =
    (isBrowserWindow() && windowBrowserTabId() === tabId) || (selectedTabId === tabId && (!tree || visible))

  if (confirmation || !foreground) {
    return null
  }

  if (pending) {
    return <WebsiteDialogBody key={pending.dialog.id} pending={pending} returnFocus={returnFocus} tabId={tabId} />
  }

  return chooser ? (
    <WebsiteFileChooser key={chooser.chooser.id} pending={chooser} returnFocus={returnFocus} tabId={tabId} />
  ) : null
}
