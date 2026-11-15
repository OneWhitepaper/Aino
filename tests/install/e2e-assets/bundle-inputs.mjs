#!/usr/bin/env node
// Pin real release packages before a destructive update leg starts.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { FORMATS, SHA256, artifactUrl, validateBundleInputs } from './bundle-manifest.cjs'

// A reset connection mid-body (ECONNRESET from the CDN) surfaces as `TypeError: terminated`
// and fails the whole acceptance leg for a network blip. A wrong digest or an HTTP error
// answer is a real defect and is never retried.
const TRANSIENT = Symbol('transient')

async function withRetries(attempt, tries = 3) {
  for (let n = 1; ; n++) {
    try {
      return await attempt()
    } catch (error) {
      if (!error?.[TRANSIENT] || n >= tries) throw error
      console.error(`transient network failure (attempt ${n} of ${tries}): ${error.cause?.code ?? error.message}`)
    }
  }
}

async function transient(work) {
  try {
    return await work()
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'TimeoutError') error[TRANSIENT] = true
    throw error
  }
}

async function downloadRange(url, temporary, start, end, size, signal) {
  await transient(async () => {
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(2 * 60_000)])
    })
    if (response.status !== 206 || !response.body || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`
        || (response.headers.get('content-encoding') || 'identity').toLowerCase() !== 'identity') {
      await response.body?.cancel()
      throw new Error(`Range response HTTP ${response.status} does not match the requested identity bytes`)
    }
    const length = end - start + 1
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== length)) {
      await response.body.cancel()
      throw new Error('Range Content-Length does not match its length')
    }
    let received = 0
    await pipeline(Readable.fromWeb(response.body), new Transform({
      transform(chunk, encoding, done) {
        received += chunk.length
        if (received > length) done(new Error('Range body exceeds its length'))
        else done(null, chunk)
      }
    }), createWriteStream(temporary, { flags: 'r+', start }), { signal })
    if (received !== length) throw new Error('Range body does not match its length')
  })
}

async function downloadRanges(artifact, url, destination) {
  const temporary = `${destination}.partial`
  // One bounded file fits the caller's size-based disk admission. Completed
  // ranges survive only this call's transport retries, never a later invocation.
  await writeFile(temporary, '', { flag: 'wx' })
  try {
    const rangeSize = 8 * 1024 * 1024
    const count = Math.ceil(artifact.size / rangeSize)
    const controller = new AbortController()
    let next = 0
    const workers = Array.from({ length: Math.min(8, count) }, async () => {
      while (next < count && !controller.signal.aborted) {
        const start = next++ * rangeSize
        const end = Math.min(start + rangeSize, artifact.size) - 1
        await withRetries(() => downloadRange(url, temporary, start, end, artifact.size, controller.signal))
      }
    })
    try {
      await Promise.all(workers)
    } catch (error) {
      controller.abort()
      await Promise.allSettled(workers)
      throw error
    }
    if ((await stat(temporary)).size !== artifact.size) throw new Error('Package size mismatch')
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(temporary)) digest.update(chunk)
    if (digest.digest('hex') !== artifact.sha256) throw new Error('Package SHA-256 mismatch')
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function downloadArtifact(artifact, destination) {
  const url = artifactUrl(artifact.url)
  if (artifact.size !== undefined) {
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) throw new Error('Package size must be a positive safe integer')
    return downloadRanges(artifact, url, destination)
  }
  await withRetries(async () => {
    const digest = createHash('sha256')
    const temporary = `${destination}.partial`
    try {
      await transient(async () => {
        const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
        if (!response.ok || !response.body) throw new Error(`Package download returned HTTP ${response.status}`)
        await pipeline(Readable.fromWeb(response.body), new Transform({
          transform(chunk, encoding, done) { digest.update(chunk); done(null, chunk) }
        }), createWriteStream(temporary, { flags: 'wx' }))
      })
      if (digest.digest('hex') !== artifact.sha256) throw new Error('Package SHA-256 mismatch')
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  })
}

export async function stageBundleInputs({ manifestUrl, platform, arch, out, expectedCommit, manifestSha256 }) {
  const text = await withRetries(() => transient(async () => {
    const response = await fetch(artifactUrl(manifestUrl), { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`Manifest download returned HTTP ${response.status}`)
    return response.text()
  }))
  if (text.length > 1024 * 1024) throw new Error('Bundle input manifest is too large')
  if (manifestSha256 && (!SHA256.test(manifestSha256) || createHash('sha256').update(text).digest('hex') !== manifestSha256)) {
    throw new Error('Transition manifest SHA-256 mismatch')
  }
  const manifest = validateBundleInputs(JSON.parse(text), platform, arch)
  if (expectedCommit && manifest.new.commit !== expectedCommit) {
    throw new Error('Candidate commit must equal the tested workflow SHA')
  }
  await mkdir(out, { recursive: true })
  const staged = { ...manifest }
  for (const slot of ['old', 'new']) {
    const destination = path.resolve(out, `${slot}${FORMATS[platform]}`)
    await downloadArtifact(manifest[slot].artifact, destination)
    staged[slot] = { ...manifest[slot], artifact: { ...manifest[slot].artifact, path: destination } }
  }
  const filename = path.resolve(out, 'bundle-inputs.json')
  await writeFile(filename, JSON.stringify(staged, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  return filename
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    'manifest-url': { type: 'string' }, platform: { type: 'string' },
    arch: { type: 'string' }, out: { type: 'string' }
  } })
  if (!values['manifest-url'] || !values.platform || !values.arch || !values.out) {
    throw new Error('--manifest-url, --platform, --arch and --out are required')
  }
  console.log(await stageBundleInputs({ manifestUrl: values['manifest-url'], platform: values.platform, arch: values.arch, out: values.out,
    expectedCommit: process.env.GITHUB_ACTIONS === 'true' ? (process.env.HERMES_TESTED_COMMIT || process.env.GITHUB_SHA) : undefined,
    manifestSha256: process.env.BUNDLE_MANIFEST_SHA256 || undefined }))
}
