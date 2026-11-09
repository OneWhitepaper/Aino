import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type SessionView, SessionViewProvider } from '@/app/chat/session-view'
import { McpSetupOffer, McpSetupPending, McpSetupTool } from '@/components/assistant-ui/mcp-setup-tool'
import { I18nProvider } from '@/i18n'
import {
  $connectionRequests,
  type ConnectionRequest,
  type ConnectionTarget,
  setConnectionRequest
} from '@/store/connection-request'
import { $gateway, setPrimaryGateway, setPrimaryGatewayConnectionId } from '@/store/gateway'
import { setSessionOwnerHint } from '@/store/session'

const SESSION_ID = 'session-1'

const LINEAR: ConnectionTarget = {
  action: 'install',
  connectUrl: null,
  connectionId: '',
  detail: '',
  discoveryError: null,
  instructions: null,
  kind: 'mcp',
  name: 'linear',
  requiredEnv: [],
  state: 'pending',
  tools: []
}

const REQUEST: ConnectionRequest = {
  deadlineAt: 1_800_000_000,
  opId: 'operation-1',
  seq: 0,
  toolCallId: 'mcp-call-1',
  sessionId: SESSION_ID,
  settled: false,
  settledBy: null,
  targets: [LINEAR, { ...LINEAR, name: 'postgres' }]
}

const ARGS = {
  action: 'install',
  connectors: [
    { mcp: true, name: 'linear' },
    { mcp: true, name: 'postgres' }
  ]
}

function props(result?: ToolCallMessagePartProps['result']): ToolCallMessagePartProps {
  return {
    addResult: vi.fn(),
    args: ARGS,
    argsText: JSON.stringify(ARGS),
    isError: false,
    respondToApproval: vi.fn(),
    result,
    resume: vi.fn(),
    status: result === undefined ? { type: 'running' } : { type: 'complete' },
    toolCallId: 'mcp-call-1',
    toolName: 'manage_connections',
    type: 'tool-call'
  }
}

function view(sessionId: string): SessionView {
  return {
    $awaitingResponse: atom(false),
    $busy: atom(false),
    $cwd: atom(''),
    $fast: atom(false),
    $lastVisibleIsUser: atom(false),
    $messages: atom([]),
    $messagesEmpty: atom(false),
    $model: atom(''),
    $provider: atom(''),
    $reasoningEffort: atom(''),
    $reasoningEffortPending: atom(false),
    $reasoningEffortWire: atom(''),
    $runtimeId: atom(sessionId),
    $storedId: atom(sessionId),
    $turnStartedAt: atom(null),
    kind: 'primary'
  }
}

// The live gate (message still running) is assistant-ui state; the pending card renders below it.
function renderTool(result?: ToolCallMessagePartProps['result']) {
  const Card = result === undefined ? McpSetupPending : McpSetupTool

  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <SessionViewProvider value={view(SESSION_ID)}>
        <Card {...props(result)} />
      </SessionViewProvider>
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  $connectionRequests.set({})
  $gateway.set(null)
  setPrimaryGateway(null)
  vi.clearAllMocks()
})

