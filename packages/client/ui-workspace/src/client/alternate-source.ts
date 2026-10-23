/**
 * The region's live read of the `sidebar.workspaces.alternate` seat: whether
 * an entry exists and what its tab label is. One registry subscription serves
 * every consumer, and the label thunk re-reads per render so locale switches
 * follow without re-registration.
 *
 * @module @deepseek-ai/dsh-client-ui-workspace/alternate-source
 */

import type { HostObservable, SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceAlternateMeta } from './contract/slots.ts'

/** Minimal registry face this source consumes. */
interface AlternateRegistry {
  entries(key: 'sidebar.workspaces.alternate'): readonly { readonly options: { readonly label?: SlotLabel } }[]
  subscribe(key: 'sidebar.workspaces.alternate', fn: () => void): () => void
}

/** The region-facing seat source: the meta observable plus its teardown. */
export interface AlternateMetaSource {
  readonly source: HostObservable<WorkspaceAlternateMeta>
  readonly dispose: () => void
}

/** Build the seat meta observable for the region wrapper. */
export function createAlternateMetaSource(registry: AlternateRegistry): AlternateMetaSource {
  const listeners = new Set<() => void>()
  const read = (): WorkspaceAlternateMeta => {
    const first = registry.entries('sidebar.workspaces.alternate')[0]
    return {
      occupied: first !== undefined,
      label: () => resolveSlotLabel(first?.options.label) ?? '',
    }
  }
  let snapshot = read()
  const recompute = (): void => {
    snapshot = read()
    for (const listener of [...listeners]) listener()
  }
  const unsubscribeRegistry = registry.subscribe('sidebar.workspaces.alternate', recompute)
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(fn: () => void): () => void {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    },
    dispose: unsubscribeRegistry,
  }
}
