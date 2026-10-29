import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** A contributor-owned predicate for whether one Session belongs in Workspace browsing views. */
export type WorkspaceSessionVisibilityFilter = (session: SessionSummary) => boolean

/** Registered Session visibility predicates with live revision publication. */
export class WorkspaceSessionVisibility {
  private readonly filters = new Set<{ readonly accept: WorkspaceSessionVisibilityFilter }>()

  /** Changes after every registration and disposal so browsing views rederive their rows. */
  readonly revision = createSnapshotStore(0)

  /** Evaluate every current predicate without subscribing the caller. */
  readonly accept = (session: SessionSummary): boolean => {
    for (const filter of this.filters) {
      if (!filter.accept(session)) return false
    }
    return true
  }

  /**
   * Add one predicate and publish the change immediately.
   * @param filter - false hides the Session from grouped, flat, and search views.
   * @returns an idempotent disposer that removes only this registration.
   */
  register(filter: WorkspaceSessionVisibilityFilter): () => void {
    const entry = { accept: filter }
    this.filters.add(entry)
    this.publish()
    let active = true
    return () => {
      if (!active) return
      active = false
      this.filters.delete(entry)
      this.publish()
    }
  }

  private publish(): void {
    this.revision.set(this.revision.getSnapshot() + 1)
  }
}
