# Agent Note: Retire the Models provider-row slot (plugin moved to DOM injection)

Status: implemented

English | [中文](2026-08-19-retire-models-provider-row-slot.zh.md)

## Problem

The fork carried `settings.models.provider` (PR #1) so the out-of-tree dsh-provider-balance plugin could attach a quota badge to each provider row on the Models settings page. The seat worked, but it made the plugin depend on fork-only source: on an upstream harness the seat simply never declared and the badges silently disappeared.

## Decision

The plugin's client bundle learned to mount the SAME badge component through its own `react-dom/client` root into a foreign container inserted next to each provider row's actions (route id parsed from the edit button's accessible name; host React tree untouched; MutationObserver sweep re-asserts position and unmounts on row removal). Verified end-to-end against a pristine upstream/master worktree: identical rendering, zero host modification. With that path in place the fork seat is redundant, so this revert removes it (commit ffffaf39). If upstream ever ships an equivalent row seat, the plugin may adopt it opportunistically without requiring it.

## Alternatives considered

**Keep the fork-only row slot.** Rejected because a provider badge can remain plugin-owned without changing Harness, while the slot makes every upstream baseline merge carry a UI contract used by only one out-of-tree plugin.

**Wait for an upstream slot before showing the badge.** Rejected because the accessible action label already gives the plugin a fail-invisible route anchor; waiting would remove useful behavior without reducing current fork code.

## Consequences

- Fork master no longer diverges from upstream in ui-settings / ui-settings-models; sync cost drops accordingly.
- FORK.md records this as a retired precedent and the derived rule: when a plugin-side DOM injection can cover row-level UI, prefer the plugin side and keep fork source untouched.
