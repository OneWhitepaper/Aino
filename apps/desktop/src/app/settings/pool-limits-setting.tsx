import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { ListRow } from '@/app/settings/primitives'
import { SETTING_IDS, settingElementId } from '@/app/settings/settings-manifest'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { $poolLimits, savePoolLimits } from '@/store/pool-limits'

import { POOL_LIMITS_BOUNDS } from '../../../electron/pool-limits'

const MAX_BACKENDS_MAX = POOL_LIMITS_BOUNDS.maxBackendsMax
const IDLE_MS_MAX = POOL_LIMITS_BOUNDS.idleMsMax

/** Device-local limits for speculative profile connections and idle retention. */
export function PoolLimitsSetting() {
  const { t } = useI18n()
  const limits = useStore($poolLimits)
  const [maxDraft, setMaxDraft] = useState(String(limits.maxBackends))
  const [idleDraft, setIdleDraft] = useState(String(limits.idleMs))

  useEffect(() => {
    setMaxDraft(String(limits.maxBackends))
    setIdleDraft(String(limits.idleMs))
  }, [limits])

  const commitMax = () => {
    const parsed = Number(maxDraft)

    if (!Number.isFinite(parsed) || parsed === limits.maxBackends) {
      setMaxDraft(String(limits.maxBackends))

      return
    }

    void savePoolLimits({ maxBackends: parsed })
      .then(() => undefined)
      .catch(() => setMaxDraft(String($poolLimits.get().maxBackends)))
  }

  const commitIdle = () => {
    const parsed = Number(idleDraft)

    if (!Number.isFinite(parsed) || parsed === limits.idleMs) {
      setIdleDraft(String(limits.idleMs))

      return
    }

    void savePoolLimits({ idleMs: parsed })
      .then(() => undefined)
      .catch(() => setIdleDraft(String($poolLimits.get().idleMs)))
  }

  return (
    <>
      <ListRow
        action={
          <div className="flex items-center gap-2">
            <Input
              aria-label={t.settings.poolLimits.warmBotBackendsAria}
              className="w-20"
              inputMode="numeric"
              max={MAX_BACKENDS_MAX}
              min={POOL_LIMITS_BOUNDS.maxBackendsMin}
              onBlur={commitMax}
              onChange={event => setMaxDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
              type="number"
              value={maxDraft}
            />
          </div>
        }
        description={t.settings.poolLimits.warmBotBackendsDesc}
        id={settingElementId(SETTING_IDS.advanced.warmBotBackends)}
        title={t.settings.poolLimits.warmBotBackendsTitle}
      />
      <ListRow
        action={
          <div className="flex items-center gap-2">
            <Input
              aria-label={t.settings.poolLimits.backendIdleTimeoutAria}
              className="w-28"
              inputMode="numeric"
              max={IDLE_MS_MAX}
              min={POOL_LIMITS_BOUNDS.idleMsMin}
              onBlur={commitIdle}
              onChange={event => setIdleDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
              type="number"
              value={idleDraft}
            />
            <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">ms</span>
          </div>
        }
        description={t.settings.poolLimits.backendIdleTimeoutDesc}
        id={settingElementId(SETTING_IDS.advanced.backendIdleTimeout)}
        title={t.settings.poolLimits.backendIdleTimeoutTitle}
      />
    </>
  )
}
