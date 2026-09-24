/**
 * Kanban — the founding plugin use case, now pure SDK-consumer work: a
 * first-class `/kanban` board page + sidebar nav row + a live statusbar count,
 * all reusing the existing `plugins/kanban/dashboard/plugin_api.py` REST router
 * through `ctx.rest` (namespace-scoped to `/api/plugins/kanban`). No new
 * backend, no core edits.
 *
 * Ships OFF by default (`defaultEnabled: false`): it inventories in
 * Capabilities ▸ Plugins and registers nothing until the user flips the switch.
 */

import './kanban.css'

import {
  cn,
  Codicon,
  type HermesPlugin,
  host,
  type KeybindContribution,
  KEYBINDS_AREA,
  PALETTE_AREA,
  type PaletteContribution,
  type PluginContext,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution,
  STATUSBAR_AREAS,
  Tip,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'

import { $boardSlug, bindApi, boardKey, fetchBoard } from './api'
import { KanbanBoardPage } from './board'
import { KANBAN_LOCALES } from './i18n'
import { $newTaskLane, useKanban } from './ui'

/** Resolve registration-time copy without leaking a dotted key on an older
 * host that exposes the i18n door but has not learned this plugin bundle yet. */
function pluginText(ctx: PluginContext, key: string, fallback: string, ...args: unknown[]): string {
  const translated = ctx.i18n?.t?.(key, ...args)

  return translated && translated !== key ? translated : fallback
}

// Live "N running / ready" pill — one glance at fleet activity from anywhere,
// clicks through to the board. Shares the board query (one cache, one poll with
// the page); hidden when nothing is in flight (or unloaded).
function KanbanCount() {
  const k = useKanban()
  const slug = useValue($boardSlug)

  // Socket-invalidated like the page (same cache); slow socketless heartbeat.
  const { data: board } = useQuery({
    queryFn: () => fetchBoard(false),
    queryKey: boardKey(slug, false),
    refetchInterval: 60_000
  })

  if (!board) {
    return null
  }

  const count = (name: string) => board.columns.find(col => col.name === name)?.tasks.length ?? 0
  const active = count('running') + count('ready')

  if (active === 0) {
    return null
  }

  return (
    <Tip label={k.countTip(count('running'), count('ready'))}>
      <button
        className={cn(
          'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors',
          'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
        )}
        onClick={() => host.navigate('/kanban')}
        type="button"
      >
        <Codicon name="project" size="0.7rem" />
        <span>{active}</span>
      </button>
    </Tip>
  )
}

const plugin: HermesPlugin = {
  id: 'kanban',
  name: 'Kanban',
  description: 'Multi-agent task board — board page, sidebar entry, and a live in-flight count in the status bar.',
  localized: {
    zh: {
      name: '看板',
      description: '多智能体任务看板：提供看板页面、侧边栏入口，以及状态栏中的实时进行中任务数量。'
    },
    'zh-hant': {
      name: '看板',
      description: '多智能體任務看板：提供看板頁面、側邊欄入口，以及狀態列中的即時進行中任務數量。'
    },
    ja: {
      name: 'カンバン',
      description:
        'マルチエージェントのタスクボード。ボード画面、サイドバー入口、ステータスバーの進行中件数を提供します。'
    }
  },
  defaultEnabled: false,
  register(ctx) {
    ctx.i18n.register(KANBAN_LOCALES)
    ctx.onDispose(
      bindApi(ctx.rest, ctx.storage, ctx.socket, {
        os: ctx.os,
        t: (key, ...args) => ctx.i18n?.t?.(key, ...args) ?? key
      })
    )

    // The plugin command pattern: ONE action id (`kanban.newTask`) wired into
    // two areas — a keybind (dispatch + rebindable panel row) and a palette row
    // whose `action` field points back at it, so ⌘K shows the live combo. The
    // handler is route-independent: it navigates to the page and parks the
    // request in `$newTaskLane`, so the hotkey works from anywhere, not just
    // while the board happens to be mounted.
    //
    // ⌘⌥N / Ctrl+Alt+N: `mod+n` is `session.new` and `mod+shift+n` is
    // `session.newWindow`, both core built-ins a plugin can't shadow. Adding
    // Alt keeps the "N for new" mnemonic on a chord core leaves free — it uses
    // `alt` only for the `mod+alt+1…9` profile slots, never with a letter. That
    // makes ⌘⌥<letter> the natural namespace for plugin commands.
    const newTask = () => {
      $newTaskLane.set('triage')
      host.navigate('/kanban')
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/kanban' } satisfies RouteContribution,
        render: () => <KanbanBoardPage />
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 50,
        data: {
          codicon: 'project',
          label: pluginText(ctx, 'nav', 'Kanban'),
          path: '/kanban'
        } satisfies SidebarNavContribution
      },
      {
        id: 'count',
        area: STATUSBAR_AREAS.right,
        order: 80,
        render: () => <KanbanCount />
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'kanban.open',
          label: pluginText(ctx, 'openBoard', 'Kanban: Open board'),
          keywords: ['kanban', 'board', 'tasks', 'agents'],
          run: () => host.navigate('/kanban')
        } satisfies PaletteContribution
      },
      {
        id: 'new-task',
        area: PALETTE_AREA,
        data: {
          id: 'kanban.newTask',
          action: 'kanban.newTask',
          label: pluginText(ctx, 'newTaskCommand', 'Kanban: New task'),
          keywords: ['kanban', 'task', 'new', 'create', 'triage'],
          run: newTask
        } satisfies PaletteContribution
      },
      {
        id: 'new-task',
        area: KEYBINDS_AREA,
        data: {
          id: 'kanban.newTask',
          category: 'view',
          defaults: ['mod+alt+n'],
          label: pluginText(ctx, 'newTaskCommand', 'Kanban: New task'),
          run: newTask
        } satisfies KeybindContribution
      }
    ])
  }
}

export default plugin
