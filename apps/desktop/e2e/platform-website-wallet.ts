import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { type BrowserContext, chromium, expect, type Page } from '@playwright/test'

import type { NativeManifest, NativeState } from './platform-real-api'

interface WebsitePlatformAPI {
  info: Pick<NativeManifest, 'origin' | 'phone'>
  control<T>(endpoint: string, body?: string): Promise<T>
}

export interface WebsiteWalletResult {
  accountId: string
  balance: string
  fixtureDecorationSubstitutions: number
  transport: WebsiteTransportAudit
}

export interface WebsiteHTTPRejection {
  host: string
  method: string
  protocol: string
  resourceType: string
}

export interface WebsiteWebSocketRejection {
  host: string
  protocol: string
}

export interface WebsiteTransportAudit {
  rejectedHTTP: WebsiteHTTPRejection[]
  rejectedHTTPCount: number
  rejectedWebSockets: WebsiteWebSocketRejection[]
  rejectedWebSocketCount: number
}

export interface WebsiteWalletOptions {
  api: WebsitePlatformAPI
  frontendDist: string
  previousCodeAt: number
  screenshotPath: string
  timeoutMs?: number
}

interface WebsiteServer {
  close(): Promise<void>
  decorationSubstitutions(): number
  origin: string
}

// The real login layout hardcodes this aria-hidden artwork; site settings do
// not control it. Only fixture-served JS substitutes the bundled local SVG.
const LOGIN_ARTWORK_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_125039_45a71f04-36dd-4620-99d8-7526316d439e.png'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

function requireLoopbackHTTPOrigin(value: string, label: string): URL {
  const origin = new URL(value)

  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port) {
    throw new Error(`${label} must be an explicit random 127.0.0.1 HTTP origin`)
  }

  return origin
}

function copyProxyHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name !== 'host' && !HOP_BY_HOP_HEADERS.has(name.toLowerCase()))
  )
}

function writeStaticFile(request: http.IncomingMessage, response: http.ServerResponse, filename: string, body?: Buffer): void {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': body?.byteLength ?? fs.statSync(filename).size,
    'Content-Type': MIME_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff'
  })

  if (request.method === 'HEAD') {
    response.end()

    return
  }

  if (body) {
    response.end(body)
  } else {
    fs.createReadStream(filename).pipe(response)
  }
}

