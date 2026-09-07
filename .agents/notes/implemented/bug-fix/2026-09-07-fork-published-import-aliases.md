# Agent Note: Preserve fork package import names

Status: implemented

English | [中文](2026-09-07-fork-published-import-aliases.zh.md)

## Problem

Creator mode references `@deepseek-ai/dsh-tool-cordis`. Renaming dependency keys during fork publication leaves the profile module fallback with only `@crazx/dsh-tool-cordis`, while built imports and shipped preset rows retain the original name. A fresh installation reports the preset as broken even when the fork package exists elsewhere in the runtime tree.

## Decision

The publisher changes each package's own name to the fork scope but preserves dependency keys. Dependencies, optional dependencies, and development dependencies use npm aliases to the selected fork version. Peer dependencies retain their original keys and require the selected fork semver from the host; peer metadata therefore keeps the same keys. Vendor packages retain their own published version line.

## Alternatives considered

**Desktop-only symlinks.** They repair one installation but leave the npm artifacts invalid for other consumers and profiles.

**Rewrite imports and preset rows to the fork scope.** Unmodified upstream packages also reference original names. Rewriting those consumers expands the fork and increases the risk of duplicate service instances.

## Consequences

Profile fallback discovery sees the names that shipped presets use. Consumers must supply fork peers through the same original-name aliases; peer ranges cannot carry npm alias specifiers. Publication runs the manifest regression suite before registry writes. Release validation additionally needs an installed-artifact preset roster and mount check because source-workspace resolution cannot verify npm installation behavior.
