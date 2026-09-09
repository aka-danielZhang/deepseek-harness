# Agent Note: The mcp-client connection-status event

Status: implemented

English | [中文](2026-08-18-mcp-client-status-event.zh.md)

## Problem

An observer of an MCP server connection — a settings UI listing servers with their live state, an inventory surface, a watchdog — had no faithful signal. The fiber lifecycle cannot stand in: with `failOnStartupError: false`, a server that can never reach its endpoint still reaches an `active` fiber and stays there inside its reconnect loop, so "fiber active" says nothing about connected, retrying, or exhausted. Polling `ctx.tools` is no better: a lost connection keeps its tools registered (and failing) until the give-up point, so registration presence does not distinguish connected from an outage in progress.

## Decision

The connection supervisor in `packages/mcp/mcp-client` publishes a Cordis event, `mcp-client/status(serverName, status, toolCount)`, at each of its own commit points — never before the state mutation it reports:

- `connecting` when an attempt starts (the first attempt publishes before any await, because `connectGeneration`'s synchronous prefix claims the client slot);
- `connected` when connect plus the initial tool sync settle;
- `reconnecting` when a backoff timer is armed (the supervisor resets `connectedAt` before arming, so an established-then-lost connection reports reconnecting, not connected);
- `failed` on give-up, on a reconnect-disabled loss, and on a failed generation that never closed;
- `disposed` on teardown.

A completed tool sync republishes the current status because `toolCount` changes without a status transition — including a second `failed`/`disposed` carrying `toolCount: 0` once the queued unregistration runs. The status itself is derived by a pure function, `computeMcpClientStatus(facts)`, whose evaluation order is load-bearing (`failed` before `reconnecting`, `connected` before the in-flight branches) and is unit-tested per branch. The event uses the shared Cordis bus and its listeners are synchronous by contract: a synchronous throw is contained and logged by the emitter, while async work must contain its own rejection. `serverName` is unique only in one registration scope, so a deployment that reuses a name across Agent scopes needs an additional observer-owned identity.

The event declaration and the `McpClientStatus` union live in `src/types.ts` (types only), re-exported from the package root; the catalog maps the `mcp-client` scope to the Tools subsystem page.

## Alternatives considered

**Observe the fiber lifecycle.** Rejected: with `failOnStartupError: false` a failing server is an active fiber in a reconnect loop; the fiber states cannot express the connection states.

**Poll the tools registry.** Rejected: tools stay registered through an outage until give-up, so the registry reads "present" precisely while calls are failing.

**Let each observer spawn its own probe connection.** Rejected: it duplicates the supervisor's transport work per observer and still cannot see the supervisor's own retry budget.

## Consequences

`dsh-mcp-settings` feeds its server-status registry from this event alone; its Web settings page shows connected/reconnecting/failed per server without touching the supervisor. Any future observer subscribes the same way — no new service surface, no polling contract. The supervisor's own behavior is unchanged: every publish call is additive, and the event carries only committed facts.