async function startWebsiteServer(frontendDist: string, apiOriginValue: string): Promise<WebsiteServer> {
  const apiOrigin = requireLoopbackHTTPOrigin(apiOriginValue, 'API fixture')
  const resolvedDist = path.resolve(frontendDist)
  const indexPath = path.join(resolvedDist, 'index.html')
  let decorationSubstitutions = 0

  if (
    !fs.statSync(resolvedDist, { throwIfNoEntry: false })?.isDirectory() ||
    !fs.statSync(indexPath, { throwIfNoEntry: false })?.isFile()
  ) {
    throw new Error(`Built Aino-API frontend is missing from ${resolvedDist}`)
  }

  const server = http.createServer(async (request, response) => {
    try {
      const requestURL = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (requestURL.pathname.startsWith('/api/') || requestURL.pathname.startsWith('/v1/')) {
        const target = new URL(`${requestURL.pathname}${requestURL.search}`, apiOrigin)

        const upstream = http.request(
          target,
          {
            method: request.method,
            headers: copyProxyHeaders(request.headers),
            signal: AbortSignal.timeout(30_000)
          },
          upstreamResponse => {
            const headers = Object.fromEntries(
              Object.entries(upstreamResponse.headers).filter(([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase()))
            )

            response.writeHead(upstreamResponse.statusCode ?? 502, headers)
            upstreamResponse.pipe(response)
          }
        )

        upstream.once('error', () => {
          if (!response.headersSent) {
            response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
          }

          response.end('Loopback API proxy failed')
        })
        await pipeline(request, upstream)

        return
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' })
        response.end()

        return
      }

      let decodedPath: string

      try {
        decodedPath = decodeURIComponent(requestURL.pathname)
      } catch {
        response.writeHead(400)
        response.end()

        return
      }

      const requestedPath = path.resolve(resolvedDist, `.${decodedPath}`)
      const insideDist = requestedPath === resolvedDist || requestedPath.startsWith(`${resolvedDist}${path.sep}`)

      const requestedFile =
        insideDist && fs.statSync(requestedPath, { throwIfNoEntry: false })?.isFile() ? requestedPath : indexPath

      let body: Buffer | undefined

      if (/^AinoLoginLayout-[\w-]+\.js$/.test(path.basename(requestedFile))) {
        const script = fs.readFileSync(requestedFile, 'utf8')

        if (script.includes(LOGIN_ARTWORK_URL)) {
          if (!fs.statSync(path.join(resolvedDist, 'logo.svg'), { throwIfNoEntry: false })?.isFile()) {
            throw new Error('Website fixture requires the bundled local logo.svg for login artwork')
          }

          decorationSubstitutions += script.split(LOGIN_ARTWORK_URL).length - 1
          body = Buffer.from(script.replaceAll(LOGIN_ARTWORK_URL, '/logo.svg'))
        }
      }

      writeStaticFile(request, response, requestedFile, body)
    } catch {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      }

      response.end('Website fixture failed')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()

  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Website fixture did not bind a loopback TCP port')
  }

  const origin = `http://127.0.0.1:${address.port}`
  requireLoopbackHTTPOrigin(origin, 'Website fixture')

  return {
    origin,
    decorationSubstitutions: () => decorationSubstitutions,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
  }
}

function safeTransportTarget(value: string): { host: string; protocol: string } {
  try {
    const target = new URL(value)

    return { host: target.hostname, protocol: target.protocol }
  } catch {
    return { host: '<invalid>', protocol: '<invalid>' }
  }
}

async function installTransportGuard(context: BrowserContext, websiteOrigin: string): Promise<WebsiteTransportAudit> {
  const audit: WebsiteTransportAudit = {
    rejectedHTTP: [],
    rejectedHTTPCount: 0,
    rejectedWebSockets: [],
    rejectedWebSocketCount: 0
  }

  await context.route('**/*', async route => {
    const requestURL = new URL(route.request().url())

    if (requestURL.protocol === 'http:' && requestURL.origin === websiteOrigin) {
      await route.continue()

      return
    }

    audit.rejectedHTTP.push({
      ...safeTransportTarget(route.request().url()),
      method: route.request().method(),
      resourceType: route.request().resourceType()
    })
    audit.rejectedHTTPCount += 1
    await route.abort('blockedbyclient')
  })

  await context.routeWebSocket(/.*/, async websocket => {
    audit.rejectedWebSockets.push(safeTransportTarget(websocket.url()))
    audit.rejectedWebSocketCount += 1
    await websocket.close({ code: 1008, reason: 'Website fixture forbids WebSockets' })
  })

  return audit
}

function assertNoRejectedTransport(audit: WebsiteTransportAudit): void {
  if (audit.rejectedHTTPCount === 0 && audit.rejectedWebSocketCount === 0) {
    return
  }

  throw new Error(`Website attempted forbidden transport: ${JSON.stringify(audit)}`)
}

async function requestFreshWebsiteCode(page: Page, deadline: number): Promise<void> {
  const send = page.getByTestId('phone-login-send')
  const delivery = page.getByTestId('phone-login-delivery')

  for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt += 1) {
    await send.click({ timeout: Math.max(1, deadline - Date.now()) })

    const delivered = await delivery
      .waitFor({ state: 'visible', timeout: Math.min(5_000, Math.max(1, deadline - Date.now())) })
      .then(
        () => true,
        () => false
      )

    if (delivered) {
      return
    }

    await send.waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) })

    while (!(await send.isEnabled()) && Date.now() < deadline) {
      await page.waitForTimeout(Math.min(500, Math.max(1, deadline - Date.now())))
    }
  }

  throw new Error('Website phone challenge was not issued before the bounded deadline')
}

function displayedBalance(value: string): string {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`Fixture returned an invalid balance: ${value}`)
  }

  return number.toFixed(2)
}

function failureScreenshotPath(screenshotPath: string): string {
  const extension = path.extname(screenshotPath) || '.png'

  return path.join(
    path.dirname(screenshotPath),
    `${path.basename(screenshotPath, path.extname(screenshotPath))}-failure${extension}`
  )
}

