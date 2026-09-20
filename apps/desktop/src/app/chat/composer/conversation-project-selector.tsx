import type { ConversationProjectRef, SharedProject } from '@hermes/shared/gateway-events'
import { useEffect, useState } from 'react'

import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { projectSourceKey, sharedProjects } from '@/store/shared-projects'
import { sharedProjectWindow } from '@/store/shared-project-windows'

export interface ConversationProjectSelectorProps {
  connectionId: string
  installId: string
  value: ConversationProjectRef | null
  profiles: readonly string[]
  disabled?: boolean
  onChange: (source: ConversationProjectRef | null) => void
}

export function ConversationProjectSelector({
  connectionId,
  installId,
  value,
  profiles,
  disabled,
  onChange
}: ConversationProjectSelectorProps) {
  const copy = useI18n().t.sharedProjects
  const [projects, setProjects] = useState<SharedProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [creating, setCreating] = useState(false)
  const [profile, setProfile] = useState('')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let disposed = false
    setReady(false)
    setProjects([])
    setError(null)
    void sharedProjects(connectionId)
      .list()
      .then(result => {
        if (!disposed) {
          setProjects(
            result.projects.filter(
              project =>
                project.install_id === installId && result.available_environments.includes(project.environment_id)
            )
          )
          setReady(true)
        }
      })
      .catch(reason => {
        if (!disposed) setError(String(reason instanceof Error ? reason.message : reason))
      })
    return () => {
      disposed = true
    }
  }, [connectionId, installId, attempt])
  const choices = projects.flatMap(project =>
    project.sources.map(source => ({ project, source, key: projectSourceKey(source) }))
  )
  const selected = choices.find(choice => choice.key === (value && projectSourceKey(value)))
  const register = async () => {
    setSaving(true)
    setError(null)
    try {
      await sharedProjects(connectionId).register(profile, name, path)
      setAttempt(value => value + 1)
      setCreating(false)
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-2" aria-label="Conversation project">
      <label>
        {copy.project}{' '}
        <select
          aria-label="Conversation project source"
          disabled={disabled || !ready || saving}
          value={value ? projectSourceKey(value) : ''}
          onChange={event => onChange(choices.find(choice => choice.key === event.target.value)?.source ?? null)}
        >
          <option value="">{copy.noProject}</option>
          {value && !selected && (
            <option value={projectSourceKey(value)}>
              {value.cwd} · {value.registration_profile} ({copy.unavailable})
            </option>
          )}
          {choices.map(choice => (
            <option key={choice.key} value={choice.key}>
              {choice.project.name} · {choice.source.registration_profile} · {choice.project.environment_id}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant="ghost"
        disabled={!selected || disabled}
        onClick={() => {
          if (selected) sharedProjectWindow.open({ connectionId, project: selected.project, source: selected.source })
        }}
      >
        {copy.open}
      </Button>
      <Button type="button" variant="ghost" disabled={disabled || !ready} onClick={() => setCreating(value => !value)}>
        {copy.register}
      </Button>
      {creating && (
        <div className="space-y-2">
          <label>
            {copy.source}{' '}
            <select
              aria-label="Project registration source"
              value={profile}
              onChange={event => setProfile(event.target.value)}
            >
              <option value="">{copy.choose}</option>
              {[...new Set(profiles)].map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="Project name"
            placeholder={copy.name}
            value={name}
            onChange={event => setName(event.target.value)}
          />
          <input
            aria-label="Project directory"
            placeholder={copy.directory}
            value={path}
            onChange={event => setPath(event.target.value)}
          />
          <Button
            type="button"
            disabled={saving || !profile || !name.trim() || !path.trim()}
            onClick={() => void register()}
          >
            {copy.create}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert">
          {copy.error}: {error}{' '}
          <Button type="button" onClick={() => setAttempt(value => value + 1)}>
            {copy.retry}
          </Button>
        </p>
      )}
    </div>
  )
}
