import { LocalFilePreview } from '@/app/chat/right-rail/preview-file'
import { localPreviewTarget } from '@/lib/local-preview'
import type { OpenSharedProject } from '@/store/shared-project-windows'

export function SharedProjectPreview({ entry, path }: { entry: OpenSharedProject; path: string }) {
  const target = localPreviewTarget(path)
  if (!target) return null
  target.url = `shared-project:${encodeURIComponent(JSON.stringify([entry.connectionId, entry.project.install_id, entry.source.registration_profile, path]))}`
  return (
    <LocalFilePreview
      reloadKey={0}
      target={target}
      filesystemSource={{ connectionId: entry.connectionId, profile: entry.source.registration_profile }}
    />
  )
}
