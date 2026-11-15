import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

import { afterEach, expect, test } from 'vitest'

import { downloadArtifact } from '../tests/install/e2e-assets/bundle-inputs.mjs'

const cleanup = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()() })

async function fixture(handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bundle-ranges-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))

  return { directory, url: `http://127.0.0.1:${server.address().port}/artifact.zip` }
}

test('known-size downloads overlap ranges and retry only the interrupted range before publishing verified bytes', async () => {
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 67, 'a')
  bytes.fill('b', 8 * 1024 * 1024)
  const requests = new Map()
  const waiting = []
  let active = 0
  let maximum = 0
  const { directory, url } = await fixture((request, response) => {
    if (!request.headers.range) { response.end(bytes); return }

    const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range)
    const start = Number(first), end = Number(last)
    const count = (requests.get(request.headers.range) || 0) + 1
    requests.set(request.headers.range, count)
    maximum = Math.max(maximum, ++active)
    response.once('close', () => active--)
    const send = () => {
      response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${bytes.length}`,
        'content-length': end - start + 1 })

      if (end === bytes.length - 1 && count === 1) {
        const socket = response.socket
        response.write(bytes.subarray(start, start + 1), () => socket.destroy())

        return
      }

      response.end(bytes.subarray(start, end + 1))
    }

    if (requests.size < 2) { waiting.push(send) } else { send(); while (waiting.length) waiting.pop()() }
  })
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await downloadArtifact({ url, size: bytes.length, sha256 }, path.join(directory, 'artifact.zip'))
  expect(maximum).toBeGreaterThan(1)
  expect((await readFile(path.join(directory, 'artifact.zip'))).equals(bytes)).toBe(true)
  const ranges = [...requests].map(([range, count]) => ({ range: range.slice(6).split('-').map(Number), count }))
    .sort((a, b) => a.range[0] - b.range[0])
  expect(ranges[0].range[0]).toBe(0)
  expect(ranges.at(-1)).toMatchObject({ range: [expect.any(Number), bytes.length - 1], count: 2 })

  for (let index = 0; index < ranges.length - 1; index++) {
    expect(ranges[index].count).toBe(1)
    expect(ranges[index].range[1] + 1).toBe(ranges[index + 1].range[0])
  }

  expect(await readdir(directory)).toEqual(['artifact.zip'])
})

test('known-size downloads reject a bad digest, ignored or malformed ranges and invalid lengths without leaving partial files', async () => {
  const bytes = Buffer.from('a bounded package transport fixture')
  let mode
  let requests = 0
  const peerSize = 8 * 1024 * 1024 + bytes.length
  const { directory, url } = await fixture((request, response) => {
    requests++
    if (!request.headers.range || mode === 'ignored-range') { response.end(bytes); return }

    if (mode === 'peer-abort') {
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range)
      response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${Number(start) ? peerSize + 1 : peerSize}` })
      response.write(bytes)
      if (Number(start)) response.end()

      return
    }

    const body = mode === 'encoded-body' ? gzipSync(bytes) : bytes
    response.writeHead(206, {
      'content-range': `bytes 0-${bytes.length - 1}/${bytes.length + (mode === 'wrong-range' ? 1 : 0)}`,
      ...(mode === 'encoded-body' ? { 'content-encoding': 'gzip' } : {}),
      ...(['short-body', 'oversized-body'].includes(mode) ? {} : {
        'content-length': body.length + (mode === 'declared-length' ? 1 : 0)
      })
    })
    response.write(mode === 'short-body' ? body.subarray(1) : body)
    response.end(mode === 'oversized-body' ? Buffer.from('!') : undefined)
  })
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  for (const [failure, diagnostic] of [['digest', /SHA-256 mismatch/], ['ignored-range', /Range/],
    ['wrong-range', /Range/], ['declared-length', /length/], ['short-body', /length/], ['oversized-body', /length/],
    ['encoded-body', /Range/]]) {
    mode = failure
    requests = 0
    await expect(downloadArtifact({ url, size: bytes.length, sha256: mode === 'digest' ? 'f'.repeat(64) : sha256 },
      path.join(directory, 'artifact.zip'))).rejects.toThrow(diagnostic)
    expect(requests).toBe(1)
    expect(await readdir(directory)).toEqual([])
  }

  mode = 'peer-abort'
  await expect(downloadArtifact({ url, size: peerSize, sha256 }, path.join(directory, 'artifact.zip'))).rejects.toThrow('Range')
  expect(await readdir(directory)).toEqual([])
})
