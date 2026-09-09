---
description: "Advisory turn-end guard that reminds a model about unfinished todo items, for users and maintainers choosing, composing, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-todo-completion-guard

English | [中文](README.zh.md)

## Summary

This package gives a model one last chance to reconcile unfinished todo items before an otherwise completed turn closes. It steers one source-attributed reminder into the same turn, then lets the model finish the items, rewrite the list around a deliberate deferral, or explain why work remains open. It never vetoes completion and never loops. Choose it for autonomous sessions that use `todo_write`; leave it out when an open list must never trigger another model step.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh` base bundle already mounts this guard beside `tool-todo`; custom compositions can mount the same configuration-free row.

### When to choose it

Choose it when an agent plans multi-step work with `todo_write` and an accidentally open list should prompt one reconciliation step. Avoid it when a turn must close immediately regardless of plan state, or when todo events come from a custom vocabulary rather than `@deepseek-ai/dsh-tool-todo`.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-todo-completion-guard'
```

The package has no configuration fields. Reminder wording, the once-per-turn cap, and the max-token exemption are correctness properties rather than deployment knobs. Without `tool-todo`, no `todo/write` event exists and the guard stays inert.

### What happens at turn end

At `agent/turn-stopping`, the guard reads the latest `todo/write` after the current `turn/start`. Both `pending` and `in_progress` items count as unfinished. If the turn has not hit its output-token ceiling, the guard steers one reminder and the loop observes pending input for another step. A second stop in the same turn is allowed without another reminder.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The implementation consumes the `TodoItem` and `todo/write` declarations from `@deepseek-ai/dsh-tool-todo`, so the event vocabulary has one owner. It scans an immutable `Session.snapshotEvents()` view and limits inspection to the current turn.

A turn is wall-bounded when an `assistant/message` or `assistant/attempt` stream ends with `max-tokens`. That outcome suppresses the reminder because another step is likely to hit the same ceiling. A `WeakMap<Agent, turn>` provides the once-per-turn limit without retaining disposed agents.

The reminder is a plugin-sourced `user/message` with `form: 'notice'`. It is appended through normal steering, remains attributable in the log, and does not invent a package-specific session event. No runtime invariant companion is published; this stateless advisory owns no independent mutable relation or event stream beyond the turn-stopping listener it evaluates.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Current-turn inspection, wall-bound detection, reminder construction, and listener registration |
| [`tests/todo-completion-guard.spec.ts`](tests/todo-completion-guard.spec.ts) | Complete, unfinished, max-token, and once-per-turn behavior |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Todo tool package](../../todo/tool-todo/README.md) — owner of `TodoItem`, `todo/write`, and whole-list replacement semantics.
- [Tools subsystem reference](../../../docs/subsystems/tools.md) — tool execution and model-facing context ownership.
- [Todo completion decision](../../../.agents/notes/implemented/feature/2026-08-19-todo-completion-guard.md) — rationale and rejected enforcement alternatives.
- [guard group map](../README.md) — sibling loop-hygiene policies.

-----

<a id="model-experience"></a>
## Model Experience

### Unfinished-list reminder

#### What the model sees

When a turn would otherwise finish with open items, the model receives one source-attributed context message. The item lines preserve current list order and status.

##### Reminder template

```markdown
The todo list still has <count> unfinished item(s) while this turn is about to end:
- [<pending|in_progress>] <item content>
Before finishing the reply: complete the remaining item(s) and mark them completed with todo_write; or, if items are genuinely dropped or deferred, rewrite the list to reflect that and say why in one line. If the work legitimately continues in a later turn or you are blocked waiting for the user, state that explicitly in the reply and the list may stay as is.
```

#### Token effect

Zero tokens when no current-turn list is open or the turn is wall-bounded. When triggered, one bounded instruction plus every unfinished item enters retained history.

#### KV Cache effect

Append-only. The reminder follows the reusable request prefix and does not rewrite earlier model input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the advisory contract rather than a backlog of enforcement work.

- **Advisory only** — a model may acknowledge the reminder and still leave items open; the guard never forces another continuation.
- **One live-process budget** — a process restart recreates the `WeakMap`, so a turn spanning a restart may receive another reminder.
- **Per-agent visibility** — a child's unfinished list never steers its parent; each agent reconciles its own session log.
- **No configurable wording or thresholds** — changing those semantics requires changing and testing the package contract.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
