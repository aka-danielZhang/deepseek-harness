# Agent Note: Basic compaction falls back to bounded hierarchical summarization

Status: implemented

English | [中文](2026-08-22-bounded-hierarchical-compaction-fallback.zh.md)

## Problem

The default compaction backend selected a bounded conversation region but summarized that entire region in one auxiliary request. A history could therefore cross the conversation model's pressure threshold and still be larger than the summarizer model's own context window. The Provider returned `CONTEXT_WINDOW_EXCEEDED`, the automatic listener logged the failure and continued, no checkpoint landed, and the next request retried the same oversized history. Installing an out-of-tree hierarchy Provider did not correct the default because shipped and user presets still mounted `@deepseek-ai/dsh-compaction-basic` inside their isolated compaction realm.

The existing [prefix-cache decision](../../archived/bug-fix/2026-07-21-compaction-summary-prefix-cache-reuse.md) remains valuable for requests that fit. Replacing every summary with map-reduce would fix the overflow but would unnecessarily increase calls, weaken warm-prefix reuse, and change the established one-shot request contract.

## Decision

`@deepseek-ai/dsh-compaction-basic` keeps its existing one-shot summarizer as the preferred path and owns a bounded hierarchical fallback internally. Presets continue mounting the same Provider with zero configuration; no shipped or user composition is rewritten.

The fallback starts when either condition holds:

- estimated one-shot input plus its configured `maxTokens` cannot fit the resolved summary target's context window;
- the fitting one-shot request returns canonical `CONTEXT_WINDOW_EXCEEDED`.

An adapter that declares no `contextWindow` still receives the legacy one-shot request. A successful request remains fully compatible. If it overflows, compaction reports that capacity metadata is required for bounded recovery instead of guessing a chunk size.

### Bounded hierarchy

Map planning groups chronological messages into units that never split a tool call from its results, then greedily packs units under `floor(contextWindow * chunkInputRatio)` after fixed system, optional tools, instruction, and output reserves. Every map output uses the fixed checkpoint section protocol and carries stable one-based source-unit coordinates.

Reduce rounds consume ordered `<partial-summary>` messages under the same bounded-input rule until exactly one checkpoint remains. Provider-confirmed context overflow bisects only the rejected map or reduce span at a tool-balanced boundary. Successful siblings remain available and are never replayed merely because another span failed. `maxDepth` and explicit no-progress checks bound recursion.

Every stage rejects image output, missing headings, truncation, cancellation, and noncanonical Provider failures. A Provider-rejected atomic source or partial reports an indivisible overflow. The existing region transaction owns durable mutation, so no partial hierarchy result reaches the conversation surface.

### Configuration and provenance

The hierarchy fields are ordinary policy fields and may be overridden by exact provider/model entries:

- `chunkInputRatio: 0.6`
- `mapMaxTokens: 4096`
- `reduceMaxTokens: 8192`
- `maxDepth: 4`
- `replayTools: false`

The fitting one-shot continues using `maxTokens`. Hierarchy stage caps are separate because map and reduce output have different cost and convergence roles. Tool schemas are omitted by default to preserve source-message room; strict Providers can opt into replay.

`llmStreamCall: true` continues to mean exactly one successful call through this context's `ctx.llm.stream()` with complete `rawOutput`. Multi-call results and recovery after a failed attempt leave the marker unset. Usage is aggregated only when every successful stage reports usage and no failed model attempt occurred; final `rawOutput` is the final stage output, not a synthetic concatenation.

## Alternatives considered

- **Replace preset rows with the out-of-tree hierarchy Provider** — rejected: installation does not mount a preset-owned Provider, user presets are independently owned, and changing every current and future composition would duplicate a product default at the wrong layer.
- **Always use map-reduce** — rejected: fitting requests already have a tested, cache-reusing one-shot path. Paying multiple calls and discarding prefix identity for small histories is unnecessary.
- **Retry the same one-shot with a smaller output cap** — rejected: the observed failure is oversized input. Lower output caps cannot make an arbitrarily large replay bounded and increase truncation risk.
- **Truncate or sample the selected history before summarization** — rejected: silent source loss violates checkpoint fidelity and can split tool semantics. Structured chronological map-reduce retains explicit source coverage.
- **Commit map checkpoints incrementally** — rejected: a failed later stage would expose an incomplete durable checkpoint. The existing all-or-nothing region transaction remains the correct mutation owner.

## Consequences

- Every preset that already mounts `@deepseek-ai/dsh-compaction-basic` receives oversized-history recovery without composition changes.
- Fitting requests preserve the one-shot message shape, `maxTokens`, target precedence, errors, output projection, and warm-prefix behavior documented by the earlier cache note. This note partially extends that decision rather than superseding it.
- Oversized compaction can consume several Provider calls and usually has weaker KV-cache reuse. Its bounded calls trade cost for guaranteed request-size progress.
- Strict structured output makes hierarchy fail closed when a stage cannot produce a complete checkpoint. Automatic pressure handling then preserves the latest durable surface and logs the operational failure as before.
- Focused Vitest coverage pins configuration validation, one-shot compatibility, tool-balanced planning, map-reduce convergence, adaptive local splitting, depth/no-progress bounds, cancellation, malformed/truncated/visual output, model-policy overrides, and honest provenance/usage. The modified package maintains the repository's per-file 100% coverage gate.
