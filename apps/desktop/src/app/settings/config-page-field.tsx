import './config-page-field.css'

import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { useI18n } from '@/i18n'
import type { ConfigPageModeCopy } from '@/i18n/types_config_pages'
import { prettyName } from '@/lib/text'

import { ConfigField } from './config-field'
import { FIELD_DESCRIPTIONS, FIELD_LABELS } from './constants'
import { fieldCopyForSchemaKey } from './field-copy'
import { ListRow } from './primitives'
import { WorkspaceListInput } from './workspace-settings'

export type ConfigPageFieldProps = ComponentProps<typeof ConfigField>

const MODE_GROUPS = {
  'approvals.mode': 'approvals',
  'agent.image_input_mode': 'images',
  'voice.voice_chat_mode': 'voice'
} as const

const MODE_VALUES: Record<string, readonly string[]> = {
  'approvals.mode': ['manual', 'smart', 'off'],
  'agent.image_input_mode': ['auto', 'native', 'text'],
  'voice.voice_chat_mode': ['chained', 'gpt-live']
}

const RATIO_FIELDS = new Set(['compression.threshold', 'compression.target_ratio'])
const LIST_FIELDS = new Set(['command_allowlist', 'toolsets'])

interface ModeCardsProps {
  description: ReactNode
  label: string
  onChange: (value: unknown) => void
  options: string[]
  optionCopy: Record<string, ConfigPageModeCopy>
  optionLabels?: Record<string, string>
  schemaKey: string
  value: unknown
}

function ModeCards({
  description,
  label,
  onChange,
  options,
  optionCopy,
  optionLabels,
  schemaKey,
  value
}: ModeCardsProps) {
  const name = useId()

  return (
    <ListRow
      below={
        <div aria-label={label} className="config-page-mode-list" role="radiogroup">
          {options.map(option => (
            <label className="config-page-mode-option" key={option}>
              <input
                checked={value === option}
                name={name}
                onChange={() => onChange(option)}
                type="radio"
                value={option}
              />
              <span>
                <strong>{optionLabels?.[option] ?? optionCopy[option].label}</strong>
                <span className="config-page-mode-description">{optionCopy[option].description}</span>
              </span>
            </label>
          ))}
        </div>
      }
      data-tour={`field-${schemaKey}`}
      description={description}
      title={label}
      wide
    />
  )
}

function ratioToPercent(value: number): number {
  const [coefficient, exponent = '0'] = String(value).split('e')

  return Number(`${coefficient}e${Number(exponent) + 2}`)
}

function percentToRatio(value: number): number {
  const [coefficient, exponent = '0'] = String(value).split('e')

  return Number(`${coefficient}e${Number(exponent) - 2}`)
}

function PercentageControl({
  invalidMessage,
  label,
  onChange,
  preciseLabel,
  unit,
  value
}: {
  invalidMessage: string
  label: string
  onChange: (value: unknown) => void
  preciseLabel: string
  unit: string
  value: number
}) {
  const percentage = ratioToPercent(value)
  const [draft, setDraft] = useState(String(percentage))
  const [invalid, setInvalid] = useState(false)
  const focused = useRef(false)
  const errorId = useId()

  useEffect(() => {
    if (!focused.current) {
      setDraft(String(percentage))
      setInvalid(false)
    }
  }, [percentage])

  const commit = () => {
    const next = Number(draft)

    if (draft.trim() === '' || !Number.isFinite(next)) {
      setInvalid(true)

      return
    }

    setInvalid(false)
    setDraft(String(next))

    if (next !== percentage) {
      onChange(percentToRatio(next))
    }
  }

  return (
    <div className="config-page-percentage">
      <div className="config-page-percentage-controls">
        <Slider
          aria-label={label}
          className="config-page-percentage-slider"
          max={Math.max(100, percentage)}
          min={Math.min(0, percentage)}
          onChange={event => {
            const next = Number(event.target.value)
            setDraft(String(next))
            setInvalid(false)

            if (next !== percentage) {
              onChange(percentToRatio(next))
            }
          }}
          step="any"
          value={percentage}
        />
        <Input
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid || undefined}
          aria-label={`${label} · ${preciseLabel}`}
          containerClassName="config-page-percentage-number"
          onBlur={() => {
            focused.current = false
            commit()
          }}
          onChange={event => {
            setDraft(event.target.value)
            setInvalid(false)
          }}
          onFocus={() => {
            focused.current = true
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.currentTarget.blur()
            }
          }}
          step="any"
          suffix={unit}
          type="number"
          value={draft}
        />
      </div>
      {invalid && (
        <p className="config-page-number-error" id={errorId} role="alert">
          {invalidMessage}
        </p>
      )}
    </div>
  )
}

