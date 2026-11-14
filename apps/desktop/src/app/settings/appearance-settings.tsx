import './appearance-settings.css'

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { saveHermesConfig } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import {
  Check,
  Globe as Languages,
  HelpCircle as Lightbulb,
  MessageCircle,
  Palette,
  Star as Sparkles,
  Terminal as SquareTerminal,
  Sun as SunMoon,
  CircleLetterA as Type
} from '@/lib/icons'
import {
  $chatTextScale,
  CHAT_TEXT_SCALE_PRESETS,
  DEFAULT_CHAT_TEXT_SCALE,
  setChatTextScale
} from '@/store/chat-text-scale'
import { $embedAllowed, $embedMode, clearEmbedAllowed, type EmbedMode, setEmbedMode } from '@/store/embed-consent'
import { $modeShadowed } from '@/store/interface-mode'
import { $introSplash, setIntroSplash } from '@/store/intro-splash'
import { notifyError } from '@/store/notifications'
import { $reactionsEnabled, setReactionsEnabled } from '@/store/reactions-enabled'
import { $reasoningCollapsedByDefault, setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $textDirection, setTextDirection, TEXT_DIRECTIONS, type TextDirection } from '@/store/text-direction'
import { $hideThreadTimeline, setHideThreadTimeline } from '@/store/thread-timeline'
import { $spentTipCount, $tipsEnabled, resetTips, setTipsEnabled } from '@/store/tips'
import { $hideCodeDiffs, $toolViewMode, setHideCodeDiffs, setToolViewMode } from '@/store/tool-view'
import { $toursEnabled, setToursEnabled } from '@/store/tours'
import { resetTranslucencyPeek } from '@/store/translucency'
import { $userBubbleTransparency, setUserBubbleTransparency } from '@/store/user-bubble-transparency'
import { $vibeHeartsEnabled, setVibeHeartsEnabled } from '@/store/vibe-hearts-enabled'
import { $zoomPercent, setZoomPercent } from '@/store/zoom'
import { useTheme } from '@/themes/context'

import { setHermesConfigCache, useHermesConfigRecord } from '../hooks/use-config-record'

import { AppearanceExtraSlot } from './appearance-contrib'
import { AppearanceDisclosure, AppearanceGroup, AppearanceSelect } from './appearance-controls'
import { AppearanceHabitsPreview } from './appearance-habits-preview'
import { AppearanceLivePreview } from './appearance-live-preview'
import { type AppearanceSubpageId } from './appearance-subpages'
import { AppearanceWindowSettings, TranslucencySlider } from './appearance-window-settings'
import { ChatFontSetting } from './chat-font-setting'
import { MODE_OPTIONS } from './constants'
import { setNested } from './helpers'
import { PetSettings } from './pet-settings'
import { ListRow, SectionHeading, SettingsContent, ToggleRow } from './primitives'
import { SETTING_IDS, settingDefinition, settingElementId } from './settings-manifest'
import { TerminalFontSetting } from './terminal-font-setting'
import { useSettingDeepLink } from './use-setting-deep-link'

// display.resume_last_session lives in the backend config record (shared with
// config.yaml and the cold-start restore in use-desktop-integrations), not a
// renderer store. Saves write through the shared react-query cache so the
// restore gate sees the new value on the next launch.
function ResumeLastSessionSetting() {
  const { t } = useI18n()
  const a = t.settings.appearance
  const configQuery = useHermesConfigRecord()
  const config = configQuery.data
  const writeScope = configQuery.writeScope
  const checked = (config?.display as { resume_last_session?: unknown } | undefined)?.resume_last_session !== false

  const update = (on: boolean) => {
    if (!config) {
      return
    }

    const next = setNested(config, 'display.resume_last_session', on)
    setHermesConfigCache(next)
    // Sparse patch: PUT /api/config deep-merges, and echoing the cached
    // snapshot would overwrite keys other surfaces changed since it loaded.
    void saveHermesConfig(setNested({}, 'display.resume_last_session', on), writeScope)
      .then(result => {
        if (!result.ok) {
          throw new Error(t.settings.config.autosaveFailed)
        }
      })
      .catch(error => {
        setHermesConfigCache(config)
        notifyError(error, t.settings.config.autosaveFailed)
      })
  }

  return (
    <ToggleRow
      checked={checked}
      description={a.resumeLastSessionDesc}
      disabled={!config}
      id={settingElementId(ids.resumeLastSession)}
      label={a.resumeLastSessionTitle}
      onChange={update}
    />
  )
}

