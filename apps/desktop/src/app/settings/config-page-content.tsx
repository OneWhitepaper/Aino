import type { ReactNode } from 'react'

import { useI18n } from '@/i18n'
import {
  Archive,
  Brain,
  Cpu,
  FileImage,
  FileText,
  Globe,
  Lock,
  MessageCircle,
  Mic,
  Monitor,
  Network,
  Settings2,
  ShieldLock,
  Terminal,
  Volume2,
  Wrench
} from '@/lib/icons'
import type { ConfigFieldSchema } from '@/types/hermes'

import { configPageCategory, type ConfigPageSection } from './config-page-definitions'
import { ConfigPageLayout } from './config-page-layout'
import { configSubpageForField } from './config-subpages'
import { SectionHeading } from './primitives'

export interface ConfigPageSlots {
  after?: ReactNode
  attachments?: ReactNode
  desktop?: ReactNode
  connections?: ReactNode
  quickEntry?: ReactNode
  onboarding?: ReactNode
  metrics?: ReactNode
  voiceHint?: ReactNode
}

interface ConfigPageContentProps {
  section: ConfigPageSection
  fields: [string, ConfigFieldSchema][]
  renderFields: (entries: [string, ConfigFieldSchema][], extra?: ReactNode) => ReactNode
  slots: ConfigPageSlots
  subpage?: string
  status?: ReactNode
  children?: ReactNode
}

/** The six approved pages compose the same schema rows and existing feature slots. */
export function ConfigPageContent({
  section,
  fields,
  renderFields,
  slots,
  subpage,
  status,
  children
}: ConfigPageContentProps) {
  const { t } = useI18n()
  const cp = t.settings.configPages
  const byGroup = (group: string) => fields.filter(([key]) => configSubpageForField(section, key) === group)
  const byKey = (keys: string[]) => fields.filter(([key]) => keys.includes(key))

  const except = (entries: [string, ConfigFieldSchema][], keys: string[]) =>
    entries.filter(([key]) => !keys.includes(key))

  const group = (title: string, icon: typeof Settings2, entries: [string, ConfigFieldSchema][], extra?: ReactNode) =>
    entries.length || extra ? (
      <section className="config-page-section">
        <SectionHeading icon={icon} title={title} />
        {renderFields(entries, extra)}
      </section>
    ) : null

  const panels: Record<string, ReactNode> = {}

  if (section === 'chat') {
    panels.behavior = group(cp.sections.reply, MessageCircle, byGroup('behavior'))
    panels.attachments = (
      <>
        {group(cp.sections.images, FileImage, byGroup('attachments'))}
        {group(cp.sections.attachments, FileText, [], slots.attachments)}
      </>
    )
  }

  if (section === 'safety') {
    panels.approvals = group(cp.sections.approvals, ShieldLock, byGroup('approvals'))
    panels.privacy = (
      <>
        {group(cp.sections.privacy, Lock, byGroup('privacy'))}
        {group(cp.sections.metrics, Settings2, [], slots.metrics)}
      </>
    )
    panels.checkpoints = group(cp.sections.checkpoints, Archive, byGroup('checkpoints'))
    panels.vault = slots.after
  }

  if (section === 'browser') {
    panels.profile = group(cp.sections.browserIdentity, Globe, byGroup('profile'))
    panels.network = group(cp.sections.browserNetwork, Network, byGroup('network'))
  }

  if (section === 'memory') {
    panels.persistent = (
      <>
        {group(cp.sections.persistent, Brain, except(byGroup('persistent'), ['memory.provider']))}
        {group(cp.sections.externalMemory, Wrench, byKey(['memory.provider']))}
      </>
    )
    panels.context = (
      <>
        {group(cp.sections.context, FileText, byKey(['context.engine']))}
        {group(cp.sections.compression, Settings2, except(byGroup('context'), ['context.engine']))}
      </>
    )
  }

  if (section === 'voice') {
    panels.conversation = (
      <>
        {group(cp.sections.voiceConversation, Mic, byGroup('conversation'))}
        {group(cp.sections.voiceEntry, Mic, [], slots.voiceHint)}
      </>
    )
    panels.transcription = group(cp.sections.transcription, FileText, byGroup('transcription'))
    panels.speech = group(cp.sections.speech, Volume2, byGroup('speech'))
  }

  if (section === 'advanced') {
    panels.desktop = (
      <>
        {group(cp.sections.desktop, Monitor, [], slots.desktop)}
        {group(
          cp.sections.startup,
          Settings2,
          byGroup('desktop'),
          <>
            {slots.quickEntry}
            {slots.onboarding}
          </>
        )}
      </>
    )
    panels.runtime = (
      <>
        {group(cp.sections.runtime, Cpu, byGroup('runtime'))}
        {group(cp.sections.connections, Network, [], slots.connections)}
        {group(cp.sections.tools, Wrench, byGroup('tools'))}
        {group(cp.sections.terminal, Terminal, byGroup('terminal'))}
      </>
    )
    panels.output = group(cp.sections.output, FileText, byGroup('output'))
    panels.keys = slots.after
  }

  const additional = fields.filter(([key]) => configSubpageForField(section, key) === undefined)
  const appendix = additional.length ? <div className="config-page-appendix">{renderFields(additional)}</div> : null

  if (subpage !== undefined) {
    const category = configPageCategory(section, subpage) ?? subpage

    return (
      <div className="config-page-layout" data-config-page={section}>
        <div hidden={!status}>{status}</div>
        {panels[category]}
        {appendix}
        {section !== 'safety' && section !== 'advanced' && slots.after}
        {children}
      </div>
    )
  }

  return (
    <ConfigPageLayout panels={panels} section={section} status={status}>
      {appendix}
      {section !== 'safety' && section !== 'advanced' && slots.after}
      {children}
    </ConfigPageLayout>
  )
}
