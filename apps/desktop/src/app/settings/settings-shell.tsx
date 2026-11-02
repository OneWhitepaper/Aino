import { useStore } from '@nanostores/react'
import { type ReactNode, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { KbdCombo } from '@/components/ui/kbd'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { settingsNavigationCopy } from '@/i18n/settings-navigation'
import { triggerHaptic } from '@/lib/haptics'
import { ChevronLeft, Search, X } from '@/lib/icons'
import { $commandPaletteOpen, openCommandPalettePage } from '@/store/command-palette'
import { bindingsFor } from '@/store/keybinds'

import { OverlayMain, OverlayNav, type OverlayNavGroup, OverlaySplitLayout } from '../overlays/overlay-split-layout'

import { SettingsBreadcrumbContext } from './primitives'
import { settingsNavigationGroups } from './settings-navigation'

interface SettingsShellProps {
  children: ReactNode
  toolbar: ReactNode
  groups: OverlayNavGroup[]
  onClose: () => void
}

/** Settings keeps its own reading column while reusing the app's route nav. */
export function SettingsShell({ children, toolbar, groups, onClose }: SettingsShellProps) {
  const { locale, t } = useI18n()
  const copy = settingsNavigationCopy(locale)
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const visibleGroups = settingsNavigationGroups(groups, copy, search)
  const paletteOpen = useStore($commandPaletteOpen)
  const searchCombo = bindingsFor('nav.commandPalette')[0]
  const activeGroup = groups.find(group => group.active)
  const activeChild = activeGroup?.children?.find(child => child.active)

  const title =
    activeChild?.children?.find(child => child.active)?.label ??
    activeChild?.label ??
    activeGroup?.label ??
    t.commandCenter.settings

  return (
    <section
      aria-label={t.commandCenter.settings}
      className="settings-shell"
      data-aino-settings=""
      data-settings-workspace=""
    >
      <OverlaySplitLayout className="settings-layout">
        <div className="settings-navigation">
          <header className="settings-navigation-header" data-settings-header="">
            <Button
              aria-label={t.settings.closeSettings}
              onClick={() => {
                triggerHaptic('close')
                onClose()
              }}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronLeft />
            </Button>
            <h2>{t.commandCenter.settings}</h2>
          </header>
          <div className="settings-search">
            <Search aria-hidden />
            <input
              aria-label={copy.search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape' && search) {
                  event.preventDefault()
                  event.stopPropagation()
                  setSearch('')
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  openCommandPalettePage('settings', search)
                }
              }}
              placeholder={copy.search}
              ref={searchInput}
              type="search"
              value={search}
            />
            {search ? (
              <button
                aria-label={copy.clearSearch}
                className="settings-search-clear"
                onClick={() => {
                  setSearch('')
                  searchInput.current?.focus()
                }}
                type="button"
              >
                <X />
              </button>
            ) : (
              <Tip label={copy.searchHint}>
                <button
                  aria-expanded={paletteOpen}
                  aria-label={copy.searchAll}
                  className="settings-search-shortcut"
                  onClick={() => openCommandPalettePage('settings')}
                  type="button"
                >
                  {searchCombo ? <KbdCombo combo={searchCombo} size="sm" variant="ghost" /> : <Search />}
                </button>
              </Tip>
            )}
          </div>
          <div className="settings-navigation-items">
            <OverlayNav fullPage groups={visibleGroups} />
            {search && (
              <div className="settings-search-results">
                {visibleGroups.length === 0 && <p role="status">{copy.noResults}</p>}
                <button onClick={() => openCommandPalettePage('settings', search)} type="button">
                  <Search aria-hidden />
                  {copy.searchAll}
                </button>
              </div>
            )}
          </div>
        </div>
        <OverlayMain className="settings-main p-0" fullPage>
          <header className="settings-page-heading">
            <div className="settings-page-heading-inner">
              <h1>{title}</h1>
              <div className="settings-page-toolbar" data-settings-toolbar="">
                {toolbar}
              </div>
            </div>
          </header>
          <SettingsBreadcrumbContext value={title}>{children}</SettingsBreadcrumbContext>
        </OverlayMain>
      </OverlaySplitLayout>
    </section>
  )
}
