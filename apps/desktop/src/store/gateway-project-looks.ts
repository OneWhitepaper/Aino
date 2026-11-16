import { map } from 'nanostores'

import type { HermesGateway } from '@/hermes'
import { gatewayRouteState } from '@/store/gateway'
import type { AgentProfileRoute } from '@/store/profile'
import type { ProjectInfo, ProjectsPayload } from '@/types/hermes'

// A project another gateway owns is drawn from that gateway's session rows; its
// look (color / icon) lives in THAT gateway profile's projects.db, the same
// record its own window reads. The sidebar only reads over a socket already
// open to that owner; it never dials a gateway or creates a project for its look.

export interface GatewayProjectLook {
  color: null | string
  icon: null | string
  /** The owner's project record for the folder, once it has one. */
  id: null | string
}

/** route key → folder → look, for the folders each owner has a project record for. */
export const $gatewayProjectLooks = map<Record<string, Record<string, GatewayProjectLook>>>({})

export const gatewayRouteKey = (route: AgentProfileRoute): string => JSON.stringify([route.connectionId, route.profile])

export const folderKey = (path: string): string => path.replace(/[\\/]+$/, '') || path

/** Each folder's live project: a primary path wins over a folder another project merely includes. */
function looksByFolder(projects: ProjectInfo[]): Record<string, GatewayProjectLook> {
  const looks: Record<string, GatewayProjectLook> = {}
  const live = projects.filter(project => !project.archived)
  const paths = (project: ProjectInfo) => [project.primary_path, ...(project.folders ?? []).map(folder => folder.path)]

  for (const project of [...live].sort((a, b) => Number(!a.primary_path) - Number(!b.primary_path))) {
    for (const path of paths(project)) {
      const key = path && folderKey(path)

      if (key && !looks[key]) {
        looks[key] = { color: project.color ?? null, icon: project.icon ?? null, id: project.id }
      }
    }
  }

  return looks
}

interface OwnerRead {
  /** Failed reads on the watched socket; at the cap the owner waits for that socket to reconnect. */
  failures: number
  inFlight: boolean
  /** The socket reconnected while a read was in flight: that read may predate it, so read again. */
  rereadQueued: boolean
  /** The socket the published looks came over; until it matches the route's socket, a render reads. */
  readOver: HermesGateway | null
  stopWatching: () => void
  watching: HermesGateway | null
}

const MAX_FAILED_READS = 3
const reads = new Map<string, OwnerRead>()

async function readOwner(route: AgentProfileRoute, read: OwnerRead, gateway: HermesGateway): Promise<void> {
  read.inFlight = true

  try {
    const payload = await gateway.request<ProjectsPayload>('projects.list', { profile: route.profile })

    $gatewayProjectLooks.setKey(gatewayRouteKey(route), looksByFolder(payload.projects ?? []))
    read.failures = 0
    read.readOver = gateway
  } catch {
    read.failures += 1
  } finally {
    read.inFlight = false
  }

  if (read.rereadQueued) {
    read.rereadQueued = false
    read.failures = 0
    read.readOver = null

    if (read.watching === gateway && gateway.connectionState === 'open') {
      await readOwner(route, read, gateway)
    }
  }
}

/** A socket that drops and reopens re-reads: the owner's window may have recoloured meanwhile. */
function watchSocket(route: AgentProfileRoute, read: OwnerRead, gateway: HermesGateway): void {
  let dropped = false

  read.stopWatching()
  read.watching = gateway
  read.failures = 0
  read.stopWatching = gateway.onState(state => {
    if (state !== 'open') {
      dropped = true
    } else if (dropped) {
      dropped = false
      read.failures = 0
      read.readOver = null

      if (read.inFlight) {
        read.rereadQueued = true
      } else {
        void readOwner(route, read, gateway)
      }
    }
  })
}

/** Read each owner's looks on a socket already open to it: a sidebar render never dials or spawns
 *  a backend (an idle-evicted local profile, a new pool entry per profile on a shared host). An
 *  owner with no open socket, or whose read failed, is read again on a later render (failures
 *  capped per socket); a reconnect of that socket re-reads on its own. */
export function loadGatewayProjectLooks(routes: AgentProfileRoute[]): void {
  for (const route of routes) {
    const key = gatewayRouteKey(route)
    const { gateway } = gatewayRouteState(route.connectionId, route.profile)

    if (!gateway) {
      continue
    }

    const read = reads.get(key) ?? {
      failures: 0,
      inFlight: false,
      readOver: null,
      rereadQueued: false,
      stopWatching: () => {},
      watching: null
    }

    reads.set(key, read)

    if (read.watching !== gateway) {
      watchSocket(route, read, gateway)
    }

    if (!read.inFlight && read.readOver !== gateway && read.failures < MAX_FAILED_READS) {
      void readOwner(route, read, gateway)
    }
  }
}

export function gatewayProjectLook(route: AgentProfileRoute, path: string): GatewayProjectLook | undefined {
  return $gatewayProjectLooks.get()[gatewayRouteKey(route)]?.[folderKey(path)]
}
