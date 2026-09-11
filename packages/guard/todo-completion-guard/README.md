# @deepseek-ai/dsh-todo-completion-guard

English | [中文](README.zh.md)

An advisory turn-end guard, not a model-facing tool: it never appears in the tool list, never vetoes a turn, and adds exactly one behavior — when an otherwise completed turn is about to close while its standing todo list still has unfinished items, it steers one plugin-notice into the same turn telling the model to finish and check off the items, rewrite the list around a deliberate drop, or state explicitly why the list stays open. Whether to comply stays entirely with the model; the guard advises once per turn and never loops. Decision record: [the todo-completion-guard Agent Note](../../../.agents/notes/implemented/feature/2026-08-19-todo-completion-guard.md).

## When it fires

The guard listens on `agent/turn-stopping`, the boundary the loop broadcasts just before closing an otherwise completed turn (the same seam the Claude Code Stop hook rides). A steered message makes the loop observe pending input and run another step of the same turn.

At that boundary it inspects the current turn's events:

- **Standing list** — the latest `todo/write` after the current turn's own `turn/start`, matching the todo projection's clearing rule. A list written in an earlier turn is already cleared by that rule and is never nagged about; a turn that writes no list is invisible to the guard.
- **Unfinished means not `completed`** — both `pending` and `in_progress` count. A forgotten `pending` item is exactly the residue this guard exists for.
- **Exempt: wall-bounded turns.** If any step of the turn finished on `max-tokens` (a sticky turn outcome), the guard stays quiet — forcing another step would most likely hit the same output ceiling again and burn the request for nothing.
- **Once per agent per turn.** A steered turn that still ends with an open list is allowed to end: the reminder names the exits (complete, rewrite with a one-line reason, or declare the deferral), and a model that chooses to keep the list open heard the reminder once. This is the guard's own loop cap; the loop itself has none.

## The reminder

One `notice`-form context message, source `{kind: 'plugin', plugin: 'todo-completion-guard'}`, steered into the turn and appended as a logged `user/message` — model-visible, source-attributed, and reconstructable from the session log with no new session event. It lists every unfinished item with its status, then names the three exits. The decision — finish, rewrite, or keep with an explicit statement — stays with the model: a legitimately deferred list (work continuing next turn, waiting for the user) is delayed by nothing and blocked by nothing.

## Composition

```yaml
- id: todo-completion-guard
  name: '@deepseek-ai/dsh-todo-completion-guard'
```

No configuration: every knob this guard would expose (reminder text, per-turn cap, exemptions) is a correctness property of the advisory contract, not a deployment choice. It is a consumer of the `todo/write` event vocabulary; mounting it without `tool-todo` in the composition is inert (no turn ever writes the event).

## Known Limitations and Deferred Work

- **Advisory only** — a model that acknowledges the reminder and still leaves the list open ends the turn after one nudge; escalating to forced continuation is rejected (that is a `TODO(stop-loop-guard)` policy for the loop, not this guard).
- **In-memory throttle** — the once-per-turn state is a `WeakMap` over the live agent; a session resumed from persistence gets a fresh budget, which only matters for a turn that spans a process restart.
- **Subagent lists are invisible by design** — the guard reads each agent's own session log; a child's unfinished list never steers the parent (the parent's own list reflects delegated work as it sees it).
