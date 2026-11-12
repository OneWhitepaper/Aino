import { type ElectronApplication, expect, installErrorBannerGuard, type Page } from './test'

export interface NativeBindingObservation {
  sessionId: string
  modelId?: string
  profile?: string
  revision: number
  completed: boolean
  ok?: boolean
  code?: string | null
  expiresAt?: string | null
}

export interface NativeAccountObservation {
  operation: string
  completed: boolean
  ok?: boolean
  code?: string | null
  phase?: string
  userId?: string | null
}

/** Observe the real native handler's public result without keeping its renderer alive. */
export function nativeBindingObserverBootstrap(): string {
  return `
globalThis.__AINO_E2E_NATIVE_BINDINGS__ = [];
globalThis.__AINO_E2E_NATIVE_ACCOUNTS__ = [];
const bindingObserverIpc = require('electron').ipcMain;
const bindingObserverHandle = bindingObserverIpc.handle;
bindingObserverIpc.handle = function(channel, listener) {
  if (['aino:platform-account:retry', 'aino:platform-account:logout'].includes(channel)) {
    return bindingObserverHandle.call(this, channel, function(...args) {
      const entry = { operation: channel.split(':').at(-1), completed: false };
      globalThis.__AINO_E2E_NATIVE_ACCOUNTS__.push(entry);
      const result = listener(...args);
      Promise.resolve(result).then(value => Object.assign(entry, { completed: true, ok: value.ok,
        code: value.error?.code ?? null, phase: value.value?.phase ?? '', userId: value.value?.account?.id ?? null }),
        error => Object.assign(entry, { completed: true, ok: false, code: String(error.code ?? error.message) }));
      return result;
    });
  }
  if (channel !== 'aino:platform-models:bind') return bindingObserverHandle.call(this, channel, listener);
  return bindingObserverHandle.call(this, channel, function(event, input) {
    const entry = { sessionId: input.session_id, modelId: input.model_id, profile: input.profile,
      revision: input.expected_account_revision, completed: false };
    globalThis.__AINO_E2E_NATIVE_BINDINGS__.push(entry);
    const result = listener(event, input);
    Promise.resolve(result).then(value => Object.assign(entry, { completed: true, ok: value.ok, code: value.error?.code ?? null,
      ...(value.ok ? { expiresAt: value.expires_at } : {}) }),
      error => Object.assign(entry, { completed: true, ok: false, code: String(error.code ?? error.message) }));
    return result;
  });
};
`
}

export async function nativeBindingObservations(app: ElectronApplication): Promise<NativeBindingObservation[]> {
  return app.evaluate(
    () =>
      (globalThis as unknown as { __AINO_E2E_NATIVE_BINDINGS__: NativeBindingObservation[] })
        .__AINO_E2E_NATIVE_BINDINGS__
  )
}

export async function nativeAccountObservations(app: ElectronApplication): Promise<NativeAccountObservation[]> {
  return app.evaluate(
    () =>
      (globalThis as unknown as { __AINO_E2E_NATIVE_ACCOUNTS__: NativeAccountObservation[] })
        .__AINO_E2E_NATIVE_ACCOUNTS__
  )
}

/** Account transitions replace every renderer; callers retain the mutable launch. */
export async function replaceAccountWindow(
  launched: { app: ElectronApplication; page: Page },
  operation: (page: Page) => Promise<unknown>
): Promise<Page> {
  const previous = launched.page
  const retired = [...launched.app.windows()]
  const nextWindow = launched.app.waitForEvent('window', { timeout: 120_000 })

  const transition = operation(previous).catch(error => {
    // The native authority may destroy its caller before sending the IPC reply.
    if (!previous.isClosed()) {
      throw error
    }
  })

  const [replacement] = await Promise.all([nextWindow, transition])
  installErrorBannerGuard(replacement)
  launched.page = replacement
  await expect.poll(() => retired.every(page => page.isClosed())).toBe(true)

  return replacement
}
