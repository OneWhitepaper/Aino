import { atom } from 'nanostores'

/** Presentation only; opening the monitor never changes the foreground session. */
export const $collaborationCapsuleOpen = atom(false)

export function openCollaborationCapsule() {
  $collaborationCapsuleOpen.set(true)
}
