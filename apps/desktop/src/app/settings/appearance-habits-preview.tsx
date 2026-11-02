import { useStore } from '@nanostores/react'

import { useI18n } from '@/i18n'
import { $introSplash } from '@/store/intro-splash'
import { $tipsEnabled } from '@/store/tips'
import { $toursEnabled } from '@/store/tours'

import { useHermesConfigRecord } from '../hooks/use-config-record'

export function AppearanceHabitsPreview() {
  const { t } = useI18n()
  const copy = t.appearancePage.habitsPreview
  const intro = useStore($introSplash)
  const tips = useStore($tipsEnabled)
  const tours = useStore($toursEnabled)
  const { data: config } = useHermesConfigRecord()
  const resume = (config?.display as { resume_last_session?: unknown } | undefined)?.resume_last_session !== false

  return (
    <section aria-label={copy.label} className="appearance-habit-preview">
      {config && (
        <>
          <h3>{resume ? copy.resumeTitle : copy.freshTitle}</h3>
          <p>{resume ? copy.resumeDescription : copy.freshDescription}</p>
        </>
      )}
      {intro && <p>{copy.welcome}</p>}
      {tips && <p>{copy.tip}</p>}
      {tours && <p>{copy.tour}</p>}
    </section>
  )
}
