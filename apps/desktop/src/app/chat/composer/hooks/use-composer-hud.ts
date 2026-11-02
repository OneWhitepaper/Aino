import { useStore } from '@nanostores/react'

import { useHudComposerDrag } from '@/app/hud/composer-drag'
import { $hudMode } from '@/store/hud'

export function useComposerHud() {
  const hudMode = useStore($hudMode)
  const hudWindowing = window.hermesDesktop?.hud?.windowing
  const hudNativeDrag = hudMode && hudWindowing?.nativeDrag === true

  const { grabbing: hudGrabbing, onPointerDown: onHudDragPointerDown } = useHudComposerDrag(hudMode && !hudNativeDrag, {
    controlDrag: hudWindowing?.controlDrag === true,
    workspaceTransfer: hudWindowing?.workspaceTransfer === true
  })

  return { hudMode, hudNativeDrag, hudGrabbing, onHudDragPointerDown }
}
