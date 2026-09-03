# Agent Note: The todo-completion turn-end guard

Status: implemented

English | [中文](2026-08-19-todo-completion-guard.zh.md)

## Problem

Agents routinely end turns leaving `todo_write` items unfinished. The tool description already instructs "mark a todo completed the moment it is done", but a prompt is probability reduction, not structure: across upstream reports and this fork's own sessions, models finish the visible reply, drop the last `todo_write` call, and the session keeps a stale open plan (the web plan strip renders it until the next `turn/start`). Other harnesses answer with hard gates (Cline/Roo force an `attempt_completion` epilogue); the Claude Code analog is the advisory Stop hook. The harness loop already owns the right seam — `agent/turn-stopping` broadcasts before a completed turn closes, and a listener that `steer()`s makes the loop run another step of the same turn (pinned by contract regression "steer() from an agent/turn-stopping listener continues the same turn") — but nothing composable watches todos there. The loop deliberately has no turn budget, and its own Stop-hook bridge carries a `TODO(stop-loop-guard)` warning that listeners must self-limit.

## Decision

A new guard package, `packages/guard/todo-completion-guard`, listens on `agent/turn-stopping` and steers exactly one `notice`-form plugin context into the turn when the turn's standing list has unfinished items. Four properties are the contract:

- **Standing-list scoping.** The candidate list is the latest `todo/write` after the current turn's own `turn/start` — the same clearing rule as the `todos` projection. Earlier-turn lists are cleared state, not residue; the guard never re-litigates a previous turn.
- **Unfinished = not `completed`.** `pending` and `in_progress` both count; a forgotten pending item is the commonest residue.
- **Wall-bounded exemption.** If any step of the turn finished on `max-tokens` (sticky turn outcome), the guard stays silent — forcing another step would most likely hit the same output ceiling again.
- **Once per agent per turn** (`WeakMap` over the live agent). A steered turn that still ends open is allowed to end. This is the self-limit the loop's lack of a turn budget demands; it replaces any configurable cap.

The reminder names three exits — finish and check off, rewrite the list around a deliberate drop with a one-line reason, or state explicitly that the list legitimately stays open — so a model blocked on the user or continuing next turn has an honest no-op path. The notice is source-attributed and logged as a `user/message`; no new session event, per the model-visible-⟺-logged rule. No `Config`: every knob is a correctness property of the advisory contract, not a deployment choice.

The row ships in `packages/bundle/base/cordis.patch.yml` beside `repeat-tool-reminder`, whose advisory philosophy (nudge, never veto) this guard copies.

## Alternatives considered

**Prompt hardening only.** Rejected as the sole fix: upstream evidence shows models ignoring the instruction; a prompt lowers the rate, the guard is the structural backstop. Both layers coexist.

**Forcing continuation until the list closes.** Rejected: legitimate deferral is real (blocked on user, work spanning turns). A hard gate would burn tokens re-prompting exactly when the model has nothing to do, and a cap on forced rounds re-invents the advisory mode with more machinery.

**Watching `tools/post-execute` like repeat-tool-reminder.** Rejected: the residue happens at turn end, not per call; the stopping boundary is the only point where "about to end with an open list" is observable, and the loop there already supports same-turn continuation via `steer()`.

**Reading the `todos` projection service.** Rejected: the projection is a mounted-optional presentation unit; the guard reads the authoritative session log through `Session.snapshotEvents()` so the composition works wherever `agent/turn-stopping` fires.

## Consequences

A turn that writes a list and replies without closing it gets one extra step carrying the reminder; compliant models check off or rewrite the list in that step (the behavior suite pins this through a real loop with the real `todo_write` tool). Defiant or legitimately-deferring models end the turn after exactly one nudge — bounded cost: one message and one model step. Wall-bounded turns cost nothing. Resumed sessions get a fresh per-turn budget, which only matters across a process restart mid-turn. The guard is inert in compositions without `tool-todo`. The known residue that survives: a model that rewrites the list to all-completed without doing the work defeats the guard — that is honesty, not bookkeeping, and out of scope.

## Related

The loop's missing turn budget and the Stop-hook self-limit warning are recorded in `packages/core/agent-loop/README.md`; [repeat-tool-reminder](2026-07-08-repeat-tool-guard.md) owns the shared advisory philosophy on the tool chain.
