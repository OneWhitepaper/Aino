import { Tabs as TabsPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-2', className)} data-slot="tabs" {...props} />
}

interface TabsListProps extends React.ComponentProps<typeof TabsPrimitive.List> {
  size?: 'default' | 'navigation'
}

function TabsList({ className, size = 'default', ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex items-center justify-center bg-(--ui-bg-tertiary) p-1 text-muted-foreground',
        size === 'navigation' ? 'h-11 w-fit gap-1 rounded-xl' : 'h-9 rounded-(--aino-radius-control)',
        className
      )}
      data-slot="tabs-list"
      {...props}
    />
  )
}

interface TabsTriggerProps extends React.ComponentProps<typeof TabsPrimitive.Trigger> {
  size?: 'default' | 'navigation'
}

function TabsTrigger({ className, size = 'default', ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center rounded-(--aino-radius-control) font-medium whitespace-nowrap transition-colors outline-none focus-visible:bg-background focus-visible:text-foreground focus-visible:ring-[0.1875rem] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-(--ui-bg-elevated) data-[state=active]:text-foreground data-[state=active]:shadow-xs [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        size === 'navigation'
          ? 'h-9 cursor-pointer gap-2 px-3.5 text-[length:var(--aino-text-ui)] hover:text-foreground'
          : 'h-7 gap-1.5 px-3 text-sm',
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('outline-none', className)} data-slot="tabs-content" {...props} />
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
