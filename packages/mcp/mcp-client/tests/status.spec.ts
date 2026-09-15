/**
 * Tests for the observable connection status: the pure fact-to-status
 * projection and every commit point where the supervisor publishes
 * `mcp-client/status`. Isolated file so vi.mock of the MCP SDK doesn't
 * pollute other test suites.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config, McpClientStatus } from '@deepseek-ai/dsh-mcp-client'

// ---- Mock MCP SDK ----

// vi.mock factories are hoisted above every import/const, so the mock fns and
// class must be created inside vi.hoisted to exist when the factories run.
const { mockConnect, mockClose, mockListTools, MockClient, instances, ctorOptions } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  const mockRequest = vi.fn(async (
    request: { method: string; params?: Record<string, unknown> },
    _schema: unknown,
  ): Promise<unknown> => {
    if (request.method === 'tools/list') return await mockListTools(request.params)
    throw new Error(`unexpected MCP request: ${request.method}`)
  })
  class MockClient {
    onclose: (() => void) | undefined
    transport: { onclose?: () => void; close: () => Promise<void> } | undefined
    connect = mockConnect
    close = mockClose
    request = mockRequest
    getInstructions: () => string | undefined = () => undefined
    getServerCapabilities = () => ({ tools: {} })
    listTools = async () => await mockListTools() as Awaited<ReturnType<typeof mockRequest>>
    callTool = vi.fn(async () => ({}))
    constructor(_info?: unknown, options?: { listChanged?: { tools?: { onChanged?: () => void } } }) {
      instances.push(this)
      ctorOptions.push(options)
      this.transport = { close: mockClose }
    }
  }
  const instances: MockClient[] = []
  const ctorOptions: Array<{ listChanged?: { tools?: { onChanged?: () => void } } } | undefined> = []
  return { mockConnect, mockClose, mockListTools, MockClient, instances, ctorOptions }
})

vi.mock('@modelcontextprotocol/client', () => ({
  Client: MockClient,
}))

vi.mock('@deepseek-ai/dsh-mcp-client/src/transport.ts', () => ({
  createTransport: vi.fn(() => ({ close: mockClose, start: async () => {} })),
}))

// vi.mock is hoisted above static imports, so the modules under test see the
// mocked SDK even through a static import.
import { computeMcpClientStatus, resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'

// ---- Helpers ----

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function stdioConfig(reconnect?: Config['reconnect']): Config {
  return {
    transport: 'stdio',
    serverName: 'srv',
    command: 'echo',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    ...reconnect === undefined ? {} : { reconnect },
  }
}

/** The tool list the mock server advertises after a successful (re)connect. */
function listing(...names: string[]): { tools: { name: string; inputSchema: { type: string } }[]; nextCursor: undefined } {
  return {
    tools: names.map(name => ({ name, inputSchema: { type: 'object' } })),
    nextCursor: undefined,
  }
}

/** One committed status observation, as a listener receives it. */
interface StatusEvent {
  readonly serverName: string
  readonly status: McpClientStatus
  readonly toolCount: number
}

function captureStatus(ctx: Context): { events: StatusEvent[] } {
  const events: StatusEvent[] = []
  ctx.on('mcp-client/status', (serverName, status, toolCount) => {
    events.push({ serverName, status, toolCount })
  })
  return { events }
}

