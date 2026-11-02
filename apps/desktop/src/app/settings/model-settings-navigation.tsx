import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'

import { CONFIG_SUBPAGES } from './config-subpages'

interface ModelSettingsNavigationProps {
  children: ReactNode
  enabled: boolean
  value?: string
}

/** Model categories keep their existing route ids and configuration owners. */
export function ModelSettingsNavigation({ children, enabled, value = 'main' }: ModelSettingsNavigationProps) {
  const { t } = useI18n()
  const [, setSearchParams] = useSearchParams()

  if (!enabled) {
    return children
  }

  return (
    <Tabs
      activationMode="manual"
      className="model-settings-navigation min-w-0 gap-6"
      onValueChange={page => {
        setSearchParams(previous => {
          const next = new URLSearchParams(previous)
          next.set('page', page)
          next.delete('field')
          next.delete('setting')
          next.delete('aux')

          return next
        })
      }}
      value={value}
    >
      <div className="min-w-0 overflow-x-auto border-b border-(--ui-stroke-tertiary)">
        <TabsList aria-label={t.settings.sections.model} className="h-9.5 justify-start gap-1.25" size="navigation">
          {CONFIG_SUBPAGES.model.map(page => (
            <TabsTrigger
              className="px-3.25 data-[state=active]:border-(--ui-accent)"
              key={page.id}
              size="navigation"
              value={page.id}
            >
              {t.settings.subpages[page.labelKey]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent className="min-w-0" forceMount value={value}>
        {children}
      </TabsContent>
    </Tabs>
  )
}
