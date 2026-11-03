import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

function replaceFixtureAnchor(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) {
    throw new Error('Native fixture overlay requires exactly one known protocol anchor')
  }

  return source.replace(before, after)
}

/** The sibling API checkout stays read-only. Only its synthetic test provider
 * needs distinct tool ids to satisfy Hermes' session-wide call-id contract. */
export function prepareNativeProtocolOverlay(apiRoot: string, directory: string, apiSha: string) {
  const sourcePath = path.resolve(apiRoot, 'backend/internal/repository/aino_native_protocol_integration_test.go')
  const original = fs.readFileSync(sourcePath, 'utf8')

  let patched = replaceFixtureAnchor(original,
    '\ttoolID := "fixture-native-read"\n',
    '\ttoolID := fmt.Sprintf("fixture-native-read-%d", call)\n')

  patched = replaceFixtureAnchor(patched,
    '\t\tif last.ToolCallID != toolID || !matched || !strings.Contains(string(last.Content), p.content) {\n',
    '\t\tif !strings.HasPrefix(last.ToolCallID, "fixture-native-read-") || !matched || !strings.Contains(string(last.Content), p.content) {\n')

  const overlayDirectory = path.join(directory, 'fixture-protocol-overlay')
  fs.mkdirSync(overlayDirectory, { mode: 0o700 })
  const originalPath = path.join(overlayDirectory, 'original_test.go')
  const patchedPath = path.join(overlayDirectory, 'patched_test.go')
  const contractPath = path.join(overlayDirectory, 'contract_test.go')
  const contract = fs.readFileSync(fileURLToPath(new URL('./fixtures/native-tool-turn-contract_test.go', import.meta.url)))
  fs.writeFileSync(originalPath, original, { mode: 0o600 })
  fs.writeFileSync(patchedPath, patched, { mode: 0o600 })
  fs.writeFileSync(contractPath, contract, { mode: 0o600 })

  const overlayPath = path.join(overlayDirectory, 'overlay.json')
  fs.writeFileSync(overlayPath, JSON.stringify({ Replace: {
    [sourcePath]: patchedPath,
    [path.join(path.dirname(sourcePath), 'aino_overlay_read_tool_contract_test.go')]: contractPath
  } }, null, 2), { mode: 0o600 })

  const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--', originalPath, patchedPath], { encoding: 'utf8' })

  if (diff.error) { throw diff.error }

  if (diff.status !== 1) { throw new Error(`Native fixture overlay diff failed: ${diff.stderr}`) }

  const diffPath = path.join(overlayDirectory, 'fixture-only.diff')
  fs.writeFileSync(diffPath, diff.stdout, { mode: 0o600 })
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

  const receipt = {
    scope: 'synthetic Go test provider only; API production handlers and source checkout unchanged',
    api_source_sha: apiSha,
    source_path: sourcePath,
    source_sha256: hash(original),
    patched_source_sha256: hash(patched),
    contract_sha256: hash(contract),
    overlay_path: overlayPath,
    diff_path: diffPath
  }

  const receiptPath = path.join(overlayDirectory, 'receipt.json')
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 })

  return { ...receipt, receipt_path: receiptPath }
}