function sleep(ms: number): Promise<void> {
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

// ---- Pure projection ----

describe('computeMcpClientStatus', () => {
  it('disposed wins over every other fact', () => {
    expect(computeMcpClientStatus({
      disposed: true, hasClient: true, hasTimer: false, connected: true, failedAttempts: 3,
    })).toBe('disposed')
  })

  it('no client and no timer is failed, even after a give-up left attempts counted', () => {
    expect(computeMcpClientStatus({
      disposed: false, hasClient: false, hasTimer: false, connected: false, failedAttempts: 2,
    })).toBe('failed')
  })

  it('a connected generation reports connected', () => {
    expect(computeMcpClientStatus({
      disposed: false, hasClient: true, hasTimer: false, connected: true, failedAttempts: 0,
    })).toBe('connected')
  })

  it('an armed backoff timer reports reconnecting', () => {
    expect(computeMcpClientStatus({
      disposed: false, hasClient: false, hasTimer: true, connected: false, failedAttempts: 1,
    })).toBe('reconnecting')
  })

  it('the first in-flight attempt reports connecting', () => {
    expect(computeMcpClientStatus({
      disposed: false, hasClient: true, hasTimer: false, connected: false, failedAttempts: 0,
    })).toBe('connecting')
  })

  it('a retry attempt in flight reports reconnecting', () => {
    expect(computeMcpClientStatus({
      disposed: false, hasClient: true, hasTimer: false, connected: false, failedAttempts: 1,
    })).toBe('reconnecting')
  })
})

// ---- Commit-point emissions ----

describe('status emissions', () => {
  let ctx: Context

  beforeEach(async () => {
    vi.clearAllMocks()
    instances.length = 0
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockImplementation(async () => listing('remote'))
    ctx = await mountRegistry()
  })

  it('publishes connecting, the synced tool count, then connected on a clean startup', async () => {
    const { events } = captureStatus(ctx)
    const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy(undefined, 't'))
    await handle.ready

    expect(events[0]).toEqual({ serverName: 'srv', status: 'connecting', toolCount: 0 })
    // The initial sync's swap is the toolCount's own commit point.
    expect(events.at(-1)).toEqual({ serverName: 'srv', status: 'connected', toolCount: 1 })
    await handle.dispose()
  })

  it('publishes reconnecting after a lost connection and connected again after recovery', async () => {
    const { events } = captureStatus(ctx)
    const handle = startConnection(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 5 }), resolveReconnectPolicy({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 5 }, 't'))
    await handle.ready

    instances[0]!.onclose?.()
    await vi.waitFor(() => { expect(instances).toHaveLength(2) })
    await vi.waitFor(() => {
      expect(events.at(-1)?.status).toBe('connected')
    })
    const statuses = events.map(event => event.status)
    expect(statuses).toContain('reconnecting')
    await handle.dispose()
  })

  it('publishes failed twice on give-up: once at the decision, once after the queued unregister', async () => {
    const { events } = captureStatus(ctx)
    const policy = { initialDelayMs: 2, maxDelayMs: 10_000, maxAttempts: 1 }
    const handle = startConnection(ctx, stdioConfig(policy), resolveReconnectPolicy(policy, 't'))
    await handle.ready

    // Crash, recover (attempt 1 of 1), crash again inside the stability
    // window: the budget exhausts and the supervisor gives up.
    instances[0]!.onclose?.()
    await vi.waitFor(() => { expect(instances).toHaveLength(2) })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    instances[1]!.onclose?.()

    await vi.waitFor(() => {
      expect(events.filter(event => event.status === 'failed')).toHaveLength(2)
    })
    const [decision, afterUnregister] = events.filter(event => event.status === 'failed')
    expect(decision!.toolCount).toBe(1)
    expect(afterUnregister!.toolCount).toBe(0)
    await handle.dispose()
  })

  it('publishes failed with the still-registered count when reconnect is disabled after a loss', async () => {
    const { events } = captureStatus(ctx)
    const handle = startConnection(ctx, stdioConfig({ enabled: false }), resolveReconnectPolicy({ enabled: false }, 't'))
    await handle.ready

    instances[0]!.onclose?.()
    await sleep(20)

    expect(events.at(-1)).toEqual({ serverName: 'srv', status: 'failed', toolCount: 1 })
    // Pre-reconnect contract: the generation stays registered until disposal.
    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
    await handle.dispose()
  })

  it('publishes failed with zero tools when reconnect is disabled and the initial connect fails', async () => {
    const { events } = captureStatus(ctx)
    mockConnect.mockRejectedValue(new Error('refused'))
    const handle = startConnection(ctx, stdioConfig({ enabled: false }), resolveReconnectPolicy({ enabled: false }, 't'))

    await handle.ready
    expect(events.at(-1)).toEqual({ serverName: 'srv', status: 'failed', toolCount: 0 })
    await handle.dispose()
  })

  it('publishes disposed twice through teardown, the second with the unregistered count', async () => {
    const { events } = captureStatus(ctx)
    const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy(undefined, 't'))
    await handle.ready

    await handle.dispose()
    const disposedEvents = events.filter(event => event.status === 'disposed')
    expect(disposedEvents).toHaveLength(2)
    expect(disposedEvents.at(-1)).toEqual({ serverName: 'srv', status: 'disposed', toolCount: 0 })
  })

  it('publishes the updated count when a tool-list change re-syncs while connected', async () => {
    const { events } = captureStatus(ctx)
    const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy(undefined, 't'))
    await handle.ready
    await vi.waitFor(() => { expect(events.at(-1)?.status).toBe('connected') })

    mockListTools.mockResolvedValue(listing('remote', 'extra'))
    const onChanged = ctorOptions.at(-1)?.listChanged?.tools?.onChanged
    onChanged?.()
    // The supervisor consumes onChanged as fire-and-forget; wait out the queued re-sync.
    await vi.waitFor(() => { expect(events.at(-1)?.toolCount).toBe(2) })

    expect(events.at(-1)).toEqual({ serverName: 'srv', status: 'connected', toolCount: 2 })
    await handle.dispose()
  })

  it('contains a throwing listener without disrupting the supervisor', async () => {
    ctx.on('mcp-client/status', () => { throw new Error('observer bug') })
    const { errors } = (() => {
      const errors: string[] = []
      ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
      return { errors }
    })()

    const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy(undefined, 't'))
    await handle.ready

    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
    expect(errors.some(line => line.includes('status listener failed'))).toBe(true)
    await handle.dispose()
  })
})
