/**
 * The GitHub edge for the Desktop update suite: a local stand-in for the two
 * api.github.com resources the source update check reads, answered from the
 * local bare origin, behind an HTTPS forward proxy the install is pointed at
 * (HTTPS_PROXY + a CA bundle that trusts this run's own root, i.e. a
 * TLS-inspecting corporate proxy).
 *
 *   GET /repos/<owner>/<repo>/commits/<branch>   (Accept: application/vnd.github.sha)
 *   GET /repos/<owner>/<repo>/compare/<base>...<head>
 *
 * Every other CONNECT target is tunnelled through unchanged and recorded, so a
 * failing cell can list every host the product reached.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as path from 'node:path'
import * as tls from 'node:tls'

export interface GithubEdge {
  proxyUrl: string
  caBundle: string
  /** host:port of every CONNECT the proxy saw, in order. */
  connects: string[]
  deniedConnects: string[]
  /** method + path of every request the fake api.github.com answered. */
  apiHits: string[]
  env: Record<string, string>
  close: () => Promise<void>
}

function openssl(args: string[], cwd: string): void {
  execFileSync('openssl', args, { cwd, stdio: 'pipe' })
}

/** A throwaway root + an api.github.com leaf signed by it. */
function makeCerts(dir: string, host: string): { key: Buffer; cert: Buffer; caPem: string } {
  fs.mkdirSync(dir, { recursive: true })
  // Build the CA and leaf with explicit extension sections. Passing -addext to
  // `req -x509` can merge with a runner's openssl.cnf and emit duplicate X.509
  // extensions; newer OpenSSL accepts that, while the macOS Intel runner's
  // Node TLS stack rejects the resulting chain as UNABLE_TO_VERIFY_LEAF.
  fs.writeFileSync(
    path.join(dir, 'ca.ext'),
    '[ca_ext]\n' +
      'basicConstraints=critical,CA:TRUE,pathlen:1\n' +
      'keyUsage=critical,keyCertSign,cRLSign\n' +
      'subjectKeyIdentifier=hash\n'
  )
  openssl(
    [
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      'ca.key',
      '-out',
      'ca.csr',
      '-subj',
      '/CN=hermes-update-e2e-root'
    ],
    dir
  )
  openssl(
    [
      'x509',
      '-req',
      '-in',
      'ca.csr',
      '-signkey',
      'ca.key',
      '-out',
      'ca.pem',
      '-days',
      '2',
      '-extfile',
      'ca.ext',
      '-extensions',
      'ca_ext'
    ],
    dir
  )
  openssl(
    ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', `/CN=${host}`],
    dir
  )
  fs.writeFileSync(
    path.join(dir, 'leaf.ext'),
    '[server_ext]\n' +
      'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' +
      `subjectAltName=DNS:${host}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n`
  )
  openssl(
    [
      'x509',
      '-req',
      '-in',
      'leaf.csr',
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      'leaf.pem',
      '-days',
      '2',
      '-extfile',
      'leaf.ext',
      '-extensions',
      'server_ext'
    ],
    dir
  )

  return {
    key: fs.readFileSync(path.join(dir, 'leaf.key')),
    cert: fs.readFileSync(path.join(dir, 'leaf.pem')),
    caPem: fs.readFileSync(path.join(dir, 'ca.pem'), 'utf8')
  }
}

function gitIn(repo: string, args: string[]): { ok: boolean; out: string } {
  const cp = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } })

  return { ok: cp.status === 0, out: (cp.stdout ?? '').trim() }
}

