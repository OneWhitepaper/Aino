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

function recordFixtureDiff(original: string, patched: string, output: string, changed: boolean): void {
  const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--', original, patched], { encoding: 'utf8' })

  if (diff.error) {
    throw diff.error
  }

  if (diff.status !== (changed ? 1 : 0)) {
    throw new Error(`Native fixture overlay diff failed: ${diff.stderr}`)
  }

  fs.writeFileSync(output, diff.stdout, { mode: 0o600 })
}

/** The sibling API checkout stays read-only. Only its synthetic test provider
 * and lease-only consumer response projection are overlaid. */
export function prepareNativeProtocolOverlay(
  apiRoot: string,
  directory: string,
  apiSha: string,
  options: { selectableWithoutDefault?: boolean; catalogWithDefault?: boolean } = {}
) {
  const sourcePath = path.resolve(apiRoot, 'backend/internal/repository/aino_native_protocol_integration_test.go')
  const original = fs.readFileSync(sourcePath, 'utf8')
  const legacyID = '\ttoolID := "fixture-native-read"\n'
  const nativeID = '\ttoolID := nativeFixtureToolCallID("fixture-native-read", &body)\n'
  const resultCheck =
    '\t\tif last.ToolCallID != toolID || !matched || !strings.Contains(string(last.Content), p.content) {\n'

  const nativeProtocol =
    original.split(nativeID).length === 2 &&
    !original.includes(legacyID) &&
    original.split('func nativeFixtureToolCallID(prefix string, body *ainoNativeChatRequest) string {').length === 2 &&
    original.split(resultCheck).length === 2

  let patched = original

  if (!nativeProtocol) {
    if (original.includes(nativeID)) {
      throw new Error('Native fixture overlay encountered an unknown native tool-call protocol')
    }

    patched = replaceFixtureAnchor(original, legacyID, '\ttoolID := fmt.Sprintf("fixture-native-read-%d", call)\n')
    patched = replaceFixtureAnchor(
      patched,
      resultCheck,
      '\t\tif !strings.HasPrefix(last.ToolCallID, "fixture-native-read-") || !matched || !strings.Contains(string(last.Content), p.content) {\n'
    )
  }

  const overlayDirectory = path.join(directory, 'fixture-protocol-overlay')
  fs.mkdirSync(overlayDirectory, { mode: 0o700 })
  const originalPath = path.join(overlayDirectory, 'original_test.go')
  const patchedPath = path.join(overlayDirectory, 'patched_test.go')
  const contractPath = path.join(overlayDirectory, 'contract_test.go')
  const contract = fs.readFileSync(
    fileURLToPath(new URL('./fixtures/native-tool-turn-contract_test.go', import.meta.url))
  )
  fs.writeFileSync(originalPath, original, { mode: 0o600 })
  fs.writeFileSync(patchedPath, patched, { mode: 0o600 })
  fs.writeFileSync(contractPath, contract, { mode: 0o600 })

  // This consumer wires temporary leases, not the permanent device-key service.
  // Keep its bootstrap capability truthful without changing production handlers.
  const consumerSource = path.join(path.dirname(sourcePath), 'aino_native_consumer_integration_test.go')
  const consumerOriginal = fs.readFileSync(consumerSource, 'utf8')
  const capture =
    '\t\tcapture := req.URL.Path == "/api/v1/auth/phone/verify" || req.URL.Path == "/api/v1/auth/refresh" || req.URL.Path == "/api/v1/desktop/credentials"\n'

  let consumerPatched = replaceFixtureAnchor(
    consumerOriginal,
    capture,
    `${capture.trimEnd()} || req.URL.Path == "/api/v1/desktop/bootstrap"\n`
  )

  consumerPatched = replaceFixtureAnchor(
    consumerPatched,
    '\t\t\tlock.Lock()\n\t\t\tfor _, key := range []string{"access_token", "refresh_token", "api_key"} {\n',
    '\t\t\tif req.URL.Path == "/api/v1/desktop/bootstrap" {\n\t\t\t\tif capabilities, ok := data["capabilities"].(map[string]any); ok {\n\t\t\t\t\tdelete(capabilities, "managed_device_key")\n\t\t\t\t}\n\t\t\t}\n\t\t\tlock.Lock()\n\t\t\tfor _, key := range []string{"access_token", "refresh_token", "api_key"} {\n'
  )

  if (options.selectableWithoutDefault || options.catalogWithDefault) {
    consumerPatched = replaceFixtureAnchor(
      consumerPatched,
      '\tr.wireModel(t, 0)\n',
      `\tr.wireModel(t, 0)
\tentries := make([]service.DesktopModelEntry, 0, 6)
\tfor _, model := range []struct{ id, name string }{
\t\t{"gpt-6-astra", "gpt-6-astra"}, {"gpt-5.6-sol", "gpt-5.6-sol"},
\t\t{"g9-glm-5.3", "GLM-5.3"}, {"g9-glm-5.3-flash", "GLM-5.3-Flash"},
\t\t{"g3-deepseek-v4.1-flash", "deepseek-v4.1-flash"}, {"g3-deepseek-v4-pro", "deepseek-v4-pro"},
\t} {
\t\tentry := desktopEntry(model.id, r.modelGroupID)
\t\tentry.Model, entry.DisplayName, entry.ProviderLabel = "fixture-tool-model", model.name, "Aino"
\t\tentries = append(entries, entry)
\t}
\tr.catalog(t, entries, "${options.catalogWithDefault ? 'gpt-6-astra' : ''}")
\trequire.NoError(t, r.settingRepo.SetMultiple(r.ctx, map[string]string{"desktop.default_image_model_id": ""}))
`
    )
  }

  const consumerOriginalPath = path.join(overlayDirectory, 'consumer-original_test.go')
  const consumerPatchedPath = path.join(overlayDirectory, 'consumer-lease-only_test.go')
  fs.writeFileSync(consumerOriginalPath, consumerOriginal, { mode: 0o600 })
  fs.writeFileSync(consumerPatchedPath, consumerPatched, { mode: 0o600 })

  const overlayPath = path.join(overlayDirectory, 'overlay.json')
  fs.writeFileSync(
    overlayPath,
    JSON.stringify(
      {
        Replace: {
          ...(!nativeProtocol ? { [sourcePath]: patchedPath } : {}),
          [consumerSource]: consumerPatchedPath,
          [path.join(path.dirname(sourcePath), 'aino_overlay_read_tool_contract_test.go')]: contractPath
        }
      },
      null,
      2
    ),
    { mode: 0o600 }
  )

  const diffPath = path.join(overlayDirectory, 'fixture-only.diff')
  const consumerDiffPath = path.join(overlayDirectory, 'consumer-lease-only.diff')
  recordFixtureDiff(originalPath, patchedPath, diffPath, !nativeProtocol)
  recordFixtureDiff(consumerOriginalPath, consumerPatchedPath, consumerDiffPath, true)
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

  const receipt = {
    scope:
      'synthetic Go test provider and lease-only bootstrap projection; API production handlers, billing, operation guards and source checkout unchanged',
    api_source_sha: apiSha,
    protocol_mode: nativeProtocol ? 'native-tool-call-ids' : 'legacy-tool-call-id-overlay',
    source_replaced: !nativeProtocol,
    source_path: sourcePath,
    source_sha256: hash(original),
    patched_source_sha256: hash(patched),
    lease_only_consumer: {
      scope: 'temporary-lease account isolation; permanent device keys are covered separately',
      source_path: consumerSource,
      source_sha256: hash(consumerOriginal),
      patched_source_sha256: hash(consumerPatched),
      diff_path: consumerDiffPath
    },
    catalog_scenario: options.catalogWithDefault
      ? 'six-selectable-with-default'
      : options.selectableWithoutDefault
        ? 'six-selectable-without-default'
        : 'default',
    contract_sha256: hash(contract),
    overlay_path: overlayPath,
    diff_path: diffPath
  }

  const receiptPath = path.join(overlayDirectory, 'receipt.json')
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 })

  return { ...receipt, receipt_path: receiptPath }
}
