import { existsSync } from 'node:fs'
import { notarizeFile } from './notarize.mjs'

async function main() {
  const artifactPath = process.argv[2]
  if (!artifactPath || !existsSync(artifactPath)) {
    throw new Error('Missing artifact to notarize')
  }
  if (!await notarizeFile(artifactPath)) {
    throw new Error('Apple notarization credentials are required')
  }
}

main().catch(() => {
  console.error('Notarization failed. Check configuration and command output in secure CI logs.')
  process.exit(1)
})
