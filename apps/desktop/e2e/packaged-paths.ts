import fs from 'node:fs'
import path from 'node:path'

import identity from '../brand.json' with { type: 'json' }

export interface PackagedBinaryPathOptions {
  platform?: string
  arch?: string
  releaseRoot: string
}

const LEGACY_DESKTOP_PRODUCT_NAMES = ['Hermes', 'hermes'] as const

function productNames(platform: string): string[] {
  const names = [identity.productName]

  if (platform === 'linux') {
    names.unshift(identity.productName.toLowerCase())
    names.push(...LEGACY_DESKTOP_PRODUCT_NAMES)
  } else {
    names.push('Hermes')
  }

  return [...new Set(names)]
}

/** Return packaged binary paths in new-product-first discovery order. */
export function packagedBinaryCandidates({
  platform = process.platform,
  arch = process.arch === 'arm64' ? 'arm64' : 'x64',
  releaseRoot
}: PackagedBinaryPathOptions): string[] {
  const names = productNames(platform)

  if (platform === 'win32') {
    return names.map(name => path.join(releaseRoot, 'win-unpacked', `${name}.exe`))
  }

  if (platform === 'darwin') {
    return names
      .filter(name => name !== 'hermes')
      .map(name => path.join(releaseRoot, `mac-${arch}`, `${name}.app`, 'Contents', 'MacOS', name))
  }

  return names.map(name => path.join(releaseRoot, 'linux-unpacked', name))
}

/** Resolve the first existing packaged binary, retaining a deterministic fallback path. */
export function resolvePackagedBinaryPath(options: PackagedBinaryPathOptions): string {
  const candidates = packagedBinaryCandidates(options)

  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0]
}