/** The GitHub REST shapes the check reads, computed from the bare origin at request time. */
function apiHandler(origin: string) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'https://api.github.com')

    const send = (status: number, body: string, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type })
      res.end(body)
    }

    const commit = /^\/repos\/[^/]+\/[^/]+\/commits\/(.+)$/.exec(url.pathname)

    if (commit) {
      const tip = gitIn(origin, ['rev-parse', '--verify', `refs/heads/${decodeURIComponent(commit[1])}^{commit}`])

      if (!tip.ok) {
        return send(404, JSON.stringify({ message: 'No commit found for SHA' }))
      }

      return /vnd\.github\.sha/.test(String(req.headers.accept))
        ? send(200, tip.out, 'application/vnd.github.sha')
        : send(200, JSON.stringify({ sha: tip.out }))
    }

    const compare = /^\/repos\/[^/]+\/[^/]+\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(url.pathname)

    if (compare) {
      const [, base, head] = compare
      const log = gitIn(origin, ['log', '--reverse', '--format=%H%x1f%an%x1f%cI%x1f%s', `${base}..${head}`])

      if (!log.ok) {
        return send(404, JSON.stringify({ message: 'Not Found' }))
      }

      const behind = gitIn(origin, ['rev-list', '--count', `${head}..${base}`])

      const commits = log.out
        ? log.out.split('\n').map(line => {
            const [sha, author, date, message] = line.split('\x1f')

            return { sha, commit: { message, author: { name: author, date }, committer: { name: author, date } } }
          })
        : []

      return send(
        200,
        JSON.stringify({
          status: commits.length ? 'ahead' : 'identical',
          ahead_by: commits.length,
          behind_by: Number(behind.out || 0),
          total_commits: commits.length,
          commits
        })
      )
    }

    send(404, JSON.stringify({ message: 'Not Found' }))
  }
}

export async function startGithubEdge(
  workDir: string,
  origin: string,
  baseCaBundle: string | undefined
): Promise<GithubEdge> {
  return startHttpsEdge(workDir, { host: 'api.github.com', handler: apiHandler(origin), baseCaBundle, tunnelOthers: true })
}

export interface HttpsEdgeOptions {
  host: string
  handler: http.RequestListener
  baseCaBundle?: string
  tunnelOthers: boolean
}

/** Reuses the update suite's TLS transport without injecting code into the installed runtime. */
export async function startHttpsEdge(workDir: string, options: HttpsEdgeOptions): Promise<GithubEdge> {
  if (!/^[a-zA-Z0-9.-]+$/.test(options.host)) {throw new Error('Invalid TLS fixture hostname')}
  const { key, cert, caPem } = makeCerts(path.join(workDir, 'edge-ca'), options.host)
  const caBundle = path.join(workDir, 'edge-ca', 'bundle.pem')
  const systemBundle = [options.baseCaBundle, '/etc/ssl/certs/ca-certificates.crt'].find(p => p && fs.existsSync(p))
  fs.writeFileSync(caBundle, `${systemBundle ? fs.readFileSync(systemBundle, 'utf8') : ''}\n${caPem}`)

  const connects: string[] = []
  const apiHits: string[] = []
  const deniedConnects: string[] = []

  const api = http.createServer((req, res) => {
    apiHits.push(`${req.method} ${new URL(req.url ?? '/', `https://${options.host}`).pathname}`)
    options.handler(req, res)
  })

  const sockets = new Set<net.Socket>()

  const proxy = http.createServer((_req, res) => {
    res.writeHead(405)
    res.end('CONNECT only')
  })

  proxy.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  proxy.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    const target = req.url ?? ''
    connects.push(target)
    const [host, portText] = target.split(':')
    const port = Number(portText || 443)
    client.on('error', () => undefined)

    if (host === options.host && port === 443) {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')

      if (head.length) {
        client.unshift(head)
      }

      const secure = new tls.TLSSocket(client, { isServer: true, key, cert })
      secure.on('error', () => undefined)
      api.emit('connection', secure)

      return
    }

    if (!options.tunnelOthers) {
      deniedConnects.push(target)
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')

      return
    }

    const upstream = net.connect(port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')

      if (head.length) {
        upstream.write(head)
      }

      upstream.pipe(client)
      client.pipe(upstream)
    })

    sockets.add(upstream)
    upstream.on('close', () => sockets.delete(upstream))
    upstream.on('error', () => client.destroy())
  })

  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`

  return {
    proxyUrl,
    caBundle,
    connects,
    deniedConnects,
    apiHits,
    env: {
      HTTPS_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
      SSL_CERT_FILE: caBundle
    },
    close: async () => {
      for (const socket of sockets) {
        socket.destroy()
      }

      await new Promise<void>(resolve => proxy.close(() => resolve()))
      api.close()
    }
  }
}
