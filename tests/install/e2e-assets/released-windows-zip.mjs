#!/usr/bin/env node
// Stage one digest-pinned historical portable app; never execute downloaded content here.
import { execFile } from 'node:child_process'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify, parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { downloadArtifact } from './bundle-inputs.mjs'

const run = promisify(execFile)
const helper = fileURLToPath(new URL('./safe-windows-zip.py', import.meta.url))
const release = 'v0.1.5'
const commit = '22a472fcbca8775f56c0f89374027b8e4c68ab5b'
const reserve = 256 * 1024 * 1024
const artifacts = {
  x64: { size: 2614689583, sha256: 'c78bd2a70b8091ce47259b7b3767b6394283ddf575973416af462c2786a48a11' },
  arm64: { size: 1730269383, sha256: 'aa17070fe929cac074385eae3945a6e88ed3c0125546fdda10cbaef6328daccc' },
}

async function pythonHelper(python, args) {
  try {
    const { stdout } = await run(python, [helper, ...args], { windowsHide: true, timeout: 20 * 60_000, maxBuffer: 1024 * 1024 })
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message)
  }
}

/** Safe archive admission is separate from transport, so fixture ZIPs exercise the real extractor. */
export async function extractReleasedWindowsZip({ archive, size, out, arch, python }) {
  try {
    return { ...await pythonHelper(python, ['extract', archive, out, arch, String(size)]), archiveRemoved: true }
  } finally {
    await rm(archive, { force: true })
  }
}

export async function stageReleasedWindowsZip({ arch, out, python }) {
  if (!Object.hasOwn(artifacts, arch)) throw new Error('Released Windows ZIP architecture must be x64 or arm64')
  if (!path.isAbsolute(out) || !python) throw new Error('An absolute --out and explicit --python are required')
  await mkdir(out, { recursive: true })
  if ((await readdir(out)).length) throw new Error('Released Windows ZIP output directory must be empty')
  const artifact = { ...artifacts[arch], url: `https://petoi.cn/releases/tag/${release}/AinoBundled-0.1.5-win-${arch}.zip` }
  const archive = path.join(out, 'release.zip')
  try {
    const downloadSpace = await pythonHelper(python, ['space', out, String(artifact.size + reserve)])
    console.log(`[released-zip] ${new Date().toISOString()} download starting: ${release} ${arch}, ${artifact.size} bytes`)
    await downloadArtifact(artifact, archive)
    console.log(`[released-zip] ${new Date().toISOString()} download complete; SHA-256 verified`)
    console.log(`[released-zip] ${new Date().toISOString()} extraction and provenance checks starting`)
    const extracted = await extractReleasedWindowsZip({ archive, size: artifact.size, out: path.join(out, 'extracted'), arch, python })
    console.log(`[released-zip] ${new Date().toISOString()} extraction complete; ${extracted.expandedSize} bytes verified, archive removed`)
    return { status: 'passed', release, version: '0.1.5', commit, arch, ...artifact,
      ...extracted, downloadSpace }
  } finally {
    await rm(archive, { force: true })
    await rm(`${archive}.partial`, { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: Object.fromEntries(
    ['arch', 'out', 'python', 'report'].map(key => [key, { type: 'string' }])) })
  let receipt
  try {
    if (!values.report || !path.isAbsolute(values.report)) throw new Error('An absolute --report is required')
    receipt = await stageReleasedWindowsZip(values)
  } catch (error) {
    receipt = { status: 'failed', release, commit, arch: values.arch, error: error.message }
    console.error(error.message)
    process.exitCode = 1
  }
  if (values.report) await writeFile(values.report, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
}
