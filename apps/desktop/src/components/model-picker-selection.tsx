import { useLayoutEffect, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { managedModelSwitchBlocked } from '@/lib/model-switch-policy'
import { notifyError } from '@/store/notifications'

import { InlineNotice } from './notifications'
import { Button } from './ui/button'
import { DialogFooter } from './ui/dialog'

export interface ModelPickerSelection {
  provider: string
  model: string
}

export interface ModelPickerConfirmation {
  title: string
  description: string
  applyLabel: string
}

export function displayedPickerSelection(
  staged: ModelPickerSelection | null,
  model: string,
  provider: string
): ModelPickerSelection {
  return staged ?? { model, provider }
}

interface ModelPickerActionsProps {
  confirmation?: ModelPickerConfirmation
  staged: ModelPickerSelection | null
  pending: boolean
  blocked: boolean
  onApply: () => void
  onCancel: () => void
  onAddCustom: () => void
  onAddProvider: () => void
  error: string | null
}

export function ModelPickerActions({
  confirmation,
  staged,
  pending,
  blocked,
  onApply,
  onCancel,
  onAddCustom,
  onAddProvider,
  error
}: ModelPickerActionsProps) {
  const { t } = useI18n()

  return (
    <>
      <div aria-live="polite">{error && <InlineNotice kind="error">{error}</InlineNotice>}</div>
      <DialogFooter className="flex-row items-center justify-end gap-2 bg-card p-3">
        {!confirmation && (
          <>
            <Button className="mr-auto" onClick={onAddCustom} variant="ghost">
              {t.modelPicker.addCustomModelAction}
            </Button>
            <Button onClick={onAddProvider} variant="ghost">
              {t.modelPicker.addProvider}
            </Button>
          </>
        )}
        <Button disabled={pending} onClick={onCancel} variant="outline">
          {t.common.cancel}
        </Button>
        {confirmation && (
          <Button disabled={!staged || blocked} loading={pending} onClick={onApply}>
            {confirmation.applyLabel}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

interface PickerSelectionOptions {
  scope: string
  currentProvider: string
  busy: boolean
  confirmation?: ModelPickerConfirmation
  onOpenChange: (open: boolean) => void
  onSelect: (selection: ModelPickerSelection) => Promise<boolean | void> | boolean | void
}

/** One selection lifecycle; only recovery callers opt into staging. */
export function useModelPickerSelection({
  scope,
  currentProvider,
  busy,
  confirmation,
  onOpenChange,
  onSelect
}: PickerSelectionOptions) {
  const { t } = useI18n()
  const selecting = useRef(false)
  const epoch = useRef(0)
  const [pending, setPending] = useState(false)
  const [staged, setStaged] = useState<ModelPickerSelection | null>(null)
  const [error, setError] = useState<string | null>(null)
  useLayoutEffect(() => {
    epoch.current += 1
    setStaged(null)
    setError(null)

    return () => {
      epoch.current += 1
    }
  }, [scope])

  const commit = async ({ provider, model }: ModelPickerSelection): Promise<boolean> => {
    if (selecting.current || managedModelSwitchBlocked(currentProvider, provider, busy)) {
      return false
    }

    selecting.current = true
    const openedAt = epoch.current
    setPending(true)
    setError(null)

    try {
      const accepted = (await onSelect({ provider, model })) !== false

      if (!accepted && confirmation && openedAt === epoch.current) {
        setError(t.desktop.modelSwitchFailed)
      }

      if (accepted && openedAt === epoch.current) {
        onOpenChange(false)
      }

      return accepted
    } catch (error) {
      if (confirmation) {
        if (openedAt === epoch.current) {
          setError(error instanceof Error ? error.message : t.desktop.modelSwitchFailed)
        }
      } else {
        notifyError(error, t.desktop.modelSwitchFailed)
      }

      return false
    } finally {
      selecting.current = false
      setPending(false)
    }
  }

  const selectModel = (provider: string, model: string): Promise<boolean> => {
    if (confirmation) {
      setStaged({ provider, model })

      return Promise.resolve(false)
    }

    return commit({ provider, model })
  }

  return { pending, staged, error, selectModel, apply: () => (staged ? commit(staged) : Promise.resolve(false)) }
}
