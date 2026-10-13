/**
 * The pieces every Bot Mode module needs and no single module can own: the
 * plugin id, the `PluginContext` `register()` captures, and the open
 * generation the bot-open and group-open click paths race on.
 *
 * The mutable ones live behind accessor pairs because an imported binding
 * cannot be reassigned — `register()` publishes the context once with
 * `setPluginCtx`, and every reader goes through `getPluginCtx()`.
 */

import { atom, type PluginContext } from '@hermes/plugin-sdk'

export const ID = 'hermes-bots'

/** Captured in register() so components can reach plugin storage. */
let pluginCtx: PluginContext | null = null

export function getPluginCtx(): PluginContext | null {
  return pluginCtx
}

/** Resolve plugin copy while keeping an English floor when a handler races
 * plugin registration (or an older host has no matching key). */
export function pluginText(key: string, fallback: string, ...args: unknown[]): string {
  // Older hosts (and lightweight plugin test harnesses) may expose locale
  // registration without the runtime translator. Feature-detect the method
  // instead of invoking through optional chaining, which only guards the
  // `i18n` object and still throws when `t` is absent.
  const translate = pluginCtx?.i18n?.t
  const translated = typeof translate === 'function' ? translate(key, ...args) : undefined

  return translated && translated !== key ? translated : fallback
}

export function setPluginCtx(ctx: PluginContext | null) {
  pluginCtx = ctx
}

/** Monotonic open generation. A bot open and a group open supersede each
 *  other, so both bump it and both compare against it — and they no longer
 *  live in the same module. */
let botOpenGeneration = 0

/** Cold open still in flight. Published after the fronted-tab miss and before
 *  source prep. Not chat ownership — never route or highlight from this key.
 *  The generation guards the clear: a superseded flight never releases its
 *  successor's mark. A bump (another open, a group, or Sessions) drops it. */
export const $pendingBotOpen = atom<null | { generation: number; key: string }>(null)

export function getBotOpenGeneration() {
  return botOpenGeneration
}

/** Invalidate every in-flight open; returns the generation that now owns it. */
export function bumpBotOpenGeneration() {
  $pendingBotOpen.set(null)

  return ++botOpenGeneration
}
