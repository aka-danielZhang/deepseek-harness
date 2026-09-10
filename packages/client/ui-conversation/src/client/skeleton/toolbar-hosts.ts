/**
 * Browser-local mirror of the desktop toolbar's portal hosts. The
 * conversation apply world subscribes to `ctx.layout`'s toolbar-host
 * registry (ui-layout) and republishes here, because React components in
 * this package reach browser-local state through module stores, not through
 * the cordis face. Elements only — nothing here is serialized or persisted;
 * a reload (or a toolbar unmount) falls back to null and the session header
 * renders in place.
 */
import type { ToolbarHosts } from '@deepseek-ai/dsh-client-ui-layout/client'

let current: ToolbarHosts | null = null
const listeners = new Set<() => void>()

/** Republish one registry snapshot (mount, remount, or null on unmount). */
export function setToolbarHosts(hosts: ToolbarHosts | null): void {
  if (current === hosts) return
  current = hosts
  for (const listener of listeners) listener()
}

/** useSyncExternalStore snapshot getter. */
export function getToolbarHosts(): ToolbarHosts | null {
  return current
}

/** useSyncExternalStore subscription; returns the unsubscriber. */
export function subscribeToolbarHosts(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
