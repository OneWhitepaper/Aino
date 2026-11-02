import './pet-settings.css'

import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { PetThumb } from '@/components/pet/pet-thumb'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Check, Download, Loader2, PawPrint, Pencil, Trash2 } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import { cn } from '@/lib/utils'
import { $petInfo, $petRoam, setPetRoam } from '@/store/pet'
import {
  $petBusy,
  $petGallery,
  $petGalleryError,
  $petGalleryStatus,
  adoptPet,
  exportPet as exportPetAction,
  type GalleryPet,
  loadPetGallery,
  loadPetThumb,
  PET_SCALE_DEFAULT,
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  rankedGalleryPets,
  removePet as removePetAction,
  renamePet as renamePetAction,
  setPetEnabled,
  setPetScale
} from '@/store/pet-gallery'
import { $gatewayState } from '@/store/session'

import { ListRow, SettingsDisclosure, SettingsGroup, ToggleRow } from './primitives'

/**
 * Appearance opt-in for the floating petdex mascot. A thin view over the shared
 * `pet-gallery` store — it subscribes to the atoms and calls the store actions,
 * so the gallery is fetched once + cached and adopt/toggle/remove patch local
 * state instead of re-pulling the network gallery. The floating mascot polls
 * `pet.info`, so picking a pet here lights it up within a couple seconds.
 */
