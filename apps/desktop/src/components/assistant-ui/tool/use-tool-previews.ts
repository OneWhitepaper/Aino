import { useEffect, useMemo } from 'react'

import { isArtifactProducerTool } from '@/app/artifacts/artifact-utils'
import { useSessionView } from '@/app/chat/session-view'
import { recordPreviewArtifact } from '@/store/preview-status'

import { isFileEditTool, isPreviewableTarget, type ToolPart, toolPreviewOutcome } from './fallback-model'

/** Preview discovery must not depend on whether the user opens the execution log. */
export function useToolPreviews(parts: readonly ToolPart[], messageId: string) {
  const { $cwd, $messages, $runtimeId, $storedId } = useSessionView()

  const previews = useMemo(
    () =>
      parts.flatMap(part => {
        if (part.result === undefined) {
          return []
        }

        const toolName = part.innerToolName || part.toolName
        const { previewTarget, status } = toolPreviewOutcome({ ...part, toolName })

        return status === 'success' && previewTarget && isPreviewableTarget(previewTarget)
          ? [{ target: previewTarget, generated: isFileEditTool(toolName) || isArtifactProducerTool(toolName) }]
          : []
      }),
    [parts]
  )

  useEffect(() => {
    const sessionId = $runtimeId.get()

    // A route can change before the previous chat's last row unmounts.
    if (!sessionId || !$messages.get().some(message => message.id === messageId)) {
      return
    }

    for (const preview of previews) {
      recordPreviewArtifact(
        sessionId,
        preview.target,
        $cwd.get() || '',
        $storedId.get() ?? sessionId,
        preview.generated
      )
    }
  }, [$cwd, $messages, $runtimeId, $storedId, messageId, previews])
}
