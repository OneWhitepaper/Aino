/**
 * The default profile keeps the existing preview jar across upgrades. Named
 * profiles use sibling jars so their imported sign-ins stay isolated.
 */
export const PREVIEW_GUEST_PARTITION = 'persist:hermes-preview'

// Electron percent-escapes ':' in on-disk profile folders, breaking Windows
// cookie stores. Replace encoded '%' too so the component is never escaped.
function sanitizePartitionComponent(id: string): string {
  return encodeURIComponent(id).replace(/%/g, '_')
}

/** Main and the renderer must resolve byte-identical jars for each tab owner. */
export function previewPartitionForProfile(profile: string | null | undefined): string {
  const key = (profile ?? '').trim() || 'default'

  return key === 'default' ? PREVIEW_GUEST_PARTITION : `${PREVIEW_GUEST_PARTITION}-${sanitizePartitionComponent(key)}`
}

/** Only this family receives the preview guest preload and admission policy. */
export function isPreviewPartition(partition: string | undefined): boolean {
  return (
    partition === PREVIEW_GUEST_PARTITION ||
    (typeof partition === 'string' && partition.startsWith(`${PREVIEW_GUEST_PARTITION}-`))
  )
}
