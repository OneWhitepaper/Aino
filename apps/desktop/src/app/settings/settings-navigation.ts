import type { SettingsNavigationCopy } from '@/i18n/settings-navigation'
import { Network, Settings2, ShieldLock, Zap } from '@/lib/icons'
import { normalize } from '@/lib/text'

import type { OverlayNavGroup, OverlayNavLink } from '../overlays/overlay-split-layout'

const sections = [
  { id: 'personal', pages: ['account', 'config:appearance', 'notifications', 'keybinds'] },
  { id: 'conversation', pages: ['config:model', 'config:chat', 'config:memory', 'config:voice', 'sessions'] },
  { id: 'connections', pages: ['config:workspace', 'config:browser', 'providers', 'gateway', 'plugins'] },
  { id: 'system', pages: ['config:safety', 'config:advanced', 'about'] }
] as const

const icons = { 'config:model': Zap, 'config:safety': ShieldLock, providers: Network, gateway: Settings2 }

const keywords: Record<string, string> = {
  account: 'account balance wallet billing recharge profile 账户 余额 钱包 充值 账单',
  providers: 'api provider endpoint key model service API 密钥 服务商 接口 第三方模型',
  gateway: 'gateway runtime connection 网关 运行 连接',
  plugins: 'plugin extension 插件 扩展',
  'config:advanced': 'advanced tool key config 工具 密钥 配置',
  'config:memory': 'memory context compression 记忆 上下文 压缩',
  'config:voice': 'voice speech audio 语音 朗读 识别 音频',
  'config:workspace': 'workspace project folder 工作区 项目 文件夹',
  'config:safety': 'security safety approval password login 安全 批准 密码 登录'
}

function matches(item: OverlayNavLink, query: string): boolean {
  return normalize([item.label, item.id, keywords[item.id]].join(' ')).includes(query)
}

function filterLink<T extends OverlayNavLink>(item: T, query: string): T | null {
  const children = item.children?.flatMap(child => {
    const match = filterLink(child, query)

    return match ? [match] : []
  })

  if (matches(item, query)) {
    return item
  }

  return children?.length ? { ...item, children } : null
}

/** Presentation only: original route callbacks, plugin branches and page ids survive. */
export function settingsNavigationGroups(
  groups: OverlayNavGroup[],
  copy: SettingsNavigationCopy,
  search: string
): OverlayNavGroup[] {
  const query = normalize(search)
  const known = new Set<string>(sections.flatMap(section => [...section.pages]))

  return sections.flatMap(section => {
    const pages: string[] = [...section.pages]
    const ordered = pages.flatMap(id => groups.filter(group => group.id === id))

    if (section.id === 'system') {
      ordered.push(...groups.filter(group => !known.has(group.id)))
    }

    return ordered
      .flatMap(group => {
        const match = query ? filterLink(group, query) : group

        return match ? [match] : []
      })
      .map((group, index) => ({
        ...group,
        gapBefore: false,
        searchExpanded: Boolean(query),
        icon: icons[group.id as keyof typeof icons] ?? group.icon,
        section: index === 0 ? { id: section.id, label: copy.groups[section.id] } : undefined
      }))
  })
}
