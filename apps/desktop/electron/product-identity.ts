import path from 'node:path'

import identity from '../brand.json'

export const PRODUCT_NAME = identity.productName
/** Pre-brand package name kept only for migration/discovery fallbacks. */
export const LEGACY_PRODUCT_NAME = 'Hermes'
export const AGENT_NAME = identity.agentName
export const COMPANY_NAME = identity.companyName
export const LEGAL_COPYRIGHT = identity.legalCopyright
export const APP_ID = identity.appId
export const HOME_DIR_NAME = identity.homeDirName
export const PRIMARY_PROTOCOL = identity.primaryProtocol
export const LEGACY_PROTOCOL = identity.legacyProtocol
export const REPOSITORY_URL = identity.repositoryUrl
export const UPSTREAM_REPOSITORY_URL = identity.upstreamRepositoryUrl
export const REPOSITORY_PATH = REPOSITORY_URL.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')
export const REPOSITORY_SSH_URL = `git@github.com:${REPOSITORY_PATH.replace(/\.git$/, '')}.git`

const LEGACY_HOME_DIR_NAME = 'hermes'

export interface AgentHomePathOptions {
  platform: string
  homeDir: string
  localAppData?: string
}

function agentHomePathForName({ platform, homeDir, localAppData }: AgentHomePathOptions, dirName: string): string {
  const pathModule = platform === 'win32' ? path.win32 : path.posix

  if (platform === 'win32' && localAppData) {
    return pathModule.join(localAppData, dirName)
  }

  return pathModule.join(homeDir, `.${dirName}`)
}

/** Resolve the default Aino agent data root for a host platform. */
export function defaultAgentHomePath(options: AgentHomePathOptions): string {
  return agentHomePathForName(options, HOME_DIR_NAME)
}

/** Resolve the pre-brand Hermes agent data root for migration probing. */
export function legacyAgentHomePath(options: AgentHomePathOptions): string {
  return agentHomePathForName(options, LEGACY_HOME_DIR_NAME)
}

export interface AgentHomeResolutionOptions extends AgentHomePathOptions {
  /** Whether the new Aino root already exists (files are not enough). */
  primaryExists: boolean
  /** Whether the legacy root contains a usable `hermes-agent` runtime. */
  legacyRuntimeExists: boolean
}

/**
 * Resolve the home root using the same narrow migration ladder as the
 * bootstrap installer: Aino always wins once created; an existing legacy
 * runtime is used only when the Aino root is still absent.
 */
export function resolveAgentHomePath({
  platform,
  homeDir,
  localAppData,
  primaryExists,
  legacyRuntimeExists
}: AgentHomeResolutionOptions): string {
  const options = { platform, homeDir, localAppData }
  const primary = defaultAgentHomePath(options)
  const legacy = legacyAgentHomePath(options)

  return !primaryExists && legacyRuntimeExists ? legacy : primary
}

/** Resolve the per-application Electron userData directory in dev and prod. */
export function defaultUserDataPath(appDataPath: string): string {
  return path.join(appDataPath, PRODUCT_NAME)
}

// product-identity.ts — the typed build-time product identity.
//
// product-identity.cjs is the single derivation of every name-shaped
// value a variant owns (product name, appId, channel). Dev bundles and
// test runs import the .cjs itself so the derivation exists in exactly
// one place.

import { mkdirSync } from 'node:fs'
// without this rename it breaks due to some bundler injection of the same name
import { createRequire as nodeCreateRequire } from 'node:module'

import type devIdentity from '../product-identity.cjs'

/** Mirrors product-identity.cjs (see product-identity.d.cts). */
export type ProductIdentity = typeof devIdentity

declare const __HERMES_PRODUCT_IDENTITY__: ProductIdentity

/** The baked identity of this artifact (dev bundles derive it live). */
export const PRODUCT_IDENTITY: Readonly<ProductIdentity> =
  typeof __HERMES_PRODUCT_IDENTITY__ === 'undefined'
    ? Object.freeze(nodeCreateRequire(import.meta.url)('../product-identity.cjs') as ProductIdentity)
    : Object.freeze(__HERMES_PRODUCT_IDENTITY__)

/** Pin before the first userData lookup and single-instance lock. Electron's
 * later display-name changes must not redirect an installed build's state.
 * Stable keeps its historical userData and runtime naming behavior.
 */
export function applyDesktopIdentity(
  app: {
    getPath(name: 'appData'): string
    setPath(name: 'userData', value: string): void
    setName(name: string): void
  },
  identity: Readonly<ProductIdentity> = PRODUCT_IDENTITY
): string | null {
  if (!identity.token && identity.appNamePascal === identity.artifactNamePascal) {
    return null
  }

  const userData: string = path.join(app.getPath('appData'), identity.appNamePascal)
  mkdirSync(userData, { recursive: true })
  app.setPath('userData', userData)
  app.setName(identity.displayName)

  return identity.displayName
}
