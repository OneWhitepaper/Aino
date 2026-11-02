import type { ReactNode } from 'react'

import type { ProfileScope } from '@/hermes'

import { useHermesConfigRecord } from '../hooks/use-config-record'

import { ImageGenerationSettings } from './image-generation-settings'

interface ModelImageGenerationSettingsProps {
  activeSectionId: string
  children?: ReactNode
  profile?: ProfileScope
  subpage?: string
}

function ScopedImageGenerationSettings({ profile }: { profile?: ProfileScope }) {
  const { writeScope } = useHermesConfigRecord(profile)

  return <ImageGenerationSettings profile={writeScope ?? profile} />
}

export function ModelImageGenerationSettings({
  activeSectionId,
  children,
  profile,
  subpage
}: ModelImageGenerationSettingsProps) {
  if (activeSectionId !== 'model' || (subpage !== undefined && subpage !== 'main')) {
    return children
  }

  return (
    <>
      <ScopedImageGenerationSettings profile={profile} />
      {children}
    </>
  )
}