describe('the MCP setup card', () => {
  it('shows the exact custom HTTP endpoint and authorization before approval, then opens only the offered OAuth link', async () => {
    const rpc = vi.fn().mockResolvedValue({ status: 'ok', settled: false })
    const openExternal = vi.fn()
    // SAFETY: the approval flow uses only request and the explicit browser action.
    setPrimaryGateway({ request: rpc } as never)
    window.hermesDesktop = { openExternal } as never

    const target = {
      ...LINEAR,
      mcpConfig: { url: 'https://mcp.example.test/my-tools', auth: 'oauth' as const }
    }

    const request = { ...REQUEST, targets: [target] }
    setConnectionRequest(request)

    const card = (current: ConnectionRequest) => (
      <I18nProvider configClient={null} initialLocale="zh">
        <McpSetupOffer action="install" owner={{ connectionId: null, profile: 'default' }} request={current} />
      </I18nProvider>
    )

    const { rerender } = render(card(request))

    expect(screen.getByText('https://mcp.example.test/my-tools')).toBeTruthy()
    expect(screen.getByText('OAuth')).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '安装' }))
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('connection.respond', {
        op_id: 'operation-1',
        owner: { session_id: SESSION_ID, type: 'session' },
        result: { targets: [{ name: 'linear', status: 'approved' }] }
      })
    )
    expect(openExternal).not.toHaveBeenCalled()

    const initiated = {
      ...request,
      seq: 1,
      targets: [{ ...target, state: 'initiated' as const, connectUrl: 'https://oauth.example.test/authorize' }]
    }

    rerender(card(initiated))
    expect(screen.getAllByText('正在等待浏览器…')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '在浏览器中打开' }))
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://oauth.example.test/authorize')

    rerender(
      card({
        ...initiated,
        seq: 2,
        settled: true,
        targets: [{ ...target, state: 'connected', tools: ['mcp_linear_search'] }]
      })
    )
    expect(screen.getByText('已安装 Linear · 1 个工具')).toBeTruthy()
  })

  it('shows the exact local command and argument boundaries before the user permits a process to run', () => {
    const target = {
      ...LINEAR,
      mcpConfig: { command: 'npx', args: ['-y', '@example/server', '/a folder/documents'] }
    }

    render(
      <I18nProvider configClient={null} initialLocale="en">
        <McpSetupOffer action="install" owner={null} request={{ ...REQUEST, targets: [target] }} />
      </I18nProvider>
    )

    expect(screen.getByText('npx')).toBeTruthy()
    expect(screen.getByText('["-y","@example/server","/a folder/documents"]')).toBeTruthy()
    expect(screen.getByText(/runs a local process on your machine/)).toBeTruthy()
  })

  it.each([
    { tools: [], discovery_error: null, expected: 'Loading its tools…' },
    { tools: ['old-tool'], discovery_error: 'discovery timed out', expected: 'Authorized. Tools unavailable.' }
  ])(
    'does not report a ready server before successful tool discovery: $expected',
    ({ discovery_error, expected, tools }) => {
      const { container } = renderTool({
        settled_by: 'continue',
        status: 'settled',
        targets: [{ action: 'install', kind: 'mcp', name: 'linear', state: 'connected', tools, discovery_error }]
      })

      expect(screen.getByText(expected)).toBeTruthy()
      expect(screen.queryByText(/Installed Linear/)).toBeNull()
      expect(container.querySelector('[class*="text-emerald"]')).toBeNull()
    }
  )

  it('announces discovery as loading tools instead of waiting for an authorization browser', () => {
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <McpSetupOffer
          action="install"
          owner={null}
          request={{ ...REQUEST, targets: [{ ...LINEAR, state: 'connected' }] }}
        />
      </I18nProvider>
    )

    expect(screen.getByRole('status').textContent).toBe('Loading its tools…')
    expect(screen.queryByText(/Waiting for your browser/)).toBeNull()
  })

  it('opens required details from the row action and sends the approved environment', async () => {
    const rpc = vi.fn().mockResolvedValue({ status: 'ok', settled: false })

    const target = {
      ...LINEAR,
      instructions: 'Create a Linear API key.',
      requiredEnv: [{ default: 'workspace', name: 'LINEAR_TEAM', prompt: 'Team', required: true, secret: false }]
    }

    setSessionOwnerHint(SESSION_ID, { connectionId: 'local', profile: 'default' })
    // SAFETY: the card calls only `request`; the rest of the client is never touched in this test.
    setPrimaryGateway({ request: rpc } as never)
    setPrimaryGatewayConnectionId('local')
    setConnectionRequest({ ...REQUEST, targets: [target] })

    renderTool()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(screen.getByText('Set up Linear')).toBeTruthy()
    expect(screen.getByText('Create a Linear API key.')).toBeTruthy()
    expect(screen.getByLabelText('Team').getAttribute('value')).toBe('workspace')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenCalledWith('connection.respond', {
      op_id: 'operation-1',
      owner: { session_id: SESSION_ID, type: 'session' },
      result: { targets: [{ env: { LINEAR_TEAM: 'workspace' }, name: 'linear', status: 'approved' }] }
    })
  })

  it('names what approving runs as plain text, and drops the line once the row resolves', () => {
    const markup = 'npx <img src=x onerror=alert(1)> **bold** --api-key=***'
    const pending = { ...LINEAR, launch: { kind: 'stdio' as const, target: markup } }

    setConnectionRequest({ ...REQUEST, targets: [pending] })
    const { container } = renderTool()

    const line = container.querySelector('[data-slot="mcp-launch-target"]')
    expect(line?.textContent).toBe(`Runs: ${markup}`)
    expect(line?.querySelector('img, strong')).toBeNull()

    act(() => setConnectionRequest({ ...REQUEST, seq: 1, targets: [{ ...pending, state: 'skipped' }] }))
    expect(container.querySelector('[data-slot="mcp-launch-target"]')).toBeNull()
  })

  it('names the env vars and working directory a stdio server adds, never their values', () => {
    const launch = {
      cwd: '/srv/acme',
      env: ['ACME_TOKEN', 'NODE_OPTIONS'],
      kind: 'stdio' as const,
      target: 'npx -y @acme/mcp'
    }

    setConnectionRequest({ ...REQUEST, targets: [{ ...LINEAR, launch }] })
    const { container } = renderTool()

    expect(container.querySelector('[data-slot="mcp-launch-target"]')?.textContent).toBe(
      'Runs: npx -y @acme/mcp' + 'Working dir: /srv/acme' + 'Env: ACME_TOKEN, NODE_OPTIONS'
    )
  })

  it('shows the whole launch line without hover: no clamp, no tooltip, a long middle arg included', () => {
    const pad = '--log-level=info '.repeat(15)
    const target = `node server.js ${pad}--exec /tmp/steal.js ${pad}--quiet`

    setConnectionRequest({ ...REQUEST, targets: [{ ...LINEAR, launch: { kind: 'stdio', target } }] })
    const { container } = renderTool()

    const line = container.querySelector<HTMLElement>('[data-slot="mcp-launch-target"]')
    expect(line?.textContent).toBe(`Runs: ${target}`)
    expect(line?.textContent).toContain('--exec /tmp/steal.js')
    // Bounded, but scrollable: the box may scroll, it never clips.
    expect(line?.className).not.toMatch(/line-clamp|truncate|overflow-hidden|text-ellipsis/)
    expect(line?.className).toMatch(/overflow-y-auto/)
    // Two spaces inside a quoted arg are two arguments' difference: the box keeps them.
    expect(line?.className).toMatch(/whitespace-pre-wrap/)
    expect(line?.hasAttribute('title')).toBe(false)
  })

  it('lists every target once settled, in the same three words as the connector card', () => {
    renderTool({
      settled_by: 'continue',
      status: 'settled',
      targets: [
        { action: 'install', kind: 'mcp', name: 'linear', state: 'connected', tools: ['a', 'b'] },
        { action: 'install', detail: 'catalog write failed', kind: 'mcp', name: 'postgres', state: 'not_connected' }
      ]
    })

    expect(screen.getByText('Installed Linear · 2 tools')).toBeTruthy()
    expect(screen.getByText('Not connected')).toBeTruthy()
    expect(screen.queryByText(/catalog write failed/)).toBeNull()
    expect(screen.queryAllByRole('button').filter(button => !button.hasAttribute('disabled'))).toHaveLength(0)
  })
})