export function PetSettings() {
  const { t } = useI18n()
  const copy = t.settings.appearance.pet
  const { requestGateway } = useGatewayRequest()
  const gatewayState = useStore($gatewayState)
  const gallery = useStore($petGallery)
  const status = useStore($petGalleryStatus)
  const error = useStore($petGalleryError)
  const busySlug = useStore($petBusy)
  const petInfo = useStore($petInfo)
  const roam = useStore($petRoam)
  const [query, setQuery] = useState('')
  const [catalogExpanded, setCatalogExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<GalleryPet | null>(null)
  const [renameTarget, setRenameTarget] = useState<GalleryPet | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const scale = petInfo.scale ?? PET_SCALE_DEFAULT

  useEffect(() => {
    if (gatewayState !== 'open') {
      return
    }

    void loadPetGallery(requestGateway)
  }, [gatewayState, requestGateway])

  const enabled = gallery?.enabled ?? false
  const active = gallery?.active ?? ''
  const pets = gallery?.pets ?? []
  const staleBackend = status === 'stale'

  const selectPet = (slug: string) => {
    void adoptPet(requestGateway, slug, copy.adoptFailed(slug)).then(ok => ok && triggerHaptic('crisp'))
  }

  const removePet = (slug: string) => {
    void removePetAction(requestGateway, slug, copy.uninstallFailed(slug)).then(ok => ok && triggerHaptic('crisp'))
  }

  const exportPet = (slug: string) => {
    void exportPetAction(requestGateway, slug, copy.exportFailed(slug)).then(ok => ok && triggerHaptic('crisp'))
  }

  const saveRename = () => {
    if (!renameTarget || !renameValue.trim()) {
      return
    }

    // Optimistic: the rename paints instantly, so close now and let the RPC
    // settle in the background (it rolls back + surfaces an error on failure).
    const { slug } = renameTarget
    setRenameTarget(null)
    triggerHaptic('crisp')
    void renamePetAction(requestGateway, slug, renameValue, copy.renameFailed(slug))
  }

  const toggle = (on: boolean) => {
    void setPetEnabled(requestGateway, on, {
      noneAvailable: copy.noneAvailable,
      fallback: on ? copy.turnOnFailed : copy.turnOffFailed
    }).then(ok => ok && triggerHaptic('crisp'))
  }

  // The petdex catalog is thousands of entries, so rank + cap how many render.
  const RENDER_CAP = 60
  const sorted = rankedGalleryPets(gallery, query)
  const shown = sorted.slice(0, RENDER_CAP)
  const installed = shown.filter(pet => pet.installed)
  const catalog = shown.filter(pet => !pet.installed)

  const renderCard = (pet: GalleryPet) => (
    <PetCard
      active={enabled && active === pet.slug}
      busy={busySlug === pet.slug}
      currentLabel={t.appearancePage.petCurrent}
      deleteLabel={pet.generated ? copy.delete(pet.displayName) : copy.uninstall(pet.displayName)}
      exportLabel={copy.exportPet(pet.displayName)}
      generatedLabel={copy.generatedTag}
      installedLabel={copy.installedTag}
      key={pet.slug}
      loadThumb={(slug, url) => loadPetThumb(requestGateway, slug, url)}
      onExport={() => exportPet(pet.slug)}
      onRemove={() => (pet.generated ? setConfirmDelete(pet) : removePet(pet.slug))}
      onRename={() => {
        setRenameValue(pet.displayName)
        setRenameTarget(pet)
      }}
      onSelect={() => selectPet(pet.slug)}
      pet={pet}
      renameLabel={copy.rename(pet.displayName)}
    />
  )

  return (
    <div className="pet-settings">
      <header className="pet-settings-header">
        <div>
          <h2>{copy.chooseTitle}</h2>
          <p>{copy.intro}</p>
        </div>
        <Switch
          aria-label={copy.chooseTitle}
          checked={enabled}
          onCheckedChange={on => {
            triggerHaptic('selection')
            toggle(on)
          }}
        />
      </header>

      {staleBackend && <p className="pet-settings-notice">{copy.restartHint}</p>}

      <SearchField
        aria-label={copy.searchPlaceholder}
        containerClassName="pet-settings-search"
        onChange={setQuery}
        placeholder={copy.searchPlaceholder}
        value={query}
        variant="box"
      />
      <p className="pet-settings-description">{copy.chooseDesc}</p>

      {status === 'loading' && pets.length === 0 ? (
        <div className="pet-settings-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="pet-settings-skeleton" key={i}>
              <Skeleton className="size-12 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-24 max-w-full" />
                <Skeleton className="h-3 w-16 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : pets.length === 0 ? (
        <p className="pet-settings-empty">{copy.unreachable}</p>
      ) : shown.length === 0 ? (
        <p className="pet-settings-empty">{copy.noMatch(query)}</p>
      ) : (
        <>
          {installed.length > 0 && (
            <section className="pet-settings-installed">
              <h3>
                {copy.installedTag}
                <span>{installed.length}</span>
              </h3>
              <div className="pet-settings-grid">{installed.map(renderCard)}</div>
            </section>
          )}
          {catalog.length > 0 && (
            <SettingsDisclosure
              expanded={catalogExpanded || query.length > 0}
              icon={PawPrint}
              label={`${t.appearancePage.petCatalog} · ${catalog.length}`}
              mounted
              onToggle={() => setCatalogExpanded(value => !value)}
            >
              <div className="pet-settings-grid pet-settings-catalog">{catalog.map(renderCard)}</div>
            </SettingsDisclosure>
          )}
        </>
      )}
      <p aria-live="polite" className="pet-settings-status" role="status">
        {error ? (
          <span className="text-(--ui-red)">{error}</span>
        ) : sorted.length > RENDER_CAP ? (
          copy.countCapped(RENDER_CAP, sorted.length)
        ) : (
          copy.count(sorted.length)
        )}
      </p>

      {enabled && (
        <SettingsGroup className="pet-settings-options">
          <ListRow
            action={
              <div className="flex items-center gap-3">
                <Slider
                  aria-label={copy.scaleTitle}
                  max={PET_SCALE_MAX}
                  min={PET_SCALE_MIN}
                  onChange={event => {
                    triggerHaptic('selection')
                    setPetScale(requestGateway, Number(event.target.value))
                  }}
                  step={0.05}
                  value={scale}
                />
                <span className="w-9 text-right text-[length:var(--conversation-caption-font-size)] tabular-nums text-(--ui-text-tertiary)">
                  {`${Math.round(scale * 100)}%`}
                </span>
              </div>
            }
            description={copy.scaleDesc}
            title={copy.scaleTitle}
          />

          <ToggleRow checked={roam} description={copy.roamDesc} label={copy.roamTitle} onChange={setPetRoam} />
        </SettingsGroup>
      )}

      <ConfirmDialog
        confirmLabel={copy.deleteConfirm}
        description={copy.deleteBody}
        destructive
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) {
            const ok = await removePetAction(
              requestGateway,
              confirmDelete.slug,
              copy.uninstallFailed(confirmDelete.slug)
            )

            if (!ok) {
              throw new Error(copy.uninstallFailed(confirmDelete.slug))
            }

            triggerHaptic('crisp')
          }
        }}
        open={confirmDelete !== null}
        title={confirmDelete ? copy.deleteTitle(confirmDelete.displayName) : ''}
      />

      <Dialog onOpenChange={open => !open && setRenameTarget(null)} open={renameTarget !== null}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{copy.renameTitle}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            onChange={event => setRenameValue(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                event.preventDefault()
                saveRename()
              }
            }}
            placeholder={copy.renamePlaceholder}
            value={renameValue}
          />
          <DialogFooter>
            <Button onClick={() => setRenameTarget(null)} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={!renameValue.trim()} onClick={saveRename}>
              {copy.renameSave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface PetCardProps {
  active: boolean
  busy: boolean
  currentLabel: string
  deleteLabel: string
  exportLabel: string
  generatedLabel: string
  installedLabel: string
  loadThumb: (slug: string, url?: string) => Promise<string | null>
  onExport: () => void
  onRemove: () => void
  onRename: () => void
  onSelect: () => void
  pet: GalleryPet
  renameLabel: string
}

function PetCard({
  active,
  busy,
  currentLabel,
  deleteLabel,
  exportLabel,
  generatedLabel,
  installedLabel,
  loadThumb,
  onExport,
  onRemove,
  onRename,
  onSelect,
  pet,
  renameLabel
}: PetCardProps) {
  return (
    <article className="pet-settings-card" data-current={active || undefined}>
      <button aria-pressed={active} className="pet-settings-select" disabled={busy} onClick={onSelect} type="button">
        <PetThumb alt={pet.displayName} load={loadThumb} size={48} slug={pet.slug} url={pet.spritesheetUrl} />
        <span className="pet-settings-identity">
          <span className="pet-settings-name">{pet.displayName}</span>
          <span className="pet-settings-slug">{pet.slug}</span>
          {pet.generated && <span className="pet-settings-tag">{generatedLabel}</span>}
        </span>
        {busy && <Loader2 className="pet-settings-busy animate-spin" />}
      </button>
      {(pet.installed || pet.generated) && (
        <div className="pet-settings-card-footer">
          <span className="pet-settings-card-status" data-current={active || undefined}>
            {active && <Check aria-hidden="true" />}
            {active ? currentLabel : pet.installed ? installedLabel : generatedLabel}
          </span>
          <div className="pet-settings-actions">
            {pet.generated && <PetAction disabled={busy} icon={<Pencil />} label={renameLabel} onClick={onRename} />}
            {pet.generated && <PetAction disabled={busy} icon={<Download />} label={exportLabel} onClick={onExport} />}
            {pet.installed && (
              <PetAction danger disabled={busy} icon={<Trash2 />} label={deleteLabel} onClick={onRemove} />
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function PetAction({
  danger,
  disabled,
  icon,
  label,
  onClick
}: {
  danger?: boolean
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className={cn('pet-settings-action', danger && 'pet-settings-action-danger')}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
