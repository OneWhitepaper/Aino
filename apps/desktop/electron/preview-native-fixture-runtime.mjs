import { realpathSync } from 'node:fs'

/** The parent runner removes Chromium's data only after the Electron process closes. */
export function nativeFixtureRuntime() {
  if (!process.argv[3]) {
    throw new Error(
      'Use node scripts/test-preview-native.mjs <evidence-directory> [fixture.test.mjs]; its parent process owns runtime cleanup.'
    )
  }
  return realpathSync(process.argv[3])
}
