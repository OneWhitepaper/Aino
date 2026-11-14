import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { Slider } from '@/components/ui/slider'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Layers3 as Blend, Monitor } from '@/lib/icons'
import { $backdrop, setBackdrop } from '@/store/backdrop'
import { $composerPopoutGesturesEnabled, setComposerPopoutGesturesEnabled } from '@/store/composer-popout'
import {
  $interfaceMode,
  $modeShadowed,
  INTERFACE_MODES,
  type InterfaceMode,
  setInterfaceMode
} from '@/store/interface-mode'
import { $fileBrowserOpen, setFileBrowserOpen } from '@/store/layout'
import { $sessionListDensity, type SessionListDensity, setSessionListDensity } from '@/store/session-list-density'
import { $tabStripDefault, setTabStripDefault, type TabStripDefault } from '@/store/tabstrip-prefs'
import {
  $translucency,
  beginTranslucencyPeek,
  endTranslucencyPeek,
  GLASS_IS_WINDOWS,
  GLASS_SCOPES,
  GLASS_SUPPORTED,
  glassMaterialForPicker,
  glassMaterialsFor,
  pulseTranslucencyPeek,
  setTranslucency,
  setTranslucencyFade,
  setTranslucencyMaterial,
  setTranslucencyMode,
  setTranslucencyScope,
  TRANSLUCENCY_MAX,
  TRANSLUCENCY_MIN,
  TRANSLUCENCY_STEP,
  TRANSLUCENCY_SUPPORTED
} from '@/store/translucency'

import { AppearanceDisclosure, AppearanceGroup, AppearanceSelect } from './appearance-controls'
import { AppearanceLivePreview } from './appearance-live-preview'
import { MinimizeToTraySetting } from './minimize-to-tray-setting'
import { ListRow, ToggleRow } from './primitives'
import { SETTING_IDS, settingElementId } from './settings-manifest'

const ids = SETTING_IDS.appearance

// Keys a range input treats as a step, so the peek can flash the live window
// for keyboard adjustment the way a pointer drag holds it open.
const SLIDER_STEP_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp'
])

interface TranslucencySliderProps {
  label: string
  onChange: (value: number) => void
  value: number
}

/**
 * One 0–100 lever, used up to twice: Clear's window opacity, and under Glass
 * the tint plus an optional native fade.
 *
 * Peek while the hand is on it — the overlay (scrim + near-opaque card) ghosts
 * so the window behind IS the live preview. The pointer pair covers
 * mouse/touch drags; the keyboard path pulses per step instead, and blur ends
 * any residual hold.
 */
export function TranslucencySlider({ label, onChange, value }: TranslucencySliderProps) {
  return (
    <>
      <Slider
        aria-label={label}
        max={TRANSLUCENCY_MAX}
        min={TRANSLUCENCY_MIN}
        onBlur={endTranslucencyPeek}
        onChange={event => {
          triggerHaptic('selection')
          onChange(Number(event.target.value))
        }}
        onKeyDown={event => {
          if (SLIDER_STEP_KEYS.has(event.key)) {
            pulseTranslucencyPeek()
          }
        }}
        onLostPointerCapture={endTranslucencyPeek}
        onPointerDown={beginTranslucencyPeek}
        onPointerUp={endTranslucencyPeek}
        step={TRANSLUCENCY_STEP}
        value={value}
      />
      <span className="w-9 text-right text-[length:var(--conversation-caption-font-size)] tabular-nums text-(--ui-text-tertiary)">
        {value}%
      </span>
    </>
  )
}

interface GlassRowProps {
  children: ReactNode
  label: string
}

/** A labelled control in the Glass sub-panel: tint, fade, frost, area. */
function GlassRow({ children, label }: GlassRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
        {label}
      </span>
      {children}
    </div>
  )
}

interface AppearanceWindowSettingsProps {
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
}

