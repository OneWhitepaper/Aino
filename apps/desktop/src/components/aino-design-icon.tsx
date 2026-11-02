import type * as React from 'react'

import { cn } from '@/lib/utils'

export interface AinoDesignIconProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  src: string
}

/**
 * Single-colour SVG asset shared by the approved Aino interface.
 * A mask preserves the source path while letting active, hover, and dark-mode
 * states continue to inherit the surrounding control's semantic colour.
 */
export function AinoDesignIcon({ className, src, style, ...props }: AinoDesignIconProps) {
  const maskImage = `url(${JSON.stringify(src)})`

  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 bg-current', className)}
      data-aino-design-icon=""
      style={{
        WebkitMaskImage: maskImage,
        WebkitMaskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: '100% 100%',
        maskImage,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        maskSize: '100% 100%',
        ...style
      }}
      {...props}
    />
  )
}
