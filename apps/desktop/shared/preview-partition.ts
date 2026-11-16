/** Default profile keeps its existing cookie jar across desktop upgrades.
 * Renderer webviews and native preview guests must derive the same partition. */
export const PREVIEW_GUEST_PARTITION = 'persist:hermes-preview'

// Electron escapes ':' in disk paths, which prevents Windows cookie stores
// from reopening them. Keep profile components colon- and percent-free.
function sanitizePartitionComponent(id: string): string {
  return encodeURIComponent(id).replace(/%/g, '_')
}

/** Profile keys follow the renderer's trim / empty-to-default normalization. */
export function previewPartitionForProfile(profile: string | null | undefined): string {
  const key = (profile ?? '').trim() || 'default'

  return key === 'default' ? PREVIEW_GUEST_PARTITION : `${PREVIEW_GUEST_PARTITION}-${sanitizePartitionComponent(key)}`
}

/** Admit only the default preview cookie jar and its per-profile siblings. */
export function isPreviewPartition(partition: string | undefined): boolean {
  return (
    partition === PREVIEW_GUEST_PARTITION ||
    (typeof partition === 'string' && partition.startsWith(`${PREVIEW_GUEST_PARTITION}-`))
  )
}