export function AppearanceWindowSettings({ expanded, onToggle }: AppearanceWindowSettingsProps) {
  const { t } = useI18n()
  const a = t.settings.appearance
  const c = t.appearancePage
  const interfaceMode = useStore($interfaceMode)
  const sessionListDensity = useStore($sessionListDensity)
  const tabStripDefault = useStore($tabStripDefault)
  const fileBrowserOpen = useStore($fileBrowserOpen)
  const fileBrowserShadowed = useStore($modeShadowed('fileBrowserOpen'))
  const composerPopoutGesturesEnabled = useStore($composerPopoutGesturesEnabled)
  const translucency = useStore($translucency)
  const glassMode = translucency.mode === 'glass' && GLASS_SUPPORTED
  const backdrop = useStore($backdrop)

  const sessionDensityOptions = [
    { id: 'compact', label: a.sessionDensityCompact },
    { id: 'comfortable', label: a.sessionDensityComfortable },
    { id: 'detailed', label: a.sessionDensityDetailed }
  ] as const satisfies readonly { id: SessionListDensity; label: string }[]

  const interfaceModeOptions = INTERFACE_MODES.map(id => ({
    id,
    label: t.interfaceMode[id].label
  })) satisfies readonly { id: InterfaceMode; label: string }[]

  const tabStripOptions = [
    { id: 'auto', label: a.tabStripAuto },
    { id: 'always', label: a.tabStripAlways },
    { id: 'never', label: a.tabStripNever }
  ] as const satisfies readonly { id: TabStripDefault; label: string }[]

  const withModeNote = (description: string, shadowed: boolean) =>
    shadowed ? `${description} ${t.interfaceMode.sessionNote}` : description

  // Preserve the native preview pulse after mode, material and scope changes.
  const pickTranslucency =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      triggerHaptic('selection')
      set(value)

      if (translucency.intensity > 0) {
        pulseTranslucencyPeek()
      }
    }

  return (
    <div className="appearance-split">
      <div className="appearance-fields">
        <AppearanceGroup icon={Monitor} title={c.categories.layout}>
          <ListRow
            action={
              <AppearanceSelect
                label={t.interfaceMode.title}
                onChange={setInterfaceMode}
                options={interfaceModeOptions}
                value={interfaceMode}
              />
            }
            description={t.interfaceMode.hint}
            id={settingElementId(ids.interfaceMode)}
            title={t.interfaceMode.title}
          />
          <ToggleRow
            checked={fileBrowserOpen}
            description={withModeNote(a.fileBrowserDesc, fileBrowserShadowed)}
            id={settingElementId(ids.fileBrowser)}
            label={a.fileBrowserTitle}
            onChange={setFileBrowserOpen}
          />
          <ListRow
            action={
              <AppearanceSelect
                label={a.sessionDensityTitle}
                onChange={id => {
                  triggerHaptic('selection')
                  setSessionListDensity(id)
                }}
                options={sessionDensityOptions}
                value={sessionListDensity}
              />
            }
            description={a.sessionDensityDesc}
            id={settingElementId(ids.sessionDensity)}
            title={a.sessionDensityTitle}
          />
          <ListRow
            action={
              <AppearanceSelect
                label={a.tabStripTitle}
                onChange={id => {
                  triggerHaptic('selection')
                  setTabStripDefault(id)
                }}
                options={tabStripOptions}
                value={tabStripDefault}
              />
            }
            description={a.tabStripDesc}
            id={settingElementId(ids.tabStrip)}
            title={a.tabStripTitle}
          />
        </AppearanceGroup>
        <AppearanceDisclosure
          icon={Monitor}
          onToggle={() => onToggle('window')}
          open={expanded.has('window')}
          title={c.windowBehavior}
        >
          <MinimizeToTraySetting />
          <ToggleRow
            checked={composerPopoutGesturesEnabled}
            description={a.composerPopoutDesc}
            id={settingElementId(ids.composerPopout)}
            label={a.composerPopoutTitle}
            onChange={setComposerPopoutGesturesEnabled}
          />
        </AppearanceDisclosure>
        <AppearanceDisclosure
          icon={Blend}
          onToggle={() => onToggle('transparency')}
          open={expanded.has('transparency')}
          title={c.transparency}
        >
          {TRANSLUCENCY_SUPPORTED && (
            <ListRow
              action={
                <div
                  className="flex items-center gap-3"
                  // Arms the peek for the overlay this row lives in — the
                  // ghosting rules in styles.css scope to it, so no other
                  // overlay pays for an opacity transition it never uses.
                  data-translucency-peek-scope=""
                >
                  {GLASS_SUPPORTED && (
                    <SegmentedControl
                      onChange={pickTranslucency(setTranslucencyMode)}
                      options={[
                        { id: 'clear' as const, label: a.translucencyModeClear },
                        { id: 'glass' as const, label: a.translucencyModeGlass }
                      ]}
                      value={translucency.mode}
                    />
                  )}
                  {/* Clear has one lever and it belongs beside the mode. Glass
                    has four controls, so they move into the labelled panel
                    below rather than crowding this line with an unlabelled
                    slider that means something different. */}
                  {!glassMode && (
                    <TranslucencySlider
                      label={a.translucencyTitle}
                      onChange={setTranslucency}
                      value={translucency.intensity}
                    />
                  )}
                </div>
              }
              below={
                glassMode ? (
                  <div className="mt-3 flex flex-col gap-2.5" data-translucency-peek-scope="">
                    <GlassRow label={a.translucencyTintTitle}>
                      <TranslucencySlider
                        label={a.translucencyTintTitle}
                        onChange={setTranslucency}
                        value={translucency.intensity}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyFadeTitle}>
                      <TranslucencySlider
                        label={a.translucencyFadeTitle}
                        onChange={setTranslucencyFade}
                        value={translucency.fade}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyFrostTitle}>
                      <SegmentedControl
                        onChange={pickTranslucency(setTranslucencyMaterial)}
                        // Windows renders four rungs as three backdrops, so it
                        // is offered three; a frost saved on a Mac highlights
                        // the rung that renders the same backdrop here.
                        options={glassMaterialsFor(GLASS_IS_WINDOWS).map(material => ({
                          id: material,
                          label: a.translucencyFrost[material]
                        }))}
                        value={glassMaterialForPicker(translucency.material, GLASS_IS_WINDOWS)}
                      />
                    </GlassRow>
                    <GlassRow label={a.translucencyScopeTitle}>
                      <SegmentedControl
                        onChange={pickTranslucency(setTranslucencyScope)}
                        options={GLASS_SCOPES.map(scope => ({
                          id: scope,
                          label: a.translucencyScope[scope]
                        }))}
                        value={translucency.scope}
                      />
                    </GlassRow>
                  </div>
                ) : undefined
              }
              description={glassMode ? a.translucencyGlassDesc : a.translucencyDesc}
              id={settingElementId(ids.translucency)}
              title={a.translucencyTitle}
            />
          )}
          <ToggleRow
            checked={backdrop}
            description={a.backdropDesc}
            id={settingElementId(ids.backdrop)}
            label={a.backdropTitle}
            onChange={setBackdrop}
          />
        </AppearanceDisclosure>
      </div>
      <AppearanceLivePreview variant="layout" />
    </div>
  )
}
