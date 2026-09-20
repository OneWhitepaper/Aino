import type { ConversationProjectRef, SharedProject } from '@hermes/shared/gateway-events'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { sharedProjectWindow } from '@/store/shared-project-windows'
import { projectSourceKey, sharedProjects } from '@/store/shared-projects'

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
        if (!disposed) {
          setError(String(reason instanceof Error ? reason.message : reason))
        }
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
    <div aria-label="Conversation project" className="space-y-2">
      <label>
        {copy.project}{' '}
        <select
          aria-label="Conversation project source"
          disabled={disabled || !ready || saving}
          onChange={event => onChange(choices.find(choice => choice.key === event.target.value)?.source ?? null)}
          value={value ? projectSourceKey(value) : ''}
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
        disabled={!selected || disabled}
        onClick={() => {
          if (selected) {
            sharedProjectWindow.open({ connectionId, project: selected.project, source: selected.source })
          }
        }}
        type="button"
        variant="ghost"
      >
        {copy.open}
      </Button>
      <Button disabled={disabled || !ready} onClick={() => setCreating(value => !value)} type="button" variant="ghost">
        {copy.register}
      </Button>
      {creating && (
        <div className="space-y-2">
          <label>
            {copy.source}{' '}
            <select
              aria-label="Project registration source"
              onChange={event => setProfile(event.target.value)}
              value={profile}
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
            onChange={event => setName(event.target.value)}
            placeholder={copy.name}
            value={name}
          />
          <input
            aria-label="Project directory"
            onChange={event => setPath(event.target.value)}
            placeholder={copy.directory}
            value={path}
          />
          <Button
            disabled={saving || !profile || !name.trim() || !path.trim()}
            onClick={() => void register()}
            type="button"
          >
            {copy.create}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert">
          {copy.error}: {error}{' '}
          <Button onClick={() => setAttempt(value => value + 1)} type="button">
            {copy.retry}
          </Button>
        </p>
      )}
    </div>
  )
}
