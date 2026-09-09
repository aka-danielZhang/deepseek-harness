# Agent Note: publish-fork aliases fork peers

Status: implemented

English | [中文](2026-09-09-publish-fork-peer-alias.zh.md)

## Problem

`@crazx/dsh-api-session-controller@0.1.5-alpha.1.zw.1` shipped a `peerDependencies` entry of
`@deepseek-ai/dsh-agent-default-model: "0.1.5-alpha.1.zw.1"`. `rewriteManifest` substituted the
`workspace:^` protocol into the published version but deliberately skipped the `npm:@crazx/...`
alias for peer fields, on the belief that peers require plain semver. That version exists only
under the fork scope, so any consumer that does not itself provide the peer (for example a
`dsh-desktop` plugin that depends on the controller without depending on the default-model
package) fails resolution under `auto-install-peers` with `ERR_PNPM_NO_MATCHING_VERSION` naming
the official package. Consumers that happen to provide the alias themselves (dsh-thread) masked
the defect during spot checks.

## Decision

Rewrite fork-modified dependencies identically in every manifest field: `dependencies`,
`devDependencies`, `optionalDependencies`, and `peerDependencies` all publish
`npm:@crazx/<name>@<version>` under the original import name. npm and pnpm both accept alias
specs in peer fields, and the alias is the only spec that resolves for a plain consumer.

```mermaid
flowchart LR
  A[workspace:^ peer edge] --> B{versionOf has dep?}
  B -->|yes| C[npm:@crazx/name@zw.N in every field]
  B -->|no| D[target's own version line]
  C --> E[plain consumers resolve under auto-install-peers]
```

The broken zw.1 tarballs cannot be replaced (npm versions are immutable), so the correction
ships as `0.1.5-alpha.1.zw.2` under the tag `v0.1.5-alpha.1+zw.2`; downstream manifests must
point their aliases at zw.2.

## Alternatives considered

**Keep bare versions in peers and require hosts to pre-provide them.** Rejected: it makes any
standalone or partial install of the fork set fail with a message that names a package that
provably has the version — the exact support trap this incident produced.

**Pin peers to the official upstream version when the fork only adds behavior.** Rejected: the
peer would then be satisfiable by the official package, silently importing a second, divergent
implementation next to the fork instance.

## Verification

`scripts/publish-fork.spec.ts` now asserts the alias shape for all four dependency fields and
keeps the incident rationale next to the assertion (10/10 passing); `publish-fork.mjs 2 --dry-run
--base 0.1.5-alpha.1 --upstream-ref dsh-v0.1.5-alpha.1` stages the corrected set, and the zw.2
release is verified by resolving every `@crazx` package plus a plain consumer lockfile from the
registry.
