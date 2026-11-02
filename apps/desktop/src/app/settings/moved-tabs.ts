import { CAPABILITIES_ROUTE } from '../routes'

// `plugins` used to redirect here too; it is a live Settings view again
// (Settings ▸ Plugins = each plugin's own settings pages).
const MOVED_TO_CAPABILITIES: Record<string, { param: string; tab: string }> = {
  mcp: { param: 'server', tab: 'connectors' }
}

export function movedSettingsTabRedirect(search: string): null | string {
  const params = new URLSearchParams(search)

  if (params.get('tab') === 'resources') {
    params.set('tab', 'about')

    return `/settings?${params}`
  }

  if (params.get('tab') === 'vault') {
    params.set('tab', 'config:safety')
    params.set('vault', 'open')
    params.set('page', 'vault')

    return `/settings?${params}`
  }

  if (params.get('tab') === 'keys') {
    params.set('tab', 'config:advanced')
    params.delete('kview')
    params.set('page', 'keys')

    return `/settings?${params}`
  }

  if (params.get('tab') === 'billing') {
    params.set('tab', 'account')
    params.delete('bview')

    return `/settings?${params}`
  }

  if (params.get('tab') === 'providers' && ['accounts', 'keys'].includes(params.get('pview') ?? '')) {
    params.set('tab', 'config:model')
    params.delete('pview')
    params.delete('key')

    return `/settings?${params}`
  }

  const providerView = params.get('pview')

  if (
    params.get('tab') === 'providers' &&
    providerView !== null &&
    !['third-party', 'custom-endpoints', 'local'].includes(providerView)
  ) {
    params.set('pview', 'custom-endpoints')

    return `/settings?${params}`
  }

  if (
    params.get('tab') === 'config:advanced' &&
    (params.get('page') === 'delegation' || params.get('field')?.startsWith('delegation.'))
  ) {
    params.set('tab', 'config:model')
    params.set('page', 'delegation')

    return `/settings?${params}`
  }

  const moved = MOVED_TO_CAPABILITIES[params.get('tab') ?? '']

  if (moved === undefined) {
    return null
  }

  const row = params.get(moved.param)
  const suffix = row ? `&${moved.param}=${encodeURIComponent(row)}` : ''

  return `${CAPABILITIES_ROUTE}?tab=${moved.tab}${suffix}`
}
