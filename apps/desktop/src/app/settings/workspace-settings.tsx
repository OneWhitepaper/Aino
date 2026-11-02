import './workspace-settings.css'

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { Code, FileText, FolderOpen, GitBranch, type IconComponent, Info, Terminal } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import type { ConfigFieldSchema, HermesConfigRecord } from '@/types/hermes'

import { configSubpageForField } from './config-subpages'
import { getNested, setNested } from './helpers'
import { ListRow, SectionHeading, SettingsGroup, ToggleRow } from './primitives'
import { resolveSettingsSubpage } from './subpages'
import { useDeepLinkHighlight } from './use-deep-link-highlight'
import { DISCOVERY_PATH_KEYS, workspaceDiscoveryPathsVisible, workspaceDiscoverySummary } from './workspace-discovery'

export const WORKSPACE_FIELD_KEYS: ReadonlySet<string> = new Set([
  'terminal.cwd',
  'desktop.repo_scan_enabled',
  'desktop.repo_scan_roots',
  'desktop.repo_scan_exclude_paths',
  'terminal.persistent_shell',
  'terminal.env_passthrough',
  'code_execution.mode',
  'file_read_max_chars'
])

const CATEGORY_IDS = ['projects', 'shell', 'files'] as const
type WorkspaceCategory = (typeof CATEGORY_IDS)[number]
const fieldId = (field: string) => `setting-field-${field}`

interface WorkspaceSettingsProps {
  config: HermesConfigRecord
  fields: [string, ConfigFieldSchema][]
  onConfigChange: (config: HermesConfigRecord) => void
  subpage?: string
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

interface WorkspaceListInputProps {
  label: string
  onChange: (value: string[]) => void
  placeholder: string
  value: unknown
}

/** A presentation-only draft; the parent retains configuration and autosave ownership. */
export function WorkspaceListInput({ label, onChange, placeholder, value }: WorkspaceListInputProps) {
  const normalizedValue = stringList(value).join('\n')
  const [draft, setDraft] = useState(normalizedValue)
  const focused = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    if (!focused.current) {
      setDraft(normalizedValue)
    }
  }, [normalizedValue])

  return (
    <Textarea
      aria-label={label}
      className="workspace-list-input"
      onBlur={() => {
        focused.current = false

        const next = draft
          .split(/[\n,]/)
          .map(item => item.trim())
          .filter(Boolean)

        // The owner may defer or reject this edit for confirmation. Once focus
        // leaves, show its authoritative value until it accepts the draft.
        setDraft(normalizedValue)

        if (dirty.current && !sameList(next, stringList(value))) {
          onChange(next)
        }

        dirty.current = false
      }}
      onChange={event => {
        dirty.current = true
        setDraft(event.target.value)
      }}
      onFocus={() => {
        focused.current = true
        dirty.current = false
      }}
      placeholder={placeholder}
      rows={3}
      value={draft}
    />
  )
}

function WorkspaceReadLimitInput({
  invalidMessage,
  label,
  onChange,
  unit,
  value
}: {
  invalidMessage: string
  label: string
  onChange: (value: number) => void
  unit: string
  value: unknown
}) {
  const normalizedValue = value == null ? '' : String(value)
  const [draft, setDraft] = useState(normalizedValue)
  const [invalid, setInvalid] = useState(false)
  const focused = useRef(false)
  const errorId = useId()

  useEffect(() => {
    if (!focused.current) {
      setDraft(normalizedValue)
      setInvalid(false)
    }
  }, [normalizedValue])

  return (
    <div className="workspace-read-control">
      <div className="workspace-read-number">
        <Input
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid || undefined}
          aria-label={label}
          min={1}
          onBlur={() => {
            focused.current = false
            const next = Number(draft)
            const valid = draft.trim() !== '' && Number.isSafeInteger(next) && next > 0
            setInvalid(!valid)

            if (valid && next !== value) {
              onChange(next)
            }
          }}
          onChange={event => {
            setDraft(event.target.value)
            setInvalid(false)
          }}
          onFocus={() => {
            focused.current = true
          }}
          onKeyDown={event => {
            if (isSubmitEnter(event)) {
              event.currentTarget.blur()
            }
          }}
          step={1}
          type="number"
          value={draft}
        />
        <span>{unit}</span>
      </div>
      {invalid && (
        <p className="workspace-invalid" id={errorId} role="alert">
          {invalidMessage}
        </p>
      )}
    </div>
  )
}

