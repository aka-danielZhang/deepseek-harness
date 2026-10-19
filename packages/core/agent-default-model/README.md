---
description: "The deployment default model selection for users and maintainers choosing, configuring, or debugging which model freshly created agents start on."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-default-model

English | [中文](README.zh.md)

## Summary

Give newly created agents a shared default provider and model when their sessions do not specify one. Provider, model, and reasoning effort are live Config fields. Saved selections update the active profile patch and apply to subsequent reads; per-session selection remains owned by the entry point.

- `ctx.agentDefaultModel.currentSelection()` returns a detached `{ provider, model, reasoningEffort? }` selection for a newly created Agent.
- `ctx.agentDefaultModel.saveSelection(selection)` saves the complete user selection. Without a settings provider it is a no-op and the composition entry remains current.
- `ctx.agentDefaultModel.recallEffort(provider, model)` returns the reasoning effort the user last explicitly chose on that route, or `undefined`.
- `ctx.agentDefaultModel.rememberEffort(provider, model, effort?)` records — or, when `effort` is `undefined`, clears — that route's remembered effort. Without a settings provider it is a no-op.

The remembered efforts live in the separate `agent-model-efforts` Settings section (an entry list keyed by provider/model), so switching the default selection never overwrites them. The service stores what it is told; the consumer that consults a memory validates it against the live model capability, because a remembered level can outlive the declaration that offered it.

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

Mount this package wherever agents are created without an explicit model route. The service answers one question — which model should a fresh agent use? — so entry points that create agents consult it instead of re-implementing a default.

### Configure the default

The composition requires a provider and model. Consumers read the live references even when no configuration editor is mounted.

```yaml
- name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek
    model: deepseek-chat
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required | Registered provider route for fresh agents |
| `model` | required | Provider-owned model id for fresh agents |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-agent-default-model) lists every accepted field. `reasoningEffort` is optional; saving a selection without it removes that field from the profile’s complete config override.

### Read and change the default

`currentSelection()` returns a detached `{ provider, model, reasoningEffort? }` for a newly created agent; `saveSelection()` stores the complete selection for later agents.

```text
const selection = ctx.agentDefaultModel.currentSelection()
await ctx.agentDefaultModel.saveSelection({ provider, model, reasoningEffort: 'high' })
```

Without a configuration editor, `saveSelection()` is a no-op. The service does not validate catalog membership; the consumer opening a model request owns availability diagnostics.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the service realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The service retains its validated Config references and samples them in `currentSelection()`. `saveSelection()` captures the submitted values and serializes profile writes in submission order, including overlapping callers. Each caller observes its own write failure; a rejected write does not prevent later saves. Session-specific selection takes precedence in the consumer.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Live default selection and profile-backed writes |

### Behavior notes

`currentSelection()` returns a detached selection. A captured selection stays stable while later operations read updated Config references.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The package-level contract is enough for most consumers; read these when you need the surrounding domain.

- [Core subsystem](../../../docs/subsystems/core.md) — the `Agent` handle and `AgentOptions` route selection.
- [agent-loop package](../agent-loop/README.md) — how agents resolve provider and model at request time.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-agent-default-model) — every accepted config field and its source declaration.
- [Core group map](../README.md) — how the core packages compose.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `ModelSelection` the service supplies to an entry point; request assembly and the provider adapters own the model-visible request.

#### KV Cache effect

Changing the default affects only agents that subsequently resolve from it. An existing session whose request log already names a selection keeps that selection, so this service does not invalidate its established prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the service's scope. They are current package constraints, not a task backlog.

- **One process-wide default** — the service owns a single default; per-session model selection remains the entry point's responsibility.
- **Persistence requires a profile configuration editor** — without it, saving a default does not retain the selection, and `rememberEffort()` cannot retain a level.
- **Effort memory is unbounded** — the memory grows one entry per route the user has explicitly tuned; it is never pruned automatically (a stale entry is dropped at consult time instead).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