// UI scale presets, as zoom percentages. 100 is Chromium's actual-size and
// Aino's shipped design baseline. Ids double as the percent
// values sent to the main process. A Cmd/Ctrl +/- step landing between
// presets highlights nothing, and the row description keeps showing the
// exact current percent.
const UI_SCALE_PRESETS = ['90', '100', '110', '125', '150', '175'] as const
const ids = SETTING_IDS.appearance
type UiScalePreset = (typeof UI_SCALE_PRESETS)[number]

function matchUiScalePreset(percent: number): UiScalePreset | null {
  return UI_SCALE_PRESETS.find(preset => Number(preset) === percent) ?? null
}

type AppearanceCategory = 'theme' | 'layout' | 'chat' | 'habits' | 'pets'

const CATEGORY_PAGES: Record<AppearanceSubpageId, AppearanceCategory> = {
  general: 'habits',
  theme: 'theme',
  typography: 'theme',
  'window-layout': 'layout',
  'chat-display': 'chat',
  pet: 'pets'
}

function categoryFor(page: string | undefined): AppearanceCategory | undefined {
  return page ? CATEGORY_PAGES[page as AppearanceSubpageId] : undefined
}

function disclosureFor(setting: string): string | undefined {
  if (setting === SETTING_IDS.appearance.terminalFont) {
    return 'terminal'
  }

  if ([SETTING_IDS.appearance.composerPopout, SETTING_IDS.appearance.minimizeToTray].includes(setting)) {
    return 'window'
  }

  if ([SETTING_IDS.appearance.translucency, SETTING_IDS.appearance.backdrop].includes(setting)) {
    return 'transparency'
  }

  if ([SETTING_IDS.appearance.toolView, SETTING_IDS.appearance.hideCodeDiffs].includes(setting)) {
    return 'tools'
  }

  if (
    [SETTING_IDS.appearance.reactions, SETTING_IDS.appearance.vibeHearts, SETTING_IDS.appearance.embeds].includes(
      setting
    )
  ) {
    return 'interactions'
  }

  return undefined
}

interface AppearanceSettingsProps {
  subpage?: string
}

