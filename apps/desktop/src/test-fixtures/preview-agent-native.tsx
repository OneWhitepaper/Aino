import '@/styles.css'

import { createRoot } from 'react-dom/client'

import { runPreviewAgentAction } from '@/app/chat/right-rail/preview-agent'
import { PreviewAgentStatus } from '@/app/chat/right-rail/preview-agent-status'
import { beginPreviewApproval } from '@/app/chat/right-rail/preview-approval'
import { type PreviewInputEvent, registerPreviewInput, toWebviewInputSpace } from '@/app/chat/right-rail/preview-input'
import { installPreviewNativeActions } from '@/app/chat/right-rail/preview-native-actions'
import {
  type PreviewScriptRunner,
  registerPreviewScriptRunner,
  watchPreviewDocumentLifecycle
} from '@/app/chat/right-rail/preview-script-runner'
import { ConfirmHost } from '@/components/confirm-host'
import type { PreviewActAction, PreviewActResult } from '@/lib/preview-act/types'
import { $confirmRequest } from '@/store/confirm'
import { $rightRailActiveTabId } from '@/store/layout'
import { newBrowserTab } from '@/store/preview'

import type {
  PreviewBrowserInteractionRequest,
  PreviewBrowserInteractionResult
} from '../../shared/preview-browser-interactions'

interface FixtureBridge {
  begin(guest: number): Promise<number>
  end(token: number): Promise<void>
  script(token: number, code: string): Promise<unknown>
  capture(guest: number): Promise<string>
  arm(token: number): Promise<void>
  validate(token: number): Promise<void>
  input(token: number, input: PreviewInputEvent): Promise<void>
  native(guest: number, request: PreviewBrowserInteractionRequest): Promise<PreviewBrowserInteractionResult>
  onDialog: NonNullable<NonNullable<Window['hermesDesktop']>['onPreviewBrowserDialog']>
  onChooser: NonNullable<NonNullable<Window['hermesDesktop']>['onPreviewFileChooser']>
}

type Action = Omit<PreviewActAction, 'kind'> & { kind: string }
interface FixtureApi {
  run(action: Action): Promise<PreviewActResult>
  start(action: Action): void
  finish(): Promise<PreviewActResult> | undefined
  pending(): unknown
  approve(): Promise<void>
  zoom(value: number): void
  tabId: string
  ready: boolean
}

const fixtureWindow = window as unknown as Window & {
  previewFixtureBridge: FixtureBridge
  previewNativeFixture: FixtureApi
}

const bridge = fixtureWindow.previewFixtureBridge
newBrowserTab()
const tabId = $rightRailActiveTabId.get()!

const view = document.createElement('webview') as HTMLElement & {
  getWebContentsId(): number
  sendInputEvent(event: unknown): void
  getZoomFactor(): number
  setZoomFactor(value: number): void
  focus(): void
}

view.setAttribute('partition', 'persist:hermes-preview-native-fixture')
view.setAttribute('src', new URLSearchParams(location.search).get('guest')!)
view.setAttribute('style', 'display:flex;width:900px;height:620px')
watchPreviewDocumentLifecycle(view, tabId)

async function activity<T>(operation: (token: number) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const token = await bridge.begin(view.getWebContentsId())
  const abort = () => void bridge.end(token)
  signal?.addEventListener('abort', abort, { once: true })

  try {
    signal?.throwIfAborted()

    return await operation(token)
  } finally {
    signal?.removeEventListener('abort', abort)
    await bridge.end(token)
  }
}

const runner: PreviewScriptRunner = (code, signal) => activity(token => bridge.script(token, code), signal)
runner.capture = signal => activity(() => bridge.capture(view.getWebContentsId()), signal)
runner.withActivity = (operation, signal) => activity(() => operation(), signal)

window.hermesDesktop = {
  ...window.hermesDesktop,
  beginPreviewGuestActivity: bridge.begin,
  endPreviewGuestActivity: bridge.end,
  executePreviewGuestScript: bridge.script,
  armPreviewApproval: bridge.arm,
  validatePreviewApproval: bridge.validate,
  sendPreviewApprovedInput: bridge.input,
  previewBrowserInteraction: bridge.native,
  onPreviewBrowserDialog: bridge.onDialog,
  onPreviewFileChooser: bridge.onChooser
}
installPreviewNativeActions(runner, () => view, tabId, new AbortController().signal)
runner.beginApproval = signal => beginPreviewApproval(view, signal)
registerPreviewScriptRunner(tabId, runner, { initiallyReady: false })
registerPreviewInput(tabId, {
  focus: () => view.focus(),
  send: event => view.sendInputEvent(toWebviewInputSpace(event, view.getZoomFactor()))
})
let pending: Promise<PreviewActResult> | undefined
fixtureWindow.previewNativeFixture = {
  run: action => runPreviewAgentAction({ ...action, tabId }),
  start(action) {
    pending = runPreviewAgentAction({ ...action, tabId })
  },
  finish: () => pending,
  pending: () => {
    const request = $confirmRequest.get()

    return request ? { title: request.title, details: request.details } : null
  },
  async approve() {
    for (let frame = 0; frame < 120; frame++) {
      const request = $confirmRequest.get()

      if (!request) {
        return
      }

      const dialog = document.querySelector('[role="dialog"]')

      const button = Array.from(dialog?.querySelectorAll('button') ?? []).find(
        candidate => candidate.textContent?.trim() === request.confirmLabel
      )

      if (button && request.details?.every(detail => dialog?.textContent?.includes(detail.value))) {
        button.click()

        return
      }

      await new Promise(resolve => requestAnimationFrame(resolve))
    }

    throw new Error('The production confirmation dialog did not render its action')
  },
  zoom: value => view.setZoomFactor(value),
  tabId,
  ready: false
}
view.addEventListener('dom-ready', async () => {
  await bridge.native(view.getWebContentsId(), { action: 'watch', scope: tabId })
  fixtureWindow.previewNativeFixture.ready = true
})
document.getElementById('guest')!.append(view)
createRoot(document.getElementById('controls')!).render(
  <>
    <PreviewAgentStatus tabId={tabId} />
    <ConfirmHost />
  </>
)
