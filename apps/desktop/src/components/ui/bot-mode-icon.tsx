import './bot-mode-icon.css'

import { type AvatarDefinition, renderAvatarSvg } from 'open-bot-avatar'
import { mountAvatar } from 'open-bot-avatar/dom'
import { type ComponentPropsWithoutRef, useEffect, useRef } from 'react'

import ghost from '@/assets/open-bot-avatar/ghost.json'
import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { createRendererLoopPauseController } from '@/lib/renderer-loop-pause'
import { cn } from '@/lib/utils'

const definition = ghost as AvatarDefinition
const colors = { color: '#f4f4f4', eyeColor: '#151515' }
const stillMarkup = { __html: renderAvatarSvg(definition, { ...colors, reducedMotion: true }) }

/** Original Ghost animation; React owns the host, the upstream engine owns its frames. */
export function BotModeIcon({ className, ...props }: Omit<ComponentPropsWithoutRef<'span'>, 'children'>) {
  const host = useRef<HTMLSpanElement>(null)
  const paneVisible = usePaneVisible()

  useEffect(() => {
    const avatar = mountAvatar(host.current!, {
      definition,
      ...colors,
      label: '',
      mood: 'idle',
      reducedMotion: 'system',
      still: !paneVisible,
      followPointer: paneVisible
    })

    const sync = () => {
      const paused = !paneVisible || pauseController.isPaused()
      avatar.update({ still: paused, followPointer: !paused })
    }

    const pauseController = createRendererLoopPauseController(sync)
    sync()

    return () => {
      pauseController.dispose()
      avatar.destroy()
    }
  }, [paneVisible])

  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn('aino-bot-mode-icon relative block size-5 shrink-0 pointer-events-none', className)}
    >
      <span className="aino-bot-mode-avatar" dangerouslySetInnerHTML={stillMarkup} ref={host} />
    </span>
  )
}
