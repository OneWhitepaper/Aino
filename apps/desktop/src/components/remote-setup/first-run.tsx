import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ErrorIcon } from '@/components/ui/error-state'
import { useI18n } from '@/i18n'
import { Loader2 } from '@/lib/icons'

import { RemoteSetupFields } from './fields'
import { useRemoteSetup } from './use-remote-setup'

interface FirstRunRemoteSetupProps {
  onBack: () => void
}

export function FirstRunRemoteSetup({ onBack }: FirstRunRemoteSetupProps): ReactElement {
  const { t } = useI18n()
  const copy = t.install
  const setup = useRemoteSetup({ host: 'first-run' })
  const [applying, setApplying] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [error])

  const apply = async (): Promise<void> => {
    if (!setup.canCommit || applying) {
      return
    }

    setApplying(true)
    setError(null)

    try {
      await window.hermesDesktop.applyConnectionConfig(setup.payload)
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err || t.settings.gateway.applyFailed))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-(--z-setup) flex items-center justify-center bg-background/90 p-4 backdrop-blur-md">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-(--aino-radius-panel) border border-(--stroke-nous) bg-(--ui-bg-elevated) text-[length:var(--aino-text-body)] shadow-nous">
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-5">
          <div className="flex items-start gap-4">
            <BrandMark className="size-11 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-[length:var(--aino-text-title)] font-semibold tracking-tight [overflow-wrap:anywhere]">
                {copy.remoteSetupTitle}
              </h2>
              <p className="mt-1.5 text-[length:var(--aino-text-body)] leading-relaxed text-(--ui-text-secondary)">
                {copy.remoteSetupDesc}
              </p>
            </div>
          </div>
          <div className="mt-6">
            <RemoteSetupFields disabled={applying} setup={setup} />
            {error ? (
              <Alert className="mt-3" ref={errorRef} variant="destructive">
                <ErrorIcon size="1rem" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-(--ui-stroke-tertiary) p-5">
          <Button disabled={applying} onClick={onBack} size="sm" variant="ghost">
            {copy.backToSetup}
          </Button>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              disabled={setup.testing || applying || !setup.canTest}
              onClick={() => void setup.test()}
              size="sm"
              variant="secondary"
            >
              {setup.testing ? <Loader2 className="animate-spin" /> : null}
              {copy.testConnection}
            </Button>
            <Button disabled={applying || !setup.canCommit} onClick={() => void apply()} size="sm">
              {applying ? <Loader2 className="animate-spin" /> : null}
              {copy.applyRemote}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
