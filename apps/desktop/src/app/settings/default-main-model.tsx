import './default-main-model.css'

import { Check, WandSparkles } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { modelSourceCopy } from '@/i18n/model-source'

export type DefaultMainModelSource = 'aino' | 'provider' | 'custom'

export interface DefaultMainModelProps {
  appliedModelLabel: string
  appliedSourceLabel: string
  source: DefaultMainModelSource
  onSourceChange: (source: DefaultMainModelSource) => void
  customControls: ReactNode
  providerControls: ReactNode
  builtinControls: ReactNode
  dirty: boolean
  applying: boolean
  canApply: boolean
  onApply: () => void
  defaults?: ReactNode
  notice?: ReactNode
}

export function DefaultMainModel({
  appliedModelLabel,
  appliedSourceLabel,
  applying,
  builtinControls,
  canApply,
  customControls,
  providerControls,
  defaults,
  dirty,
  notice,
  onApply,
  onSourceChange,
  source
}: DefaultMainModelProps) {
  const { locale, t } = useI18n()
  const copy = t.settings.model.defaultMain
  const sources = modelSourceCopy(locale)

  const descriptions = {
    aino: copy.builtInDescription,
    provider: sources.providerDescription,
    custom: sources.customDescription
  }

  return (
    <div className="default-main-model">
      <div aria-live="polite" className="default-main-model-current">
        <div aria-hidden className="default-main-model-current-icon">
          <WandSparkles strokeWidth={1.65} />
        </div>
        <div className="default-main-model-current-copy">
          <p className="default-main-model-current-label">{copy.appliedLabel}</p>
          <div className="default-main-model-current-value">
            <span>{appliedModelLabel || copy.unconfigured}</span>
            {appliedSourceLabel && <span className="default-main-model-current-source">{appliedSourceLabel}</span>}
          </div>
        </div>
        {appliedModelLabel && (
          <span className="default-main-model-current-state">
            <Check strokeWidth={1.65} />
            {copy.applied}
          </span>
        )}
      </div>
      <section className="default-main-model-form">
        <div className="default-main-model-heading">
          <h2>{copy.title}</h2>
        </div>
        <div className="default-main-model-fields">
          <div className="default-main-model-source-row">
            <div className="default-main-model-source-choice">
              <div aria-label={copy.sourceLabel} role="group">
                <SegmentedControl
                  className="default-main-model-source-options"
                  disabled={applying}
                  onChange={onSourceChange}
                  options={[
                    { id: 'aino', label: copy.builtIn },
                    { id: 'provider', label: sources.providerSource },
                    { id: 'custom', label: sources.customSource }
                  ]}
                  sizing="content"
                  value={source}
                />
              </div>
              <p className="default-main-model-source-description" hidden={source === 'aino'}>
                {descriptions[source]}
              </p>
            </div>
          </div>
          <div className="default-main-model-controls" hidden={source !== 'custom'}>
            {customControls}
          </div>
          <div className="default-main-model-controls" hidden={source !== 'provider'}>
            {providerControls}
          </div>
          <div className="default-main-model-controls default-main-model-controls-builtin" hidden={source !== 'aino'}>
            {builtinControls}
          </div>
        </div>
        {notice}
        <div className="default-main-model-actions">
          <p className="default-main-model-scope-hint">{copy.scopeHint}</p>
          <span
            aria-live="polite"
            className={dirty ? 'default-main-model-save-state' : 'sr-only'}
            data-pending={dirty || undefined}
          >
            {dirty ? copy.pending : copy.unchanged}
          </span>
          <Button
            aria-label={applying ? t.settings.model.applying : copy.apply}
            disabled={!dirty || !canApply || applying}
            loading={applying}
            onClick={onApply}
            size="sm"
            type="button"
          >
            {applying ? t.settings.model.applying : copy.apply}
          </Button>
        </div>
      </section>
      {defaults && (
        <details className="default-main-model-defaults">
          <summary>{copy.defaultsTitle}</summary>
          <div>{defaults}</div>
        </details>
      )}
    </div>
  )
}
