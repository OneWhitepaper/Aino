import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

import { PRODUCT_NAME } from './product-identity'

interface ComputerNameOptions {
  readComputerName?: () => Promise<string>
  hostname?: () => string
}

function displayName(value: string): string {
  const name = value.trim()

  return /[\p{Cc}\p{Cf}]/u.test(name) ? '' : Array.from(name).slice(0, 80).join('')
}

async function readMacComputerName(): Promise<string> {
  const { stdout } = await promisify(execFile)('/usr/sbin/scutil', ['--get', 'ComputerName'], {
    encoding: 'utf8',
    timeout: 1000,
    maxBuffer: 4096
  })

  return stdout
}

/** Electron reads the client machine, even when its agent runtime is remote. */
export async function resolveNativeComputerName(
  platform: NodeJS.Platform,
  options: ComputerNameOptions = {}
): Promise<string> {
  const fallback = () => displayName((options.hostname ?? hostname)()) || PRODUCT_NAME

  if (platform !== 'darwin') {
    return fallback()
  }

  try {
    return displayName(await (options.readComputerName ?? readMacComputerName)()) || fallback()
  } catch {
    // ComputerName is optional; network hostname still identifies this installation.
    return fallback()
  }
}
