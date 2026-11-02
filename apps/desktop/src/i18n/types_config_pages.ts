export type ConfigPageId = 'chat' | 'safety' | 'browser' | 'memory' | 'voice' | 'advanced'

export type ConfigPageTabId =
  | 'chatReply'
  | 'chatAttachments'
  | 'safetyApprovals'
  | 'safetyPrivacy'
  | 'safetyCheckpoints'
  | 'safetyVault'
  | 'browserProfile'
  | 'browserNetwork'
  | 'memoryPersistent'
  | 'memoryContext'
  | 'voiceConversation'
  | 'voiceTranscription'
  | 'voiceSpeech'
  | 'advancedDesktop'
  | 'advancedRuntime'
  | 'advancedOutput'
  | 'advancedKeys'

export type ConfigPageSectionId =
  | 'reply'
  | 'preferences'
  | 'images'
  | 'attachments'
  | 'approvals'
  | 'privacy'
  | 'metrics'
  | 'checkpoints'
  | 'vault'
  | 'browserIdentity'
  | 'browserNetwork'
  | 'persistent'
  | 'externalMemory'
  | 'context'
  | 'compression'
  | 'voiceConversation'
  | 'voiceEntry'
  | 'transcription'
  | 'speech'
  | 'desktop'
  | 'startup'
  | 'runtime'
  | 'connections'
  | 'tools'
  | 'terminal'
  | 'output'
  | 'credentials'

export type ConfigPageUnit =
  | 'seconds'
  | 'minutes'
  | 'megabytes'
  | 'bytes'
  | 'characters'
  | 'messages'
  | 'snapshots'
  | 'turns'
  | 'retries'
  | 'percent'
  | 'lines'
  | 'connections'
  | 'hertz'
  | 'bitsPerSecond'
  | 'multiplier'

export interface ConfigPageFieldCopy {
  label: string
  description: string
  help?: string
  unit?: ConfigPageUnit
}

export interface ConfigPageModeCopy {
  label: string
  description: string
}

export interface ConfigPagesCopy {
  intros: Record<ConfigPageId, string>
  tabs: Record<ConfigPageTabId, string>
  sections: Record<ConfigPageSectionId, string>
  fields: Partial<Record<string, ConfigPageFieldCopy>>
  modes: {
    approvals: Record<'manual' | 'smart' | 'off', ConfigPageModeCopy>
    images: Record<'auto' | 'native' | 'text', ConfigPageModeCopy>
    voice: Record<'chained' | 'gpt-live', ConfigPageModeCopy>
  }
  units: Record<ConfigPageUnit, string>
  invalidNumber: string
  listPlaceholder: string
  percentPrecise: string
}
