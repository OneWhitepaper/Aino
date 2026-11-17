import { readJsonErrorBody, readStatusCode } from './api-transport'
import { discoverWithTeamFallback } from './cloud-discovery'

interface DiscoveryDeps {
  assertCurrent: () => void
  portalBaseUrl: string
  hasLivePortalSession: () => Promise<boolean>
  hasPortalAccessToken: () => Promise<boolean>
  renewPortalAccessSilently: (options?: { force: boolean }) => Promise<boolean>
  fetchAgents: (url: string) => Promise<unknown>
}

interface CloudOrg {
  id: string
  slug: null | string
  name: string
  isPersonal: boolean
  role: string
}

function trimOrg(value: unknown): CloudOrg | null {
  const org = value as Partial<CloudOrg> | null

  return org && typeof org.id === 'string'
    ? {
        id: org.id,
        slug: typeof org.slug === 'string' ? org.slug : null,
        name: typeof org.name === 'string' ? org.name : org.id,
        isPersonal: Boolean(org.isPersonal),
        role: typeof org.role === 'string' ? org.role : 'MEMBER'
      }
    : null
}

function loginRequired(): Error {
  return Object.assign(new Error('Sign in to Hermes Cloud to choose a transfer destination.'), {
    needsCloudLogin: true
  })
}

/** Explicit Backup & Transfer action; no discovery runs during module creation or local backup. */
export function createCloudTransferDiscovery(deps: DiscoveryDeps) {
  async function current<T>(operation: () => Promise<T>): Promise<T> {
    deps.assertCurrent()

    try {
      return await operation()
    } finally {
      deps.assertCurrent()
    }
  }

  return async (org?: string) => {
    if (!(await current(deps.hasLivePortalSession))) {
      throw loginRequired()
    }

    if (!(await current(deps.hasPortalAccessToken))) {
      await current(() => deps.renewPortalAccessSilently())
    }

    const fetchAgents = () =>
      discoverWithTeamFallback(
        selected =>
          current(() =>
            deps.fetchAgents(
              `${deps.portalBaseUrl}/api/agents${selected ? `?org=${encodeURIComponent(selected)}` : ''}`
            )
          ),
        org
      )

    let body: unknown

    try {
      body = await fetchAgents()
    } catch (initialError) {
      let error = initialError

      if (readStatusCode(error) === 401 && (await current(() => deps.renewPortalAccessSilently({ force: true })))) {
        try {
          body = await fetchAgents()
        } catch (retryError) {
          error = retryError
        }
      }

      if (body === undefined) {
        if (readStatusCode(error) === 401) {
          throw loginRequired()
        }

        const parsed = readJsonErrorBody(error)

        if (readStatusCode(error) === 409 && parsed?.error === 'org_selection_required' && Array.isArray(parsed.orgs)) {
          return {
            needsOrgSelection: true as const,
            orgs: parsed.orgs.map(trimOrg).filter((item): item is CloudOrg => item !== null)
          }
        }

        throw error
      }
    }

    const payload = body as { agents?: unknown[]; org?: unknown } | null
    const agents = (Array.isArray(payload?.agents) ? payload.agents : []) as Record<string, unknown>[]

    return {
      agents: agents
        .filter(a => a && typeof a === 'object' && typeof a.id === 'string')
        .map(a => ({
          id: a.id as string,
          name: typeof a.name === 'string' ? a.name : (a.id as string),
          status: typeof a.status === 'string' ? a.status : 'unknown',
          dashboardUrl: typeof a.dashboardUrl === 'string' ? a.dashboardUrl : null,
          dashboardGatewayState: typeof a.dashboardGatewayState === 'string' ? a.dashboardGatewayState : 'unknown'
        })),
      org: trimOrg(payload?.org)
    }
  }
}
