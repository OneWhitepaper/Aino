import type { Translations } from '@/i18n'
import type { AutomationBlueprint, AutomationBlueprintField } from '@/types/hermes'

export interface LocalizedBlueprintCopy {
  title: string
  description: string
}

export interface LocalizedBlueprintField extends AutomationBlueprintField {
  optionLabels: Record<string, string>
  displayDefault?: string
}

/** Resolve built-in blueprint copy while preserving plugin/backend text. */
export function localizedBlueprintCopy(
  blueprint: Pick<AutomationBlueprint, 'key' | 'title' | 'description'>,
  t: Translations
): LocalizedBlueprintCopy {
  return (
    t.cron.blueprints.catalog[blueprint.key] ?? {
      title: blueprint.title,
      description: blueprint.description
    }
  )
}

/** Resolve display-only field copy while preserving backend field values. */
export function localizedBlueprintField(
  blueprintKey: string,
  field: AutomationBlueprintField,
  t: Translations
): LocalizedBlueprintField {
  const blueprintCopy = t.cron.blueprints.catalog[blueprintKey]
  const fieldCopy = blueprintCopy?.fields?.[field.name]
  const label = fieldCopy?.label ?? t.cron.blueprints.fieldLabels?.[field.name] ?? field.label
  const help = fieldCopy?.help ?? t.cron.blueprints.fieldDescriptions?.[field.name] ?? field.help
  const displayDefault = fieldCopy?.displayDefault

  const optionLabels = Object.fromEntries(
    field.options.map(option => [
      option,
      fieldCopy?.optionLabels?.[option] ?? t.cron.blueprints.optionLabels?.[option] ?? option
    ])
  )

  return { ...field, displayDefault, help, label, optionLabels }
}

/** Collect translated defaults for text controls; enum/time values stay canonical. */
export function localizedBlueprintDisplayDefaults(
  blueprint: AutomationBlueprint,
  t: Translations
): Record<string, string> {
  return Object.fromEntries(
    blueprint.fields.flatMap(field => {
      const displayDefault = localizedBlueprintField(blueprint.key, field, t).displayDefault

      return displayDefault === undefined ? [] : [[field.name, displayDefault]]
    })
  )
}
