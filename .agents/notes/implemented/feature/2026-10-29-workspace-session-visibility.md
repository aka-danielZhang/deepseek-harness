# Agent Note: Contributor-owned Workspace Session visibility

Status: implemented

English | [中文](2026-10-29-workspace-session-visibility.zh.md)

## Problem

Quno's permanent main conversation is an ordinary Session, not a subagent. It therefore remained visible in Workspace browsing even though the product exposes that conversation through Quno's own entry. Hiding it requires the same treatment in grouped, flat, and search views without putting Quno-specific rules into the shared Workspace browser or losing rows only through CSS.

## Decision

`UiWorkspace` exposes `registerSessionVisibilityFilter(filter)`. Each registration owns one predicate and returns an idempotent disposer. Registration and disposal publish a revision; grouped, flat, and search derivations reevaluate all predicates alongside the existing `origin: 'subagent'` and archived filters. Filtering changes presentation only: Workspace membership, Host search, durable logs, direct navigation, and history recall keep their existing behavior. Predicates and their revision belong to the `UiWorkspaceService` instance, not a module-level registry.

The public predicate accepts the existing Client `SessionSummary`, so feature plugins can use projections such as `agentPreset` without the Workspace package learning their preset names. A consumer may feature-detect the method when running against an older composition.

## Alternatives considered

**Checking for the Quno preset inside `sessionVisible`.** This puts one feature's business rule into a shared UI package and gives every other Workspace consumer a concept it does not own.

**Hiding Quno rows through DOM markers or CSS.** CSS does not remove Sessions from group counts, flat membership, search results, or ordering state, and search rows do not carry the same marker seat.

**Marking the main conversation as a subagent.** That misstates its lifecycle and ownership and risks changing Session routing instead of only browsing visibility.

## Consequences

Workspace browsing has one registration path for feature-owned visibility with live disposal and no Host changes. Existing compositions without registrations behave as before. The registration tests cover duplicate predicates and idempotent disposal; the browser test covers grouped, flat, local-search, Host-content-search, and revision-driven recomputation. The focused Workspace suites pass 180 tests, and `build:artifacts` followed by `build:check` passes.
