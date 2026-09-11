# Agent Note: The per-route reasoning-effort memory

Status: implemented

English | [中文](2026-08-19-model-effort-memory.zh.md)

## Problem

Selecting a model in the Web composer reset its reasoning effort to the model's declared default every time. The two selection entries stated the reset differently — the `/model` popup materialized the target model's `defaultEffort` client-side, the composer seat sent a bare `{provider, model}` and let the Host materialize it — but neither remembered anything, and the only persistence tiers were a per-session current (logged with prompt assembly) and one process-wide default tuple whose single `reasoningEffort` field was overwritten by every switch. A user who tuned model A to `max`, switched to B, and returned to A got A's default again. The user's own words: the picked effort level should be cached per model.

## Decision

The effort the user last explicitly chose on one provider/model route is remembered in a new Settings namespace, `agent-model-efforts` (an entry list; at most one entry per route), owned by `AgentDefaultModelConfig` beside the existing `agent-default-model` namespace — switching the default selection never overwrites a route's memory. The service exposes `recallEffort(provider, model)` and `rememberEffort(provider, model, effort?)`; without a settings provider both stay no-ops with the composition entry current. Since each update replaces the route list, the service serializes its complete read-compute-replace operation; concurrent choices on different routes preserve both entries, and the queue advances after a failed write.

`session.selectModel` in the Session Controller owns the policy:

- A bare pick (`reasoningEffort` absent) on a **different** route consults the memory; a remembered level is validated against the model's live `reasoning.efforts` (memory can outlive the declaration that offered it) and used, else dropped-and-cleared and the adapter default materializes as before.
- A bare pick on the **same** route is the explicit provider-default gesture (the effort pane's Default row); it clears that route's memory.
- A wire-stated effort is validated, applied, and remembered. A consulted bare pick never writes.

The `/model` popup no longer materializes `defaultEffort` client-side for a cross-route pick (`selectionOf` states no effort), so both entries defer to the same Host decision; a same-route pick still re-asserts the held effort. Memory writes ride `ctx.agentDefaultModel.recallEffort`/`rememberEffort`. A memory-storage failure is logged and swallowed — the switch already applies to its Session.

## Alternatives considered

**Client-side localStorage keyed by model.** Rejected: the desktop shell assigns a fresh loopback port per boot and localStorage is origin-scoped, so the cache would silently vanish per window; and the popup/composer split would need both entries to agree on a second, client-owned fact source beside the Host.

**One memory entry keyed by the current model only (single slot).** Rejected: it reproduces the default tuple's last-wins problem between models — A→B→A would restore nothing.

**Record every materialized default into memory.** Rejected: the adapter default would then shadow an earlier explicit choice whenever the user passes through a model without touching its effort pane; memory must hold only explicit statements.

**A `SessionEventMap` event per remembered effort.** Rejected: the memory is deployment state, not model-visible session content — nothing in a reconstructed request depends on it, so the settings document is the one home.

## Consequences

A→B→A through either selection entry restores A's last explicitly chosen level, across sessions and Host restarts, with the desktop's port churn irrelevant because the memory is host-side. Stale entries self-heal at consult time (dropped and cleared) instead of failing the switch, matching the strict no-clamping validation elsewhere. Cost: one more Settings section in the stored document, one extra `resolveModelInfo` consult on the bare-switch path, and the memory grows one entry per tuned route without automatic pruning. The Web e2e (`declared-reasoning`) pins the restore and the stale-drop through the real UI; the session-controller unit tests pin the write policy (explicit records, same-route clears, consulted bare picks write nothing).

## Related

The wire remains unchanged: `session.selectModel`'s optional `reasoningEffort` keeps its meaning, and a client that states no effort simply delegates the decision.
