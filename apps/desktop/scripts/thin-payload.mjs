// Architecture-specific installers need only their native slice. Run before
// nested signing so Apple's seal and the PM facts describe the shipped bytes.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { classifyHeader } from './audit-bundle-arch.mjs'

export function thinPayloadBinaries(root, arch) {
  const slice = { arm64: 'arm64', x64: 'x86_64' }[arch]
  if (!slice) throw new Error(`Unsupported macOS payload architecture: ${arch}`)
  let count = 0
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      if (!entry.isFile()) continue
      const head = Buffer.alloc(4096)
      const descriptor = fs.openSync(file, 'r')
      let read
      try { read = fs.readSync(descriptor, head, 0, head.length, 0) }
      finally { fs.closeSync(descriptor) }
      const format = classifyHeader(head.subarray(0, read))
      if (format?.format !== 'macho-fat' || format.arches.length < 2) continue
      if (!format.arches.includes(arch)) throw new Error(`Payload is missing ${arch}: ${file}`)
      const temporary = `${file}.native-slice`
      try {
        execFileSync('lipo', [file, '-thin', slice, '-output', temporary], { stdio: 'pipe' })
        fs.chmodSync(temporary, fs.statSync(file).mode)
        fs.renameSync(temporary, file)
      } finally { fs.rmSync(temporary, { force: true }) }
      count += 1
    }
  }
  if (fs.existsSync(root)) walk(root)
  return count
}
