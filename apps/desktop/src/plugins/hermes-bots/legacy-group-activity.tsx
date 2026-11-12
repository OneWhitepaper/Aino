import { cn, Codicon, relativeTime, RowButton, useI18n } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { GROUP_ACTIVITY_GLYPHS, groupActivityLabel, groupActivityTone } from './group-activity'
import type { GroupActivityEntry } from './group-activity'
import { useBots } from './i18n'

interface LegacyGroupActivityProps {
  group: string
  events: GroupActivityEntry[]
  summary: GroupActivityEntry | null | undefined
}

/** Explicit disclosure only: streaming activity never takes focus or scrolls the transcript. */
export function LegacyGroupActivity({ group, events, summary }: LegacyGroupActivityProps) {
  const b = useBots()
  const { locale } = useI18n()
  const [activityOpen, setActivityOpen] = useState(false)

  return (
    <div className="border-b border-(--ui-stroke-tertiary) px-4">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-1">
        <RowButton
          aria-controls={`group-activity:${group}`}
          aria-expanded={activityOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1 text-left text-[length:var(--aino-text-caption)] text-(--ui-text-quaternary) transition-colors hover:text-foreground"
          onClick={() => setActivityOpen(prev => !prev)}
        >
          <Codicon
            className="shrink-0 text-[length:var(--aino-text-caption)]"
            name={activityOpen ? 'chevron-down' : 'chevron-right'}
          />
          <span className="shrink-0 font-medium">{b.group.activity}</span>
          {summary ? (
            <span
              className={cn('min-w-0 flex-1 truncate', groupActivityTone(summary.kind))}
            >{`${groupActivityLabel(summary, group)} · ${relativeTime(summary.at, undefined, locale)}`}</span>
          ) : null}
        </RowButton>
      </div>
      {activityOpen ? (
        <div className="mx-auto grid w-full max-w-3xl gap-0.5 px-2.5 pb-1.5" id={`group-activity:${group}`}>
          {events.length ? (
            [...events].reverse().map((event, i) => (
              <div
                className="flex items-center gap-1.5 text-[length:var(--aino-text-caption)]"
                key={`${event.at}:${i}`}
              >
                <Codicon
                  className={cn('shrink-0 text-[length:var(--aino-text-caption)]', groupActivityTone(event.kind))}
                  name={GROUP_ACTIVITY_GLYPHS[event.kind] || 'circle-outline'}
                />
                <span className={cn('min-w-0 flex-1 truncate', groupActivityTone(event.kind))}>
                  {groupActivityLabel(event, group)}
                </span>
                <span className="shrink-0 text-[length:var(--aino-text-caption)] text-(--ui-text-quaternary)">
                  {relativeTime(event.at, undefined, locale)}
                </span>
              </div>
            ))
          ) : (
            <div className="px-0.5 pb-0.5 text-[length:var(--aino-text-caption)] text-(--ui-text-quaternary)">
              {b.group.noActivityYet}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
