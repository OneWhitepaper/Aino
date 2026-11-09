import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { ChevronDown, Eye, EyeOff, Loader2, Plus, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { ComboboxInput } from './combobox-input'
import { customModelConfigCopy } from './custom-model-config-copy'
import { CUSTOM_ENDPOINT_API_MODES, type CustomEndpointEditor } from './use-custom-endpoint-editor'

interface CustomModelEditorProps {
  editor: CustomEndpointEditor
  dialog?: boolean
}

const fieldClass = 'grid min-w-0 gap-2 text-[length:var(--aino-text-ui)] font-medium text-(--ui-text-secondary)'

function ConnectionFields({ editor }: { editor: CustomEndpointEditor }) {
  const { t } = useI18n()
  const c = t.settings.customEndpoints
  const disabled = editor.saving || Boolean(editor.deleting)

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <label className={fieldClass}>
        {c.name}
        <Input
          aria-label={c.name}
          className="h-10 font-normal"
          disabled={disabled}
          onChange={event => editor.updateForm({ name: event.target.value })}
          placeholder={c.namePlaceholder}
          value={editor.form.name}
        />
      </label>
      <label className={fieldClass}>
        {c.endpointUrl}
        <Input
          aria-label={c.endpointUrl}
          className="h-10 font-normal"
          disabled={disabled}
          onChange={event => editor.updateForm({ baseUrl: event.target.value })}
          placeholder={c.endpointUrlPlaceholder}
          value={editor.form.baseUrl}
        />
      </label>
    </div>
  )
}