function configPageFieldCopy(props: ConfigPageFieldProps, t: ReturnType<typeof useI18n>['t']) {
  const copy = t.settings.configPages
  const field = copy.fields[props.schemaKey]

  const label =
    props.labelOverride ??
    field?.label ??
    fieldCopyForSchemaKey(t.settings.fieldLabels, props.schemaKey) ??
    fieldCopyForSchemaKey(FIELD_LABELS, props.schemaKey) ??
    prettyName(props.schemaKey.split('.').pop() ?? props.schemaKey)

  const description =
    props.descriptionOverride ??
    field?.description ??
    fieldCopyForSchemaKey(t.settings.fieldDescriptions, props.schemaKey) ??
    fieldCopyForSchemaKey(FIELD_DESCRIPTIONS, props.schemaKey) ??
    props.schema.description

  return { field, label, description }
}

function modeOptionsKnown(
  options: string[] | undefined,
  knownOptions: readonly string[],
  value: unknown
): options is string[] {
  return Boolean(
    options?.length &&
    knownOptions.includes(String(value)) &&
    options.includes(String(value)) &&
    options.every(option => knownOptions.includes(option))
  )
}

/** Page presentation only; configuration ownership and scoped autosave remain with the caller. */
export function ConfigPageField(props: ConfigPageFieldProps) {
  const { t } = useI18n()
  const copy = t.settings.configPages
  const { field, label, description } = configPageFieldCopy(props, t)

  const descriptionNode = (
    <>
      {description}
      {props.descriptionExtra}
      {field?.help && <span className="config-page-field-help">{field.help}</span>}
    </>
  )

  const unit = props.unit ?? (field?.unit ? copy.units[field.unit] : undefined)
  const options = props.enumOptions ?? props.schema.options?.map(String)
  const modeGroup = MODE_GROUPS[props.schemaKey as keyof typeof MODE_GROUPS]
  const knownOptions = MODE_VALUES[props.schemaKey]

  if (modeGroup && modeOptionsKnown(options, knownOptions, props.value)) {
    return (
      <ModeCards
        description={descriptionNode}
        label={label}
        onChange={props.onChange}
        optionCopy={copy.modes[modeGroup]}
        optionLabels={props.optionLabels}
        options={options}
        schemaKey={props.schemaKey}
        value={props.value}
      />
    )
  }

  if (
    RATIO_FIELDS.has(props.schemaKey) &&
    typeof props.value === 'number' &&
    Number.isFinite(props.value) &&
    Number.isFinite(ratioToPercent(props.value))
  ) {
    return (
      <ListRow
        below={
          <PercentageControl
            invalidMessage={copy.invalidNumber}
            label={label}
            onChange={props.onChange}
            preciseLabel={copy.percentPrecise}
            unit={copy.units.percent}
            value={props.value}
          />
        }
        data-tour={`field-${props.schemaKey}`}
        description={descriptionNode}
        title={label}
        wide
      />
    )
  }

  if (
    LIST_FIELDS.has(props.schemaKey) &&
    (props.value == null || (Array.isArray(props.value) && props.value.every(value => typeof value === 'string')))
  ) {
    return (
      <ListRow
        below={
          <div className="config-page-list-editor">
            <WorkspaceListInput
              label={label}
              onChange={props.onChange}
              placeholder={copy.listPlaceholder}
              value={props.value}
            />
          </div>
        }
        data-tour={`field-${props.schemaKey}`}
        description={descriptionNode}
        title={label}
        wide
      />
    )
  }

  return (
    <ConfigField
      {...props}
      descriptionExtra={undefined}
      descriptionOverride={descriptionNode}
      enumOptions={
        modeGroup && options && typeof props.value === 'string' && !options.includes(props.value)
          ? [...options, props.value]
          : props.enumOptions
      }
      labelOverride={label}
      unit={unit}
    />
  )
}
