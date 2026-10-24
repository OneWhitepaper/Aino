/**
 * docs.ts — canonical docs-site links used by the renderer's recovery and
 * setup surfaces. Single authority so the "reinstall the app" affordance
 * (bundled installs with a damaged payload) and any future doc links point
 * at the same place.
 */
import { DOCUMENTATION_URL, REPOSITORY_URL } from './brand'

export const DESKTOP_DOCS_URL = DOCUMENTATION_URL
export const RUNTIME_DOCS_URL = `${REPOSITORY_URL}/blob/main/website/docs`
export const PROVIDER_DOCS_URL = `${RUNTIME_DOCS_URL}/integrations/providers.md`
export const SESSION_STORAGE_RECOVERY_URL = `${RUNTIME_DOCS_URL}/user-guide/session-storage-recovery.md#when-the-three-steps-do-not-work`