function WorkspaceGroup({ children, icon, title }: { children: ReactNode; icon: IconComponent; title: string }) {
  return (
    <section className="workspace-settings-section">
      <SectionHeading icon={icon} title={title} />
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  )
}

function WorkspaceNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`workspace-note ${className}`}>
      <Info aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

function WorkspaceExecutionSettings({ mode, onChange }: { mode: string; onChange: (mode: string) => void }) {
  const { t } = useI18n()
  const copy = t.workspacePage
  const radioName = useId()

  return (
    <WorkspaceGroup icon={Code} title={copy.groups.execution}>
      <ListRow
        below={
          <div aria-label={copy.execution.label} className="workspace-mode-list" role="radiogroup">
            {[
              {
                value: 'project',
                title: copy.execution.projectLabel,
                meta: copy.execution.projectMeta,
                description: copy.execution.projectDescription
              },
              {
                value: 'strict',
                title: copy.execution.strictLabel,
                meta: copy.execution.strictMeta,
                description: copy.execution.strictDescription
              }
            ].map(option => (
              <label className="workspace-mode-option" key={option.value}>
                <input
                  checked={mode === option.value}
                  name={radioName}
                  onChange={() => onChange(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>
                  <strong>
                    {option.title} <small>{option.meta}</small>
                  </strong>
                  <span className="workspace-mode-description">{option.description}</span>
                </span>
              </label>
            ))}
            <p className="workspace-help">{copy.execution.hint}</p>
          </div>
        }
        data-tour="field-code_execution.mode"
        description={copy.execution.description}
        id={fieldId('code_execution.mode')}
        title={copy.execution.label}
        wide
      />
    </WorkspaceGroup>
  )
}

function WorkspaceConfigNames({
  hasLimit,
  hasMode,
  mode,
  readLimit
}: {
  hasLimit: boolean
  hasMode: boolean
  mode: string
  readLimit: unknown
}) {
  const { t } = useI18n()
  const copy = t.workspacePage
  const [showConfigNames, setShowConfigNames] = useState(false)

  return (
    <details
      className="workspace-config-names"
      onToggle={event => setShowConfigNames(event.currentTarget.open)}
      open={showConfigNames}
    >
      <summary>
        <DisclosureCaret open={showConfigNames} />
        {copy.configNames}
      </summary>
      <dl>
        {hasMode && (
          <>
            <dt>
              <code>code_execution.mode</code>
            </dt>
            <dd>{mode}</dd>
          </>
        )}
        {hasLimit && (
          <>
            <dt>
              <code>file_read_max_chars</code>
            </dt>
            <dd>{readLimit == null ? '—' : String(readLimit)}</dd>
          </>
        )}
      </dl>
    </details>
  )
}

export function WorkspaceSettings({ config, fields, onConfigChange, subpage }: WorkspaceSettingsProps) {
  const { t } = useI18n()
  const copy = t.workspacePage
  const [searchParams, setSearchParams] = useSearchParams()
  const [revealDiscovery, setRevealDiscovery] = useState(false)
  const available = new Set(fields.map(([key]) => key))
  const has = (key: string) => available.has(key)
  const hasAny = (...keys: string[]) => keys.some(has)

  const categories = CATEGORY_IDS.filter(category =>
    fields.some(([key]) => configSubpageForField('workspace', key) === category)
  )

  const requested = subpage ?? resolveSettingsSubpage('config:workspace', searchParams)
  const category = categories.find(id => id === requested) ?? categories[0] ?? 'projects'
  const targetField = searchParams.get('field')
  const targetCategory = targetField ? configSubpageForField('workspace', targetField) : undefined
  const scanEnabled = getNested(config, 'desktop.repo_scan_enabled') !== false

  const showDiscoveryPaths = workspaceDiscoveryPathsVisible(
    has('desktop.repo_scan_enabled'),
    scanEnabled,
    revealDiscovery,
    targetField
  )

  // Preserve the selected category when the highlighter consumes a legacy field link.
  useEffect(() => {
    if (subpage !== undefined || !targetCategory || searchParams.get('page') === targetCategory) {
      return
    }

    setSearchParams(
      previous => {
        const next = new URLSearchParams(previous)
        next.set('page', targetCategory)

        return next
      },
      { replace: true }
    )
  }, [searchParams, setSearchParams, subpage, targetCategory])

  const fieldReady = useCallback(
    (field: string) => {
      const page = configSubpageForField('workspace', field)

      return (
        fields.some(([key]) => key === field) &&
        page === category &&
        (subpage !== undefined || searchParams.get('page') === page)
      )
    },
    [category, fields, searchParams, subpage]
  )

  const revealField = useCallback((field: string) => {
    if (DISCOVERY_PATH_KEYS.includes(field)) {
      setRevealDiscovery(true)
    }
  }, [])

  useDeepLinkHighlight({ param: 'field', elementId: fieldId, ready: fieldReady, onResolve: revealField })

  const update = (field: string, value: unknown) => {
    if (getNested(config, field) !== value) {
      onConfigChange(setNested(config, field, value))
    }
  }

  const roots = stringList(getNested(config, 'desktop.repo_scan_roots'))
  const exclusions = stringList(getNested(config, 'desktop.repo_scan_exclude_paths'))

  const discoverySummary = workspaceDiscoverySummary(copy.discovery, scanEnabled, roots.length, exclusions.length)

  const mode = String(getNested(config, 'code_execution.mode') ?? 'project')
  const readLimit = getNested(config, 'file_read_max_chars')

  const listRow = (field: string, label: string, description: string, placeholder: string, hint: string) =>
    has(field) && (
      <ListRow
        below={
          <div className="workspace-editor">
            <WorkspaceListInput
              label={label}
              onChange={value => update(field, value)}
              placeholder={placeholder}
              value={getNested(config, field)}
            />
            <p className="workspace-help">{hint}</p>
          </div>
        }
        data-tour={`field-${field}`}
        description={description}
        id={fieldId(field)}
        title={label}
        wide
      />
    )

  const content: Record<WorkspaceCategory, ReactNode> = {
    projects: (
      <>
        {has('terminal.cwd') && (
          <WorkspaceGroup icon={FolderOpen} title={copy.groups.directory}>
            <ListRow
              below={
                <div className="workspace-editor">
                  <Input
                    aria-label={copy.cwd.label}
                    containerClassName="workspace-directory-input"
                    onChange={event => update('terminal.cwd', event.target.value)}
                    placeholder={copy.cwd.placeholder}
                    prefix={<FolderOpen aria-hidden="true" />}
                    value={String(getNested(config, 'terminal.cwd') ?? '')}
                  />
                  <p className="workspace-help">{copy.cwd.hint}</p>
                </div>
              }
              data-tour="field-terminal.cwd"
              description={copy.cwd.description}
              id={fieldId('terminal.cwd')}
              title={copy.cwd.label}
              wide
            />
          </WorkspaceGroup>
        )}
        {hasAny('desktop.repo_scan_enabled', ...DISCOVERY_PATH_KEYS) && (
          <>
            <WorkspaceGroup icon={GitBranch} title={copy.groups.discovery}>
              {has('desktop.repo_scan_enabled') && (
                <ToggleRow
                  checked={scanEnabled}
                  data-tour="field-desktop.repo_scan_enabled"
                  description={copy.discovery.description}
                  id={fieldId('desktop.repo_scan_enabled')}
                  label={copy.discovery.label}
                  onChange={value => {
                    setRevealDiscovery(false)
                    update('desktop.repo_scan_enabled', value)
                  }}
                />
              )}
              <div className="workspace-discovery-paths" hidden={!showDiscoveryPaths}>
                {listRow(
                  'desktop.repo_scan_roots',
                  copy.discovery.rootsLabel,
                  copy.discovery.rootsDescription,
                  copy.discovery.rootsPlaceholder,
                  copy.discovery.rootsHint
                )}
                {listRow(
                  'desktop.repo_scan_exclude_paths',
                  copy.discovery.excludeLabel,
                  copy.discovery.excludeDescription,
                  copy.discovery.excludePlaceholder,
                  copy.discovery.excludeHint
                )}
              </div>
              <div className="workspace-discovery-summary">
                <FolderOpen aria-hidden="true" />
                <span>{discoverySummary}</span>
              </div>
            </WorkspaceGroup>
            <WorkspaceNote>{copy.discovery.note}</WorkspaceNote>
          </>
        )}
      </>
    ),
    shell: (
      <>
        {has('terminal.persistent_shell') && (
          <WorkspaceGroup icon={Terminal} title={copy.groups.shell}>
            <ToggleRow
              checked={Boolean(getNested(config, 'terminal.persistent_shell'))}
              data-tour="field-terminal.persistent_shell"
              description={copy.shell.description}
              id={fieldId('terminal.persistent_shell')}
              label={copy.shell.label}
              onChange={value => update('terminal.persistent_shell', value)}
            />
            <WorkspaceNote className="workspace-group-note">{copy.shell.hint}</WorkspaceNote>
          </WorkspaceGroup>
        )}
        {has('terminal.env_passthrough') && (
          <>
            <WorkspaceGroup icon={Code} title={copy.groups.environment}>
              {listRow(
                'terminal.env_passthrough',
                copy.environment.label,
                copy.environment.description,
                copy.environment.placeholder,
                copy.environment.hint
              )}
            </WorkspaceGroup>
            <WorkspaceNote>{copy.environment.restart}</WorkspaceNote>
          </>
        )}
      </>
    ),
    files: (
      <>
        {has('code_execution.mode') && (
          <WorkspaceExecutionSettings mode={mode} onChange={value => update('code_execution.mode', value)} />
        )}
        {has('file_read_max_chars') && (
          <WorkspaceGroup icon={FileText} title={copy.groups.reading}>
            <ListRow
              action={
                <WorkspaceReadLimitInput
                  invalidMessage={copy.reading.invalid}
                  label={copy.reading.label}
                  onChange={value => update('file_read_max_chars', value)}
                  unit={copy.reading.unit}
                  value={readLimit}
                />
              }
              below={
                (readLimit == null || Number(readLimit) <= 0) && (
                  <p className="workspace-help">{copy.reading.fallbackHint}</p>
                )
              }
              data-tour="field-file_read_max_chars"
              description={copy.reading.description}
              id={fieldId('file_read_max_chars')}
              title={copy.reading.label}
            />
          </WorkspaceGroup>
        )}
        {hasAny('code_execution.mode', 'file_read_max_chars') && (
          <WorkspaceConfigNames
            hasLimit={has('file_read_max_chars')}
            hasMode={has('code_execution.mode')}
            mode={mode}
            readLimit={readLimit}
          />
        )}
      </>
    )
  }

  return (
    <div className="workspace-settings-page">
      {subpage === undefined ? (
        <>
          <p className="workspace-settings-intro">{copy.description}</p>
          <Tabs
            className="workspace-settings-tabs-root"
            onValueChange={page =>
              setSearchParams(previous => {
                const next = new URLSearchParams(previous)
                next.set('page', page)
                next.delete('field')
                next.delete('setting')

                return next
              })
            }
            value={category}
          >
            <TabsList aria-label={copy.tabsLabel} className="workspace-settings-tabs" size="navigation">
              {categories.map(id => (
                <TabsTrigger key={id} size="navigation" value={id}>
                  {copy.tabs[id]}
                </TabsTrigger>
              ))}
            </TabsList>
            {categories.map(id => (
              <TabsContent forceMount hidden={id !== category} key={id} value={id}>
                {content[id]}
              </TabsContent>
            ))}
          </Tabs>
        </>
      ) : (
        content[category]
      )}
    </div>
  )
}