export function AppearanceSettings({ subpage }: AppearanceSettingsProps = {}) {
  const { t, isSavingLocale } = useI18n()
  const { mode, setMode } = useTheme()
  const toolViewMode = useStore($toolViewMode)
  const toolViewShadowed = useStore($modeShadowed('toolViewMode'))
  const hideCodeDiffs = useStore($hideCodeDiffs)
  const hideCodeDiffsShadowed = useStore($modeShadowed('hideCodeDiffs'))
  const hideThreadTimeline = useStore($hideThreadTimeline)
  const reasoningCollapsedByDefault = useStore($reasoningCollapsedByDefault)
  const reasoningCollapsedShadowed = useStore($modeShadowed('reasoningCollapsedByDefault'))
  const zoomPercent = useStore($zoomPercent)
  const chatTextScale = useStore($chatTextScale)
  const embedMode = useStore($embedMode)
  const embedAllowed = useStore($embedAllowed)
  const userBubbleTransparency = useStore($userBubbleTransparency)
  const textDirection = useStore($textDirection)
  const reactionsEnabled = useStore($reactionsEnabled)
  const tipsEnabled = useStore($tipsEnabled)
  const toursEnabled = useStore($toursEnabled)
  const spentTips = useStore($spentTipCount)
  const vibeHeartsEnabled = useStore($vibeHeartsEnabled)
  const introSplash = useStore($introSplash)
  const a = t.settings.appearance

  const [selectedCategory, setSelectedCategory] = useState<AppearanceCategory>(() => categoryFor(subpage) ?? 'theme')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [previousSubpage, setPreviousSubpage] = useState(subpage)

  if (subpage !== previousSubpage) {
    setPreviousSubpage(subpage)
    setSelectedCategory(categoryFor(subpage) ?? 'theme')
  }

  const activeCategory = selectedCategory
  // Hidden tabs keep editors mounted; release native peek holds when their
  // slider disappears or the settings workspace closes mid-drag.
  useEffect(() => resetTranslucencyPeek, [activeCategory, expanded])
  const pendingSetting = useSettingDeepLink('config:appearance', page => categoryFor(page) === activeCategory)
  const targetPage = pendingSetting ? settingDefinition('config:appearance', pendingSetting)?.subpage : undefined
  const targetDisclosure = pendingSetting ? disclosureFor(pendingSetting) : undefined

  useEffect(() => {
    if (targetPage) {
      setSelectedCategory(categoryFor(targetPage) ?? 'theme')
    }

    if (targetDisclosure) {
      setExpanded(previous => new Set([...previous, targetDisclosure]))
    }
  }, [targetDisclosure, targetPage])

  const toggleDisclosure = (id: string) =>
    setExpanded(previous => {
      const next = new Set(previous)

      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }

      return next
    })

  const c = t.appearancePage

  const modeOptions = MODE_OPTIONS.map(({ id, icon }) => ({ icon, id, label: t.settings.modeOptions[id].label }))

  const toolOptions = [
    { id: 'product', label: a.product },
    { id: 'technical', label: a.technical }
  ] as const

  // A row whose value Simple mode currently decides says so where the
  // preference text would otherwise promise a persistence it cannot deliver.
  const withModeNote = (description: string, shadowed: boolean) =>
    shadowed ? `${description} ${t.interfaceMode.sessionNote}` : description

  const textDirectionOptions = TEXT_DIRECTIONS.map(id => ({
    id,
    label: a.textDirection[id]
  })) satisfies readonly { id: TextDirection; label: string }[]

  const embedOptions = [
    { id: 'ask', label: a.embedsAsk },
    { id: 'always', label: a.embedsAlways },
    { id: 'off', label: a.embedsOff }
  ] as const satisfies readonly { id: EmbedMode; label: string }[]

  const uiScaleOptions = UI_SCALE_PRESETS.map(preset => ({
    id: preset,
    label: `${preset}%${preset === '100' ? ' · ' + c.defaultSuffix : ''}`
  }))

  const matchedScalePreset = matchUiScalePreset(zoomPercent)

  return (
    <SettingsContent>
      <div className="appearance-page">
        <header className="appearance-page-intro">
          <SectionHeading icon={Palette} page title={a.title} />
          <p>{c.description}</p>
        </header>
        <Tabs
          className="gap-0"
          onValueChange={value => setSelectedCategory(value as AppearanceCategory)}
          value={activeCategory}
        >
          <TabsList aria-label={c.tabsLabel} className="appearance-tabs" size="navigation">
            {(['theme', 'layout', 'chat', 'habits', 'pets'] as const).map(category => (
              <TabsTrigger key={category} size="navigation" value={category}>
                {c.categories[category]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent forceMount hidden={activeCategory !== 'theme'} value="theme">
            <div className="appearance-split">
              <div className="appearance-fields">
                <section className="appearance-group">
                  <SectionHeading icon={SunMoon} title={a.colorMode} />
                  <div
                    aria-label={a.colorMode}
                    className="appearance-mode-cards"
                    id={settingElementId(ids.theme)}
                    role="group"
                  >
                    {modeOptions.map(option => (
                      <button
                        aria-pressed={mode === option.id}
                        className="appearance-mode-card"
                        data-mode={option.id}
                        key={option.id}
                        onClick={() => {
                          triggerHaptic('crisp')
                          setMode(option.id)
                        }}
                        type="button"
                      >
                        <div aria-hidden="true" className="appearance-mode-mini">
                          <div>
                            <i />
                            <i />
                            <i />
                          </div>
                          <div>
                            <i />
                            <i />
                            <i />
                          </div>
                        </div>
                        <span>
                          {option.label}
                          <Check />
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
                <AppearanceGroup icon={Type} title={c.reading}>
                  <ListRow
                    action={
                      <AppearanceSelect
                        label={a.uiScaleTitle}
                        onChange={id => {
                          triggerHaptic('selection')
                          setZoomPercent(Number(id))
                        }}
                        options={
                          matchedScalePreset
                            ? uiScaleOptions
                            : [{ id: String(zoomPercent), label: String(zoomPercent) + '%' }, ...uiScaleOptions]
                        }
                        value={String(zoomPercent)}
                      />
                    }
                    description={c.uiScaleDescription}
                    id={settingElementId(ids.uiScale)}
                    title={a.uiScaleTitle}
                  />
                  <ListRow
                    action={
                      <AppearanceSelect
                        label={a.chatTextScaleTitle}
                        onChange={value => {
                          triggerHaptic('selection')
                          setChatTextScale(Number(value))
                        }}
                        options={CHAT_TEXT_SCALE_PRESETS.map(value => ({
                          id: String(value),
                          label: `${value}%${value === DEFAULT_CHAT_TEXT_SCALE ? ' · ' + c.defaultSuffix : ''}`
                        }))}
                        value={String(chatTextScale)}
                      />
                    }
                    description={c.chatTextDescription}
                    id={settingElementId(ids.chatTextScale)}
                    title={a.chatTextScaleTitle}
                  />
                  <ChatFontSetting compact id={settingElementId(ids.chatFont)} />
                </AppearanceGroup>
                <AppearanceDisclosure
                  icon={SquareTerminal}
                  onToggle={() => toggleDisclosure('terminal')}
                  open={expanded.has('terminal')}
                  title={a.terminalFontTitle}
                >
                  <div id={settingElementId(ids.terminalFont)}>
                    <TerminalFontSetting />
                  </div>
                </AppearanceDisclosure>
              </div>
              <AppearanceLivePreview variant="theme" />
            </div>
          </TabsContent>
          <TabsContent forceMount hidden={activeCategory !== 'layout'} value="layout">
            <AppearanceWindowSettings expanded={expanded} onToggle={toggleDisclosure} />
          </TabsContent>
          <TabsContent forceMount hidden={activeCategory !== 'chat'} value="chat">
            <div className="appearance-split">
              <div className="appearance-fields">
                <AppearanceGroup icon={MessageCircle} title={c.categories.chat}>
                  <ListRow
                    action={
                      <AppearanceSelect
                        label={a.textDirectionTitle}
                        onChange={setTextDirection}
                        options={textDirectionOptions}
                        value={textDirection}
                      />
                    }
                    description={a.textDirectionDesc}
                    id={settingElementId(ids.textDirection)}
                    title={a.textDirectionTitle}
                  />
                  <ListRow
                    action={
                      // Same peek as the window lever: the bubble being tuned sits
                      // behind this overlay, so the overlay ghosts while the hand is
                      // on the slider.
                      <div className="flex items-center gap-3" data-translucency-peek-scope="">
                        <TranslucencySlider
                          label={a.userBubbleTitle}
                          onChange={setUserBubbleTransparency}
                          value={userBubbleTransparency}
                        />
                      </div>
                    }
                    description={a.userBubbleDesc}
                    id={settingElementId(ids.userBubble)}
                    title={a.userBubbleTitle}
                  />
                  <ToggleRow
                    checked={hideThreadTimeline}
                    description={a.hideThreadTimelineDesc}
                    id={settingElementId(ids.hideThreadTimeline)}
                    label={a.hideThreadTimelineTitle}
                    onChange={setHideThreadTimeline}
                  />
                  <ToggleRow
                    checked={reasoningCollapsedByDefault}
                    description={withModeNote(a.reasoningCollapsedDesc, reasoningCollapsedShadowed)}
                    id={settingElementId(ids.reasoningCollapsed)}
                    label={a.reasoningCollapsedTitle}
                    onChange={setReasoningCollapsedByDefault}
                  />
                </AppearanceGroup>
                <AppearanceDisclosure
                  icon={SquareTerminal}
                  onToggle={() => toggleDisclosure('tools')}
                  open={expanded.has('tools')}
                  title={c.toolResults}
                >
                  <ListRow
                    action={
                      <AppearanceSelect
                        label={a.toolViewTitle}
                        onChange={id => {
                          triggerHaptic('selection')
                          setToolViewMode(id)
                        }}
                        options={toolOptions}
                        value={toolViewMode}
                      />
                    }
                    description={withModeNote(a.toolViewDesc, toolViewShadowed)}
                    id={settingElementId(ids.toolView)}
                    title={a.toolViewTitle}
                  />
                  <ToggleRow
                    checked={hideCodeDiffs}
                    description={withModeNote(a.hideCodeDiffsDesc, hideCodeDiffsShadowed)}
                    id={settingElementId(ids.hideCodeDiffs)}
                    label={a.hideCodeDiffsTitle}
                    onChange={setHideCodeDiffs}
                  />
                </AppearanceDisclosure>
                <AppearanceDisclosure
                  icon={Sparkles}
                  onToggle={() => toggleDisclosure('interactions')}
                  open={expanded.has('interactions')}
                  title={c.interactions}
                >
                  <ToggleRow
                    checked={reactionsEnabled}
                    description={a.reactionsDesc}
                    id={settingElementId(ids.reactions)}
                    label={a.reactionsTitle}
                    onChange={setReactionsEnabled}
                  />
                  <ToggleRow
                    checked={vibeHeartsEnabled}
                    description={a.vibeHeartsDesc}
                    id={settingElementId(ids.vibeHearts)}
                    label={a.vibeHeartsTitle}
                    onChange={setVibeHeartsEnabled}
                  />
                  <ListRow
                    action={
                      <div className="flex flex-col items-end gap-1.5">
                        <AppearanceSelect
                          label={a.embedsTitle}
                          onChange={id => {
                            triggerHaptic('selection')
                            setEmbedMode(id)
                          }}
                          options={embedOptions}
                          value={embedMode}
                        />
                        {embedAllowed.length > 0 && (
                          <Button
                            onClick={() => {
                              triggerHaptic('selection')
                              clearEmbedAllowed()
                            }}
                            size="inline"
                            variant="text"
                          >
                            {a.embedsReset(embedAllowed.length)}
                          </Button>
                        )}
                      </div>
                    }
                    description={a.embedsDesc}
                    id={settingElementId(ids.embeds)}
                    title={a.embedsTitle}
                  />
                </AppearanceDisclosure>
              </div>
              <AppearanceLivePreview variant="chat" />
            </div>
          </TabsContent>
          <TabsContent forceMount hidden={activeCategory !== 'habits'} value="habits">
            <AppearanceGroup icon={Languages} title={c.languageStartup}>
              <ListRow
                action={<LanguageSwitcher />}
                description={isSavingLocale ? t.language.saving : t.language.description}
                id={settingElementId(ids.language)}
                title={t.language.label}
              />
              <ToggleRow
                checked={introSplash}
                description={a.introSplashDesc}
                id={settingElementId(ids.introSplash)}
                label={a.introSplashTitle}
                onChange={setIntroSplash}
              />
              <ResumeLastSessionSetting />
            </AppearanceGroup>
            <AppearanceGroup icon={Lightbulb} title={c.guidance}>
              <ListRow
                action={
                  <div className="flex flex-col items-end gap-1.5">
                    <Switch
                      aria-label={a.tipsTitle}
                      checked={tipsEnabled}
                      onCheckedChange={on => {
                        triggerHaptic('selection')
                        setTipsEnabled(on)
                      }}
                    />
                    {/* A tip shows once (✕ or timer), so this is the only way to a
                  second lap. It appears once there is something to bring back. */}
                    {spentTips > 0 && (
                      <Button
                        onClick={() => {
                          triggerHaptic('selection')
                          resetTips()
                        }}
                        size="inline"
                        variant="text"
                      >
                        {a.tipsReset(spentTips)}
                      </Button>
                    )}
                  </div>
                }
                description={a.tipsDesc}
                id={settingElementId(ids.tips)}
                title={a.tipsTitle}
              />
              <ToggleRow
                checked={toursEnabled}
                description={a.toursDesc}
                id={settingElementId(ids.tours)}
                label={a.toursTitle}
                onChange={setToursEnabled}
              />
            </AppearanceGroup>
            <AppearanceHabitsPreview />
            {(subpage === undefined || subpage === 'general') && <AppearanceExtraSlot />}
          </TabsContent>
          <TabsContent forceMount hidden={activeCategory !== 'pets'} value="pets">
            <div id={settingElementId(ids.pet)}>
              <PetSettings />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </SettingsContent>
  )
}
