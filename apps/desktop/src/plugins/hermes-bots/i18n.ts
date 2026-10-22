/**
 * Plugin-scoped i18n for Bot Mode — bundles registered under the plugin id via
 * `ctx.i18n.register`, never touching core `en.ts`. Mirrors the kanban plugin:
 * `usePluginI18n` returns a stringly-typed `t(key, …)`, and `useBots()` binds it
 * to the message SHAPE so components keep typed `b.roster.search` access.
 *
 * Only strings Bot Mode OWNS live here. Generic verbs (Cancel, Delete, Remove,
 * Retry, Close, Loading…) and shared vocabulary core already ships in every
 * locale — weekday names, Daily/Hourly, Scheduled jobs — resolve against core
 * via `useI18n()` / `translateNow()`. Duplicating those here would be a
 * second, worse translation that drifts.
 *
 * Three kinds of literal deliberately stay hardcoded, and none of them is a
 * missed key:
 *
 *  - **Prompts sent to a model**, not shown as chrome: the room-picture image
 *    prompt and the scheduled-routine instruction. They are addressed to the
 *    model, which reads English best.
 *  - **Syntax and identifiers**: cron expressions and their examples, React
 *    keys, workspace ids.
 *  - **`'You'`**, the author marker on room-log entries. It is persisted into
 *    the log and compared as a sentinel (`group-activity.ts`), so it stays
 *    English where it is WRITTEN (`group-chat-parts.tsx`, `group-rounds.ts`);
 *    the places that RENDER the reader's own lines use `group.you` instead.
 *
 * Legacy Bot Mode copy follows kanban: `en` / `ja` / `zh` / `zh-hant`.
 * Canonical hosted groups additionally have `ar`, `ru`, `fr`, `de`, and
 * `es` strings; missing legacy copy falls through to English. Nouns match
 * core: ボット / 机器人 / 機器人, プロファイル / 工作区 / 設定檔, ゲートウェイ / 网关 / 閘道.
 */

import { type PluginLocaleBundles, type PluginTranslate, usePluginI18n } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import { bind, type Bound } from './i18n-bind'
import { en as legacyEn } from './i18n-en'
import { ja as legacyJa } from './i18n-ja'
import type { BotsMessages as UpstreamBotsMessages } from './i18n-messages'
import type { BotsMessages as LegacyBotsMessages } from './i18n-types'
import { zh as legacyZh } from './i18n-zh'
import { zhHant as legacyZhHant } from './i18n-zhHant'
import { getPluginCtx } from './shared'

type BotsMessages = LegacyBotsMessages & Pick<UpstreamBotsMessages, 'canonical'>

const en: BotsMessages = { ...legacyEn, canonical: CANONICAL_GROUP_LOCALES.en }
const ja: BotsMessages = { ...legacyJa, canonical: CANONICAL_GROUP_LOCALES.ja }
const zh: BotsMessages = { ...legacyZh, canonical: CANONICAL_GROUP_LOCALES.zh }
const zhHant: BotsMessages = { ...legacyZhHant, canonical: CANONICAL_GROUP_LOCALES['zh-hant'] }

/** Registered via `ctx.i18n.register` at plugin load (disposer tracked). */
export const BOTS_LOCALES: PluginLocaleBundles = {
  en,
  ja,
  zh,
  'zh-hant': zhHant,
  ar: { canonical: CANONICAL_GROUP_LOCALES.ar },
  ru: { canonical: CANONICAL_GROUP_LOCALES.ru },
  fr: { canonical: CANONICAL_GROUP_LOCALES.fr },
  de: { canonical: CANONICAL_GROUP_LOCALES.de },
  es: { canonical: CANONICAL_GROUP_LOCALES.es }
}

export type BotsText = Bound<BotsMessages>

/** The Bot Mode strings for the active locale — one hook every component reads. */
export function useBots(): BotsText {
  const t = usePluginI18n('hermes-bots')

  return useMemo(() => bind(t, en), [t])
}

/** Resolve a dotted path against the English bundle — the floor for a read
 *  that beats `ctx.i18n` into existence, so an unresolved key never ships as
 *  the literal `cron.runsHourly`. */
function english(key: string, ...args: unknown[]): string {
  const leaf = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en)

  return typeof leaf === 'function' ? (leaf as (...a: unknown[]) => string)(...args) : String(leaf ?? key)
}

let bound: { text: BotsText; translate: PluginTranslate } | null = null

/** `useBots` for the module-level functions a hook can't reach — the schedule
 *  summarizers and label helpers that render inside components but aren't
 *  components. Non-reactive on its own; every caller is invoked during a
 *  render that a core `useI18n()` already subscribes to, so a locale switch
 *  still repaints. Cached on translator identity: `bind` walks the whole tree,
 *  and these run per row. */
export function botsText(): BotsText {
  const translate = getPluginCtx()?.i18n?.t ?? english

  if (bound?.translate !== translate) {
    bound = { text: bind(translate, en), translate }
  }

  return bound.text
}