function CustomModelKeyFields({
  editor,
  dialog,
  showKey,
  setShowKey
}: CustomModelEditorProps & {
  showKey: boolean
  setShowKey: (value: boolean | ((previous: boolean) => boolean)) => void
}) {
  const { locale, t } = useI18n()
  const c = t.settings.customEndpoints
  const copy = customModelConfigCopy(locale)
  const { form, updateForm, saving } = editor
  const disabled = saving || Boolean(editor.deleting)
  const selected = editor.endpoints.find(endpoint => endpoint.id === form.id)

  return (
    <div className={fieldClass}>
      <label htmlFor={dialog ? 'custom-model-dialog-key' : 'custom-model-settings-key'}>{c.apiKey}</label>
      <div className="flex items-center gap-2">
        <Input
          aria-label={c.apiKey}
          className="font-normal"
          containerClassName="h-10 min-w-0 flex-1"
          disabled={disabled}
          id={dialog ? 'custom-model-dialog-key' : 'custom-model-settings-key'}
          onChange={event => updateForm({ apiKey: event.target.value })}
          placeholder={selected?.has_api_key ? c.apiKeyKeepPlaceholder : c.apiKeyOptionalPlaceholder}
          suffix={
            <Button
              aria-label={showKey ? copy.hideKey : copy.showKey}
              className="pointer-events-auto"
              disabled={disabled}
              onClick={() => setShowKey(value => !value)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          }
          type={showKey ? 'text' : 'password'}
          value={form.apiKey}
        />
        <Button
          className="h-10 shrink-0 px-3 text-[length:var(--aino-text-ui)]"
          disabled={disabled || editor.testing || !form.baseUrl.trim()}
          onClick={() => void editor.validate()}
          type="button"
          variant="outline"
        >
          {editor.testing && <Loader2 className="size-3.5 animate-spin" />}
          {editor.testing ? c.testing : dialog ? copy.testConnection : c.test}
        </Button>
      </div>
      {selected?.has_api_key && !form.apiKey && (
        <span className="text-[length:var(--aino-text-caption)] font-normal text-muted-foreground">{copy.keepKey}</span>
      )}
      {editor.validation && (
        <p
          aria-live="polite"
          className={cn(
            'text-[length:var(--aino-text-caption)] font-normal leading-relaxed',
            editor.validation.kind === 'success'
              ? 'text-(--ui-green)'
              : editor.validation.kind === 'error'
                ? 'text-destructive'
                : 'text-(--ui-yellow)'
          )}
          role="status"
        >
          {editor.validation.message}
        </p>
      )}
    </div>
  )
}

/** Shared by Settings and the composer dialog; both write the existing custom-endpoint configuration. */
export function CustomModelEditor({ editor, dialog = false }: CustomModelEditorProps) {
  const { locale, t } = useI18n()
  const c = t.settings.customEndpoints
  const copy = customModelConfigCopy(locale)
  const [showKey, setShowKey] = useState(false)
  const { form, endpoints, updateForm, saving } = editor
  const disabled = saving || Boolean(editor.deleting)
  const selected = endpoints.find(endpoint => endpoint.id === form.id)

  const apiModeOptions = CUSTOM_ENDPOINT_API_MODES.map(option => ({
    ...option,
    label: option.id ? option.label : c.autoDetect
  }))

  return (
    <div className="space-y-5">
      {selected && (
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[length:var(--aino-text-ui)] text-(--ui-text-secondary)">
            {selected.name}
          </span>
          <Button
            disabled={disabled}
            onClick={() => {
              setShowKey(false)
              editor.reset()
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Plus />
            {copy.newConfiguration}
          </Button>
        </div>
      )}
      <ConnectionFields editor={editor} />

      <CustomModelKeyFields dialog={dialog} editor={editor} setShowKey={setShowKey} showKey={showKey} />

      <label className={fieldClass}>
        {dialog ? copy.modelName : c.defaultModel}
        <ComboboxInput
          aria-label={dialog ? copy.modelName : c.defaultModel}
          className="[&_input]:h-10 font-normal"
          disabled={disabled}
          onChange={model => updateForm({ model })}
          options={editor.modelOptions}
          placeholder={c.defaultModelPlaceholder}
          value={form.model}
        />
        <span className="text-[length:var(--aino-text-caption)] font-normal leading-relaxed text-muted-foreground">
          {copy.modelHint}
        </span>
      </label>

      <details className="group border-t border-border/50 pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[length:var(--aino-text-caption)] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open:rotate-0" />
          {copy.advanced}
        </summary>
        <div className="space-y-4 pt-3">
          <p className="text-[length:var(--aino-text-caption)] leading-relaxed text-muted-foreground">
            {copy.advancedHint}
          </p>
          <fieldset className={fieldClass} disabled={disabled}>
            <legend className="mb-2">{c.apiMode}</legend>
            <SegmentedControl
              className="grid w-full grid-flow-row grid-cols-2 gap-1 [&_button]:justify-start"
              disabled={disabled}
              onChange={apiMode => updateForm({ apiMode })}
              options={apiModeOptions}
              value={form.apiMode}
            />
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              {c.providerId}
              <Input
                aria-label={c.providerId}
                disabled={disabled}
                onChange={event => updateForm({ id: event.target.value })}
                placeholder={c.providerIdPlaceholder}
                value={form.id}
              />
            </label>
            <label className={fieldClass}>
              {c.context}
              <Input
                aria-label={c.context}
                disabled={disabled}
                inputMode="numeric"
                onChange={event => updateForm({ contextLength: event.target.value })}
                placeholder={c.contextPlaceholder}
                value={form.contextLength}
              />
            </label>
          </div>
          <div className="grid gap-3 text-[length:var(--aino-text-caption)] text-muted-foreground">
            {!dialog && (
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.makeDefault}
                  disabled={disabled}
                  onCheckedChange={checked => updateForm({ makeDefault: checked === true })}
                />
                {c.useForNewChats}
              </label>
            )}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={form.discoverModels}
                disabled={disabled}
                onCheckedChange={checked => updateForm({ discoverModels: checked === true })}
              />
              {c.discoverModels}
            </label>
          </div>
        </div>
      </details>
      {endpoints.length > 0 && (
        <details className="group border-t border-border/50 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[length:var(--aino-text-caption)] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open:rotate-0" />
            {copy.savedConfigurations}
            <span className="ms-auto font-normal tabular-nums">{endpoints.length}</span>
          </summary>
          <div className="space-y-2 pt-3">
            <p className="text-[length:var(--aino-text-caption)] leading-relaxed text-muted-foreground">
              {copy.savedExplanation}
            </p>
            {endpoints.map(endpoint => (
              <div className="flex items-center gap-1" key={endpoint.id}>
                <Button
                  aria-pressed={endpoint.id === selected?.id}
                  className="h-auto min-w-0 flex-1 justify-start gap-1 px-3 py-2 text-left"
                  disabled={disabled}
                  onClick={() => {
                    setShowKey(false)
                    editor.select(endpoint)
                  }}
                  type="button"
                  variant={endpoint.id === selected?.id ? 'secondary' : 'ghost'}
                >
                  <span className="grid min-w-0 gap-1">
                    <span className="truncate text-[length:var(--aino-text-ui)]">{endpoint.name}</span>
                    <span className="truncate text-[length:var(--aino-text-caption)] font-normal text-muted-foreground">
                      {endpoint.base_url}
                    </span>
                  </span>
                </Button>
                {endpoint.source !== 'direct-config' && (
                  <Tip label={c.deleteEndpoint}>
                    <Button
                      aria-label={c.deleteEndpoint}
                      className="hover:text-destructive"
                      disabled={disabled || editor.testing || Boolean(editor.activating)}
                      onClick={() => void editor.remove(endpoint)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      {editor.deleting === endpoint.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  </Tip>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
