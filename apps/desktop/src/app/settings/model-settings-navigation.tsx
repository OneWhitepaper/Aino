import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { ChevronDown, ChevronLeft, ChevronRight } from '@/lib/icons'

import { CONFIG_SUBPAGES } from './config-subpages'

interface ModelSettingsNavigationProps {
  children: ReactNode
  enabled: boolean
  value?: string
}

/** Scoped model categories retain their existing URLs without a second tab bar. */
export function ModelSettingsNavigation({ children, enabled, value = 'main' }: ModelSettingsNavigationProps) {
  const { t } = useI18n()
  const [, setSearchParams] = useSearchParams()

  if (!enabled) {
    return children
  }

  const pages = CONFIG_SUBPAGES.model
  const current = pages.find(page => page.id === value) ?? pages[0]
  const main = value === 'main'

  const navigate = (page: string) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.set('page', page)
      next.delete('field')
      next.delete('setting')
      next.delete('aux')

      return next
    })
  }

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="model-settings-more" size="sm" variant="text">
          {main ? t.settings.model.pages.moreSettings : t.settings.subpages[current.labelKey]}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={main ? 'start' : 'end'}>
        {pages.map(page => (
          <DropdownMenuItem
            aria-current={page.id === value ? 'page' : undefined}
            key={page.id}
            onSelect={() => navigate(page.id)}
          >
            {t.settings.subpages[page.labelKey]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="model-settings-navigation" data-model-settings-category={value}>
      {!main && (
        <div className="model-settings-category-header">
          <Button onClick={() => navigate('main')} size="sm" variant="text">
            <ChevronLeft />
            {t.settings.subpages.modelMain}
          </Button>
          {menu}
        </div>
      )}
      {children}
      {main && (
        <section className="model-settings-preferences">
          <h2>{t.settings.model.pages.preferences}</h2>
          <div className="model-settings-preference-row">
            <div>
              <span>{t.settings.subpages.modelFallbacks}</span>
              <p>{t.settings.model.pages.fallbackDescription}</p>
            </div>
            <Button onClick={() => navigate('fallbacks')} size="sm" variant="text">
              <ChevronRight />
              {t.settings.subpages.modelFallbacks}
            </Button>
          </div>
          {menu}
        </section>
      )}
    </div>
  )
}
