# Agent Note: Shell toolbar portal

Status: implemented

English | [中文](2026-09-10-shell-toolbar-portal.zh.md)

## Problem

The unified desktop toolbar — the macOS chrome whose portal targets host the session header's title cluster and rightbar corner — lived only on the `v0.1.5-alpha.1+zw.3` release tag and never entered fork master, so the `0.1.5-rc.1` upstream merge dropped it. The rc.1 layout also renamed the center seat to the keyed `main` slot and moved panel navigation onto a constructor-injected controller, so the old registry design (a package-local module store in ui-conversation read through `useSyncExternalStore`) no longer matched the client rules: business components carry no subscription machinery, and cross-package reactive facts travel through framework channels.

## Decision

ui-layout owns the whole mechanism. The frame gains a fifth child slot, `shell.toolbar`: a frame-spanning row above the three columns whose empty seat is a zero-height `auto` grid track, so an unoccupied frame renders identically to the single-row layout. The `LayoutController` holds the host registry — `setToolbarHosts`, `releaseToolbarHosts` (identity-guarded, so a stale HMR disposer never clears a newer toolbar's pair), `getToolbarHosts`, and `onToolbarHosts` — and controller disposal retracts the registration so the header falls back to its in-place form before the service drops.

The read path rides the same root channel as panel selection: `provideRoot({ hooks: { toolbarHosts } })` adapts the registry to a bare observable, and the `GlobalStandardProps` merge publishes `useToolbarHosts` as a standard selector hook. ui-conversation consumes that hook in the session header and portals the title cluster into `centerHost` and the rightbar corner into `sessionEndHost`; the header itself collapses to `display: contents`, keeping only the View-tabs row in the body. Host absence, a toolbar unmount mid-session, and blank-session hiding all render the original in-place header. The browser-local `ToolbarHosts` pair is never serialized and never crosses a Host RPC.

## Alternatives considered

**Port the alpha module store verbatim.** ui-conversation would keep its package-local `toolbar-hosts.ts` mirror read through `useSyncExternalStore`. Rejected: the current client rules forbid subscription machinery in business components and module-level store singletons, so the port would carry a known violation into a fresh architecture.

**Ship the bridge without a toolbar.** Suppress the stock rail and rely on the bridge's overlay fallback for update and notify controls. Rejected: it removes the stock sidebar toggle and New Session affordances without a replacement seat, and strands the session header's title cluster in the body on macOS.

## Consequences

The frame is a two-row grid even without an occupant; the empty row is a zero-height `auto` track, and assembled-output snapshots confirm an unoccupied frame renders identically. `useToolbarHosts` is a required member of `GlobalStandardProps`, so every component fixture that feeds full standard props passes a stub — the same rollout cost `usePanelInfo` paid. Desktop plugins that previously read the alpha `ILayout` host methods keep an unchanged service face; the read side moved from a package store to the standard hook, so the bridge's toolbar is the only writer and every consumer observes mount, remount, and unmount through one channel.

## Verification

Controller registry coverage lives in `packages/client/ui-layout/tests/service.client.spec.ts` (publish/replace/release transitions, identity guard, disposal retraction), the frame row in `app-frame.client.spec.tsx`, and the portal/fallback/blank paths in `packages/client/ui-conversation/tests/skeleton.client.spec.tsx`. `packages/client/test-support/client-runtime` mirrors the source (`runtime.toolbarHosts`) so composition tests can drive host transitions.
