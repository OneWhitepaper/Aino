#!/usr/bin/env node
// Stage one digest-pinned historical portable app; never execute downloaded content here.
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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
const githubRepository = 'OneWhitepaper/Aino'
const githubRun = 43212669445
const githubArtifacts = {
  x64: { id: 13944292349, size: 2614689755, sha256: 'e700e23e1c1b866278dd80a2c0addecc9bf0633eb84970a318adee4ae30178ad' },
  arm64: { id: 13945078091, size: 1730269559, sha256: '0f51548ac47c3a1a1552f0ba4418dd0e53bd3113a970c2276779a401c4098343' },
}

async function downloadGithubArtifact(wrapper, arch, destination) {
  if (!process.env.GH_TOKEN) throw new Error('Private release staging requires the workflow GH_TOKEN')
  const api = async route => JSON.parse((await run('gh', ['api', '--hostname', 'github.com', `repos/${githubRepository}/${route}`],
    { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout)
  const [metadata, build] = await Promise.all([api(`actions/artifacts/${wrapper.id}`), api(`actions/runs/${githubRun}`)])
  const name = `aino-unverified-windows-${arch}-${commit}`
  if (metadata.id !== wrapper.id || metadata.name !== name || metadata.expired !== false
      || metadata.size_in_bytes !== wrapper.size || metadata.digest !== `sha256:${wrapper.sha256}`
      || metadata.workflow_run?.id !== githubRun || metadata.workflow_run?.head_sha !== commit
      || build.id !== githubRun || build.head_sha !== commit || build.status !== 'completed') {
    throw new Error('Historical GitHub artifact metadata differs from its fixed source and byte pins')
  }
  console.log(`[released-zip] ${new Date().toISOString()} GitHub artifact metadata verified: ${githubRepository} run ${githubRun}, artifact ${wrapper.id}`)
  // gh owns authenticated redirects; never copy the workflow token to blob URLs.
  const child = spawn('gh', ['api', '--hostname', 'github.com', `repos/${githubRepository}/actions/artifacts/${wrapper.id}/zip`],
    { windowsHide: true, timeout: 30 * 60_000, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = '', launchError
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(0, 8192) })
  const closed = new Promise(resolve => {
    child.once('error', error => { launchError = error })
    child.once('close', resolve)
  })
  const temporary = `${destination}.partial`
  const digest = createHash('sha256')
  let received = 0
  try {
    await pipeline(child.stdout, new Transform({ transform(chunk, encoding, done) {
      received += chunk.length
      if (received > wrapper.size) { done(new Error('GitHub artifact exceeds its pinned size')); return }
      digest.update(chunk)
      done(null, chunk)
    } }), createWriteStream(temporary, { flags: 'wx' }))
    const code = await closed
    if (launchError) throw launchError
    if (code !== 0) throw new Error(`GitHub artifact download failed (${code}): ${stderr.replace(/https?:\/\/[^\s"]+/g, value => value.split('?')[0]).trim()}`)
    if (received !== wrapper.size || digest.digest('hex') !== wrapper.sha256) throw new Error('GitHub artifact size or SHA-256 mismatch')
    await rename(temporary, destination)
    return { repository: githubRepository, runId: githubRun, sourceCommit: commit, id: wrapper.id, name, ...wrapper }
  } catch (error) {
    child.kill()
    await closed
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
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
export async function extractReleasedWindowsZip({ archive, size, sha256, wrapper, out, arch, python }) {
  const innerArchive = wrapper ? `${archive}.inner.zip` : archive
  try {
    let artifactWrapper
    if (wrapper) {
      artifactWrapper = await pythonHelper(python, ['unwrap', archive, innerArchive, `AinoBundled-0.1.5-win-${arch}.zip`,
        String(wrapper.size), wrapper.sha256, String(size), sha256])
      await rm(archive)
    }
    return { ...await pythonHelper(python, ['extract', innerArchive, out, arch, String(size)]), artifactWrapper, archiveRemoved: true }
  } finally {
    await rm(archive, { force: true })
    if (wrapper) {
      await rm(innerArchive, { force: true })
      await rm(`${innerArchive}.partial`, { force: true })
    }
  }
}

export async function stageReleasedWindowsZip({ arch, out, python }) {
  if (!Object.hasOwn(artifacts, arch)) throw new Error('Released Windows ZIP architecture must be x64 or arm64')
  if (!path.isAbsolute(out) || !python) throw new Error('An absolute --out and explicit --python are required')
  await mkdir(out, { recursive: true })
  if ((await readdir(out)).length) throw new Error('Released Windows ZIP output directory must be empty')
  const wrapper = process.env.AINO_PRIVATE_CANDIDATE === 'true' ? githubArtifacts[arch] : undefined
  const artifact = { ...artifacts[arch], url: wrapper
    ? `https://api.github.com/repos/${githubRepository}/actions/artifacts/${wrapper.id}/zip`
    : `https://petoi.cn/releases/tag/${release}/AinoBundled-0.1.5-win-${arch}.zip` }
  const archive = path.join(out, 'release.zip')
  try {
    const downloadSpace = await pythonHelper(python, ['space', out, String((wrapper?.size || 0) + artifact.size + reserve)])
    console.log(`[released-zip] ${new Date().toISOString()} download starting: ${release} ${arch}, ${artifact.size} bytes`)
    const githubArtifact = wrapper ? await downloadGithubArtifact(wrapper, arch, archive) : await downloadArtifact(artifact, archive)
    console.log(`[released-zip] ${new Date().toISOString()} download complete; SHA-256 verified`)
    console.log(`[released-zip] ${new Date().toISOString()} extraction and provenance checks starting`)
    const extracted = await extractReleasedWindowsZip({ archive, ...artifact, wrapper, out: path.join(out, 'extracted'), arch, python })
    console.log(`[released-zip] ${new Date().toISOString()} extraction complete; ${extracted.expandedSize} bytes verified, archive removed`)
    return { status: 'passed', release, version: '0.1.5', commit, arch, ...artifact,
      ...extracted, githubArtifact, downloadSpace }
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
