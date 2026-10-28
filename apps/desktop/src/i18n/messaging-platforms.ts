import { applyProductBrand } from '@/lib/brand'

import type { Locale } from './types'

// Chinese-first display names; platform ids and backend metadata stay canonical.
const ZH_PLATFORM_NAMES: Readonly<Record<string, string>> = {
  telegram: '电报（Telegram）',
  discord: '社区聊天（Discord）',
  slack: '团队协作（Slack）',
  mattermost: '团队通信（Mattermost）',
  matrix: '矩阵通信（Matrix）',
  signal: '私密通信（Signal）',
  whatsapp: '即时通信（WhatsApp）',
  homeassistant: '智能家居（Home Assistant）',
  email: '电子邮件',
  sms: '短信（Twilio）',
  dingtalk: '钉钉',
  feishu: '飞书',
  google_chat: '谷歌聊天',
  wecom: '企业微信（群机器人）',
  wecom_callback: '企业微信（应用）',
  weixin: '微信',
  bluebubbles: '苹果信息（BlueBubbles）',
  qqbot: 'QQ 机器人',
  teams: '微软团队（Teams）',
  irc: '网络聊天室（IRC）',
  line: '即时通信（LINE）',
  ntfy: '消息推送（ntfy）',
  photon: '苹果信息（Photon）',
  raft: '智能体协作（Raft）',
  simplex: '私密聊天（SimpleX）',
  yuanbao: '腾讯元宝',
  api_server: '接口服务',
  webhook: '事件回调',
  msgraph_webhook: '微软事件通知',
  whatsapp_cloud: '即时通信云服务（WhatsApp）',
  relay: '消息中继',
  a2a: '智能体互联（A2A）',
  buzz: '社区协作（Buzz）'
}

export function localizedMessagingPlatformName(locale: Locale, platformId: string, fallback: string): string {
  return locale === 'zh' ? (ZH_PLATFORM_NAMES[platformId] ?? fallback) : fallback
}

/**
 * Built-in messaging platform descriptions returned by the Hermes runtime.
 *
 * These values are runtime metadata rather than locale-bundle strings, so a
 * backend update can otherwise reintroduce English into the desktop UI. Keep
 * the map keyed by the stable platform id and leave unknown/plugin platforms
 * untouched: plugin authors own their public metadata.
 */
const ZH_PLATFORM_DESCRIPTIONS: Readonly<Record<string, string>> = {
  a2a: '通过 A2A 协议与其他智能体通信。',
  buzz: '通过 Buzz 命令行工具连接社区协作平台。',
  telegram: '在 Telegram 私聊、群组和话题中使用 Hermes。',
  discord: '将 Hermes 连接到 Discord 私信、频道和线程。',
  slack: '通过 Socket Mode 在 Slack 中使用 Hermes。请添加允许的 Slack 成员 ID，以便连接的机器人能够回复。',
  mattermost: '将 Hermes 连接到 Mattermost 频道和私信。',
  matrix: '在 Matrix 房间和私信中使用 Hermes。',
  signal: '通过 signal-cli REST 桥接连接。',
  whatsapp: '通过 Hermes 自带的 WhatsApp 桥接使用 Hermes，并使用二维码完成认证。',
  homeassistant: '通过 Home Assistant 从 Hermes 控制智能家居。',
  email: '通过 IMAP/SMTP 邮箱与 Hermes 对话。',
  sms: '通过 Twilio 收发短信。',
  dingtalk: '将 Hermes 连接到钉钉群组。',
  feishu: '在飞书 / Lark 中使用 Hermes。',
  google_chat: '通过 Cloud Pub/Sub 将 Hermes 连接到 Google Chat。',
  wecom: '通过 Webhook 发送企业微信群机器人消息（仅发送）。',
  wecom_callback: '通过回调应用实现双向企业微信集成。',
  weixin: '通过腾讯 iLink Bot API 连接个人微信账号。',
  bluebubbles: '通过 BlueBubbles 服务器在 iMessage 中使用 Hermes。',
  qqbot: '从 QQ 开放平台连接 QQ 机器人。',
  teams: '通过 Bot Framework 将 Hermes 连接到 Microsoft Teams 聊天。',
  irc: '在 IRC 频道（或私信）与 Hermes 互发消息。',
  line: '通过 LINE Messaging API Webhook 使用 Hermes。',
  ntfy: '通过 ntfy 推送主题（ntfy.sh 或自托管）与 Hermes 对话。',
  photon: '通过 Photon 的托管 Spectrum 平台在 iMessage 中使用 Hermes。',
  raft: '以外部智能体身份加入 Raft 工作区。',
  simplex: '通过本地 simplex-chat 守护进程在 SimpleX Chat 中与 Hermes 对话。',
  yuanbao: '将 Hermes 连接到腾讯元宝。',
  api_server: '将 Hermes 暴露为兼容 OpenAI 的 HTTP API，供 Open WebUI 等工具使用。',
  webhook: '接收来自 GitHub、GitLab 和其他 Webhook 来源的事件。',
  msgraph_webhook: '接收 Microsoft Graph 变更通知（Teams 会议、Outlook 等）。',
  whatsapp_cloud: '通过 Meta 托管的 WhatsApp Cloud API 使用 Hermes（无需本地桥接）。',
  relay: '通过 Hermes Relay 连接器提供的通用中继适配器。'
}

export function localizedMessagingPlatformDescription(locale: Locale, platformId: string, fallback: string): string {
  if (locale !== 'zh') {
    return platformId in ZH_PLATFORM_DESCRIPTIONS ? applyProductBrand(fallback) : fallback
  }

  const translated = ZH_PLATFORM_DESCRIPTIONS[platformId]

  return translated ? applyProductBrand(translated) : fallback
}