export async function verifyWebsiteWallet(options: WebsiteWalletOptions): Promise<WebsiteWalletResult> {
  const timeoutMs = options.timeoutMs ?? 90_000
  const deadline = Date.now() + timeoutMs
  const server = await startWebsiteServer(options.frontendDist, options.api.info.origin)
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null
  let primaryError: unknown
  let result: WebsiteWalletResult | undefined
  const cleanupErrors: unknown[] = []

  try {
    const managedChromium = chromium.executablePath()

    browser = await chromium.launch({
      headless: true,
      ...(fs.existsSync(managedChromium) ? {} : { channel: 'chrome' }),
      args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run'
      ]
    })
    context = await browser.newContext({ serviceWorkers: 'block' })
    const transport = await installTransportGuard(context, server.origin)
    page = await context.newPage()

    page.setDefaultTimeout(Math.min(15_000, timeoutMs))
    page.setDefaultNavigationTimeout(Math.min(30_000, timeoutMs))
    await page.goto(`${server.origin}/login?redirect=%2Fprofile`, { waitUntil: 'domcontentloaded' })
    await page
      .getByTestId('phone-login-phone')
      .waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) })
    await page.getByTestId('phone-login-phone').fill(options.api.info.phone)
    const cooldownRemaining = 61_000 - (Date.now() - options.previousCodeAt)

    if (cooldownRemaining > 0) {
      await page.waitForTimeout(Math.min(cooldownRemaining, Math.max(1, deadline - Date.now())))
    }

    await requestFreshWebsiteCode(page, deadline)
    const code = await options.api.control<{ code: string }>('code')

    if (!/^\d{6}$/.test(code.code)) {
      throw new Error('Website fixture did not receive a real six-digit OTP')
    }

    await page.getByTestId('phone-login-code').fill(code.code)

    const [profileResponse] = await Promise.all([
      page.waitForResponse(
        response => {
          const responseURL = new URL(response.url())

          return (
            responseURL.origin === server.origin &&
            responseURL.pathname === '/api/v1/auth/me' &&
            response.request().method() === 'GET'
          )
        },
        { timeout: Math.max(1, deadline - Date.now()) }
      ),
      (async () => {
        await page!.getByTestId('phone-login-submit').click()
        await page!.waitForURL(url => url.pathname === '/profile', { timeout: Math.max(1, deadline - Date.now()) })
      })()
    ])

    if (profileResponse.status() !== 200) {
      throw new Error(`Website profile refresh failed: HTTP ${profileResponse.status()}`)
    }

    const state = await options.api.control<NativeState>('state')
    const expectedBalance = displayedBalance(state.balance)
    const balanceCard = page.getByTestId('profile-overview-metric-balance')
    const balanceValue = balanceCard.locator('p').nth(1)

    await balanceCard.waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) })
    await expect(balanceValue).toHaveText(`$${expectedBalance}`, { timeout: Math.max(1, deadline - Date.now()) })
    const balanceText = (await balanceValue.innerText()).trim()
    const balanceMatch = /^\$(-?\d+\.\d{2})$/.exec(balanceText)

    if (!balanceMatch) {
      throw new Error(`Website rendered an unrecognized wallet balance: ${balanceText}`)
    }

    const accountId = await page.evaluate(() => {
      const raw = localStorage.getItem('auth_user')

      if (!raw) {
        return ''
      }

      const value = JSON.parse(raw) as { id?: unknown }

      return typeof value.id === 'number' || typeof value.id === 'string' ? String(value.id) : ''
    })

    if (!accountId || accountId !== String(state.user_id)) {
      throw new Error('Website authenticated account does not match the desktop fixture account')
    }

    if (balanceMatch[1] !== expectedBalance) {
      throw new Error(
        `Website wallet balance ${balanceMatch[1]} does not match fixture display balance ${expectedBalance}`
      )
    }

    await page.screenshot({ path: options.screenshotPath, fullPage: true })
    await page.waitForTimeout(250)
    assertNoRejectedTransport(transport)
    result = {
      accountId,
      balance: balanceMatch[1],
      fixtureDecorationSubstitutions: server.decorationSubstitutions(),
      transport: {
        rejectedHTTP: transport.rejectedHTTP.map(rejection => ({ ...rejection })),
        rejectedHTTPCount: transport.rejectedHTTPCount,
        rejectedWebSockets: transport.rejectedWebSockets.map(rejection => ({ ...rejection })),
        rejectedWebSocketCount: transport.rejectedWebSocketCount
      }
    }
  } catch (error) {
    primaryError = error

    try {
      await page?.screenshot({ path: failureScreenshotPath(options.screenshotPath), fullPage: true })
    } catch (screenshotError) {
      cleanupErrors.push(screenshotError)
    }
  } finally {
    try {
      await context?.close()
    } catch (error) {
      cleanupErrors.push(error)
    }

    try {
      await browser?.close()
    } catch (error) {
      cleanupErrors.push(error)
    }

    try {
      await server.close()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (primaryError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'Website wallet verification failed and cleanup did not complete'
    )
  }

  if (primaryError !== undefined) {
    throw primaryError
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Website wallet verification cleanup failed')
  }

  if (!result) {
    throw new Error('Website wallet verification did not produce a result')
  }

  return result
}
