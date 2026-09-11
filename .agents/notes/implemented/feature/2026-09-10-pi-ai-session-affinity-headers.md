# Agent Note: pi-ai session-affinity headers

Status: implemented

English | [中文](2026-09-10-pi-ai-session-affinity-headers.zh.md)

## Problem

Affinity gateways route and cache per conversation. OpenCode Go names DeepSeek Harness in its problematic-clients list: session information arrives on some model paths but not others. Concretely, pi-ai's `openai-responses` dispatch sends an affinity header when a route's compat enables it, while `openai-completions` and `anthropic-messages` send none by default and the harness profile schema exposes no switch to turn them on — so most Go models never carry a session id. The session id itself exists on every call (`GenerateOptions.sessionId`); only the wire mapping is missing.

## Decision

`llm-pi-ai` provider profiles gain `sessionAffinityHeaders: string[]`. When a call carries a session id, the adapter writes each declared name with that id as its value, after profile headers and attribution — one injection point covering every wire path, because all three pi-ai dispatches merge the harness `headers` option last. The `opencode-go` catalog route — and any route whose endpoint is opencode.ai — additionally defaults to `x-opencode-session` + `x-client-request-id`, so the gateway works with zero configuration; an explicit empty array opts out. Names are validated against Fetch at resolution, and the attribution reserved set (read from `attributionHeaders()` so the check cannot drift) is refused — `user-agent` keeps its mandatory value.

## Alternatives considered

**A community fetch-patch plugin** (`dsh-opencode-session`) wraps `globalThis.fetch` and correlates requests to sessions through AsyncLocalStorage. Rejected as the main path: it depends on the SDKs always using global fetch, its uninstall is order-sensitive against other patches, and third-party host code has no place in the shipped composition. It remains a user-installed transitional option until this lands upstream.

**Static per-route headers in profile `headers`.** One shared value for every conversation of the route — violates the per-conversation requirement and gives affinity caching nothing to key on.

**A local rewriting proxy.** Requests reach the adapter with no session identifier on the affected paths, so a proxy cannot derive the id; it would only add a maintained MITM component.

**Waiting for pi-ai upstream.** pi-ai has no `x-opencode-session` concept and its compat switches are not exposed through the harness schema; not actionable on our cadence.

## Consequences

`llm-pi-ai` joins the fork publish surface, and every affinity gateway (not just OpenCode) can be configured per route. Undeclared routes are byte-identical on the wire, so isolation holds by construction. Field naming here is local; an upstream contribution should converge on the official spelling, and the fork can retire the deviation when that lands.
