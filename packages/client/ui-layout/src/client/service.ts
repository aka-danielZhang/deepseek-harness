/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * right-panel show/hide from ui-sidebar-right) — writes stay inside the
 * store's declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The two portal hosts a mounted desktop toolbar offers the session header:
 * `centerHost` receives the title/lineage/actions/utilities cluster,
 * `sessionEndHost` receives the rightbar corner so it stays the trailing
 * item. Browser-local DOM elements only — never serialized, never sent
 * through any Host RPC.
 */
export interface ToolbarHosts {
  readonly centerHost: HTMLElement
  readonly sessionEndHost: HTMLElement
}

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger, plus the toolbar host registry the session header
 * portals into — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /**
   * Report the right panel's presentation without changing its expanded state.
   * @param track - whether the normal panel width reserves a grid track,
   *   including beneath a fullscreen overlay.
   * @param fullscreen - whether the panel covers the frame and hides its outer
   *   resize handle; independent of the underlying grid track.
   */
  openRightbar(track: boolean, fullscreen: boolean): void
  /** Report the right panel as hidden: no track, no handle. */
  closeRightbar(): void
  /**
   * Publish the desktop toolbar's freshly mounted host pair, replacing any
   * previous registration and notifying subscribers.
   * @param hosts - the mounted host pair (both nodes attached).
   */
  setToolbarHosts(hosts: ToolbarHosts): void
  /**
   * Release a previously published pair. Identity-guarded by reference
   * equality: a stale HMR disposer releasing its OWN pair never clears a
   * newer toolbar's registration.
   * @param hosts - the exact pair this caller published.
   */
  releaseToolbarHosts(hosts: ToolbarHosts): void
  /** The current host pair, or null while no desktop toolbar is mounted. */
  getToolbarHosts(): ToolbarHosts | null
  /**
   * Subscribe to toolbar-host changes (mount, remount, unmount).
   * @param listener - called with the new pair, or null when the header must
   *   return to its in-place fallback.
   * @returns the unsubscriber.
   */
  onToolbarHosts(listener: (hosts: ToolbarHosts | null) => void): () => void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  #toolbarHosts: ToolbarHosts | null = null
  readonly #toolbarListeners = new Set<(hosts: ToolbarHosts | null) => void>()

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Report the right panel's track and fullscreen presentation. */
  openRightbar(track: boolean, fullscreen: boolean): void {
    this.#require().openRightbar(track, fullscreen)
  }

  /** Report the right panel as hidden: no track, no handle. */
  closeRightbar(): void {
    this.#require().closeRightbar()
  }

  /** Publish the desktop toolbar's host pair (identity replaces wholesale). */
  setToolbarHosts(hosts: ToolbarHosts): void {
    this.#toolbarHosts = hosts
    for (const listener of this.#toolbarListeners) listener(hosts)
  }

  /** Release the pair only when the registry still holds THIS caller's pair. */
  releaseToolbarHosts(hosts: ToolbarHosts): void {
    if (this.#toolbarHosts !== hosts) return
    this.#toolbarHosts = null
    for (const listener of this.#toolbarListeners) listener(null)
  }

  /** The current host pair, or null while no desktop toolbar is mounted. */
  getToolbarHosts(): ToolbarHosts | null {
    return this.#toolbarHosts
  }

  /** Subscribe to toolbar-host changes; the header portals while non-null. */
  onToolbarHosts(listener: (hosts: ToolbarHosts | null) => void): () => void {
    this.#toolbarListeners.add(listener)
    return () => { this.#toolbarListeners.delete(listener) }
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
