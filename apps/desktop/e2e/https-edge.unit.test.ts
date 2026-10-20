import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from 'vitest'

import { startGithubEdge, startHttpsEdge } from './update/github-edge'

test.skipIf(process.platform !== 'darwin')('isolated HTTPS edge preserves request bytes and TLS verification without module injection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-edge-'))
  const requests: string[] = []
  let edge: Awaited<ReturnType<typeof startHttpsEdge>> | undefined

  try {
    edge = await startHttpsEdge(root, { host: 'api.fixture.test', tunnelOthers: false,
      handler: (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', chunk => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          requests.push(`${req.method} ${req.url} ${Buffer.concat(chunks).toString()}`)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        })
      } })

    const { stdout } = await promisify(execFile)('/usr/bin/curl', ['--silent', '--show-error', '--fail',
      '--proxy', edge.proxyUrl, '--noproxy', '', '--cacert', edge.caBundle,
      '-H', 'content-type: application/json', '--data', '{"prompt":"你好"}',
      'https://api.fixture.test/v1/responses'], { timeout: 5000 })

    expect(JSON.parse(stdout)).toEqual({ ok: true })
    expect(requests).toEqual(['POST /v1/responses {"prompt":"你好"}'])
    await expect(promisify(execFile)('/usr/bin/curl', ['--silent', '--show-error', '--fail',
      '--proxy', edge.proxyUrl, '--noproxy', '', 'https://api.fixture.test/v1/responses'],
    { timeout: 5000 })).rejects.toMatchObject({ code: 60 })
    expect(requests).toHaveLength(1)

    const response = await new Promise<string>((resolve, reject) => {
      const proxy = new URL(edge!.proxyUrl)

      const socket = net.connect(Number(proxy.port), proxy.hostname, () => {
        socket.write('CONNECT unrelated.invalid:443 HTTP/1.1\r\nHost: unrelated.invalid:443\r\n\r\n')
      })

      socket.once('data', data => { resolve(data.toString()); socket.destroy() })
      socket.once('error', reject)
    })

    expect(response).toContain('403 Forbidden')
    expect(edge.deniedConnects).toEqual(['unrelated.invalid:443'])
  } finally {
    await edge?.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test.skipIf(process.platform !== 'darwin')('existing GitHub edge still serves the local repository tip over verified TLS', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-github-edge-'))
  const run = promisify(execFile)
  let edge: Awaited<ReturnType<typeof startGithubEdge>> | undefined

  try {
    await run('git', ['init', '--initial-branch=main', root])
    await run('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
      'commit', '--allow-empty', '-m', 'fixture'])
    const { stdout: expected } = await run('git', ['-C', root, 'rev-parse', 'HEAD'])
    edge = await startGithubEdge(root, root, undefined)

    const { stdout } = await run('/usr/bin/curl', ['--silent', '--show-error', '--fail',
      '--proxy', edge.proxyUrl, '--noproxy', '', '--cacert', edge.caBundle,
      'https://api.github.com/repos/fixture/repo/commits/main'], { timeout: 5000 })

    expect(JSON.parse(stdout)).toEqual({ sha: expected.trim() })
    expect(edge.apiHits).toEqual(['GET /repos/fixture/repo/commits/main'])
  } finally {
    await edge?.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
