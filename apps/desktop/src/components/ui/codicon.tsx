import './codicon.css'

import type { Icon } from '@tabler/icons-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

import { codiconDesignIcons } from './codicon-design-icons'

export interface CodiconProps extends React.HTMLAttributes<HTMLElement> {
  name: string
  size?: number | string
  spinning?: boolean
}

export function Codicon({ className, name, size, spinning, style, ...props }: CodiconProps) {
  const DesignIcon = Object.hasOwn(codiconDesignIcons, name) ? codiconDesignIcons[name] : undefined

  return (
    <i
      aria-hidden="true"
      className={cn('codicon', `codicon-${name}`, spinning && 'codicon-modifier-spin', className)}
      data-aino-icon-name={DesignIcon ? name : undefined}
      style={{ ...(size != null && size !== '' ? { fontSize: size } : {}), ...style }}
      {...props}
    >
      {DesignIcon && <DesignIcon size="1em" />}
    </i>
  )
}

/** Wrap a codicon as a Tabler-shaped icon for nav rows that expect `IconComponent`. */
export function codiconIcon(name: string): Icon {
  function CodiconIcon({ className }: { className?: string }) {
    return <Codicon aria-hidden className={cn('leading-none', className)} name={name} size="1em" />
  }

  CodiconIcon.displayName = `Codicon(${name})`

  return CodiconIcon as Icon
}
