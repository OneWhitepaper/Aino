import type { PayloadPythonRunner } from '../app-updater'

interface RegisteredSource {
  kind: 'registered'
  sourceUri: string
}

interface UnpackagedSource {
  kind: 'not-packaged'
}

interface SourceError {
  kind: 'error'
  error: string
}

export type AppInstallerSource = RegisteredSource | UnpackagedSource | SourceError

/** Apply needs source authority, independently of a potentially networked availability check. */
export async function readAppInstallerSource(runner: PayloadPythonRunner): Promise<AppInstallerSource> {
  const { code, stdout } = await runner.run(runner.python, runner.module, ['--source-only'])

  return parseAppInstallerSourceOutput(code, stdout)
}

export function parseAppInstallerSourceOutput(code: number, stdout: string): AppInstallerSource {
  let payload: unknown

  try {
    payload = JSON.parse(stdout)
  } catch {
    return { kind: 'error', error: code !== 0 ? `checker exited ${code}` : 'checker returned invalid source JSON' }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { kind: 'error', error: 'checker returned no source resolution' }
  }

  const parsed = payload as Record<string, unknown>

  // The bounded runner's timeout/spawn errors retain their original message.
  if (code !== 0 || parsed.source_resolution === 'error') {
    return {
      kind: 'error',
      error: typeof parsed.error === 'string' && parsed.error ? parsed.error : `checker exited ${code}`
    }
  }

  if ('available' in parsed || 'availability' in parsed || 'error' in parsed) {
    return { kind: 'error', error: 'checker returned an invalid source resolution response' }
  }

  if (parsed.source_resolution === 'registered' && typeof parsed.source_uri === 'string' && parsed.source_uri.trim()) {
    return { kind: 'registered', sourceUri: parsed.source_uri }
  }

  if (parsed.source_resolution === 'not-packaged' && !('source_uri' in parsed)) {
    return { kind: 'not-packaged' }
  }

  return { kind: 'error', error: 'checker returned no registered source resolution' }
}
