import { type ReactNode, useId } from 'react'

import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { IconComponent } from '@/lib/icons'

import { SectionHeading, SettingsGroup } from './primitives'

interface AppearanceSelectProps<T extends string> {
  label: string
  options: readonly { id: T; label: string }[]
  value: T | ''
  onChange: (value: T) => void
}

export function AppearanceSelect<T extends string>({ label, onChange, options, value }: AppearanceSelectProps<T>) {
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className="appearance-select" size="sm">
        <SelectValue placeholder={value} />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface AppearanceGroupProps {
  children: ReactNode
  icon: IconComponent
  title: string
}

export function AppearanceGroup({ children, icon, title }: AppearanceGroupProps) {
  return (
    <section className="appearance-group">
      <SectionHeading icon={icon} title={title} />
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  )
}

interface AppearanceDisclosureProps extends AppearanceGroupProps {
  open: boolean
  onToggle: () => void
}

export function AppearanceDisclosure({ children, icon: Icon, onToggle, open, title }: AppearanceDisclosureProps) {
  const id = useId()

  return (
    <SettingsGroup className="appearance-disclosure">
      <button
        aria-controls={`${id}-content`}
        aria-expanded={open}
        className="appearance-disclosure-trigger"
        id={id}
        onClick={onToggle}
        type="button"
      >
        <Icon />
        <span>{title}</span>
        <DisclosureCaret open={open} />
      </button>
      <div
        aria-labelledby={id}
        className="appearance-disclosure-body"
        hidden={!open}
        id={`${id}-content`}
        role="region"
      >
        {children}
      </div>
    </SettingsGroup>
  )
}
