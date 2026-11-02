import './config-page-layout.css'

import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'

import { CONFIG_PAGE_CATEGORIES, type ConfigPageSection, configPageTarget } from './config-page-definitions'
import { SettingsProfileScope } from './profile-scope'

interface ConfigPageLayoutProps {
  section: ConfigPageSection
  panels: Record<string, ReactNode>
  status?: ReactNode
  children?: ReactNode
}

/** Categories only arrange existing controls; configuration and saving remain with their current owners. */
export function ConfigPageLayout({ section, panels, status, children }: ConfigPageLayoutProps) {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const value = configPageTarget(section, params)
  const copy = t.settings.configPages

  return (
    <div className="config-page-layout" data-config-page={section}>
      <div className="config-page-context">
        <p>{copy.intros[section]}</p>
        <SettingsProfileScope className="config-page-scope" compact />
      </div>
      <div hidden={!status}>{status}</div>
      <Tabs
        className="config-page-tabs-root"
        onValueChange={page => {
          setParams(previous => {
            const next = new URLSearchParams(previous)
            next.set('page', page)

            for (const key of ['field', 'setting', 'key', 'vault', 'kind', 'label', 'origin']) {
              next.delete(key)
            }

            return next
          })
        }}
        value={value}
      >
        <TabsList aria-label={t.settings.sections[section]} className="config-page-tabs" size="navigation">
          {CONFIG_PAGE_CATEGORIES[section].map(page => (
            <TabsTrigger key={page.id} size="navigation" value={page.id}>
              {copy.tabs[page.label]}
            </TabsTrigger>
          ))}
        </TabsList>
        {CONFIG_PAGE_CATEGORIES[section].map(page => (
          <TabsContent
            className="config-page-panel"
            forceMount
            hidden={value !== page.id}
            key={page.id}
            value={page.id}
          >
            <div id={`setting-section-${page.id}`}>{panels[page.id]}</div>
          </TabsContent>
        ))}
      </Tabs>
      {children}
    </div>
  )
}
