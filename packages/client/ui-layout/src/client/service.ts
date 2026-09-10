/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry and main-panel selection live in the root layout store;
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (main-panel selection and sidebar toggle,
 * right-panel show/hide from ui-sidebar-right) — writes stay inside the
 * store's declared action set, shared with the root registration.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { createLayoutStore } from './stores.ts'

/** Identity shared by a sidebar panel entry and its main-slot occupant. */
export type MainPanelId = Branded<'MainPanelId'>

/** Root-scoped navigation state exposed to panel-aware components. */
export interface PanelInfo {
  /** Selected global panel; null displays the current Conversation. */
  readonly activePanelId: MainPanelId | null
}

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

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/** Panel navigation and geometry actions exposed through ctx.layout. */
export interface ILayout {
  /**
   * Select a global central panel without changing the current Session.
   * @param panelId - registered main key, or null to show the Conversation.
   * @throws if the selected main key is not registered; preserves the current selection.
   */
  selectPanel(panelId: MainPanelId | null): void
  /**
   * Start an asynchronous navigation, superseding any earlier pending navigation.
   * @returns a signal aborted by the next navigation or layout disposal; check it before committing UI state.
   */
  beginNavigation(): AbortSignal
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
  private navigation = new AbortController()
  private toolbarHosts: ToolbarHosts | null = null
  private readonly toolbarListeners = new Set<(hosts: ToolbarHosts | null) => void>()

  /**
   * @param panels - actions of the instance shared with the root entry.
   * @param hasMainPanel - checks the live main-slot registry for a panel id.
   */
  constructor(
    private readonly panels: PanelActions,
    private readonly hasMainPanel: (id: MainPanelId) => boolean,
  ) {}

  /** Select a global panel or return to the Conversation. */
  selectPanel(panelId: MainPanelId | null): void {
    if (panelId !== null && !this.hasMainPanel(panelId)) {
      throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
    }
    this.navigation.abort()
    this.panels.selectPanel(panelId)
  }

  /** @returns the new pending navigation's cancellation signal. */
  beginNavigation(): AbortSignal {
    this.navigation.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }

  /** Invalidate pending navigations when the layout owner is unloaded. */
  dispose(): void {
    this.navigation.abort()
    // Retract any toolbar registration still attributed to this controller so
    // subscribers fall back to the in-place header before the service drops.
    if (this.toolbarHosts !== null) this.releaseToolbarHosts(this.toolbarHosts)
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.panels.toggleSidebar()
  }

  /** Report the right panel's track and fullscreen presentation. */
  openRightbar(track: boolean, fullscreen: boolean): void {
    this.panels.openRightbar(track, fullscreen)
  }

  /** Report the right panel as hidden: no track, no handle. */
  closeRightbar(): void {
    this.panels.closeRightbar()
  }

  /** Publish the desktop toolbar's host pair (identity replaces wholesale). */
  setToolbarHosts(hosts: ToolbarHosts): void {
    this.toolbarHosts = hosts
    for (const listener of this.toolbarListeners) listener(hosts)
  }

  /** Release the pair only when the registry still holds THIS caller's pair. */
  releaseToolbarHosts(hosts: ToolbarHosts): void {
    if (this.toolbarHosts !== hosts) return
    this.toolbarHosts = null
    for (const listener of this.toolbarListeners) listener(null)
  }

  /** The current host pair, or null while no desktop toolbar is mounted. */
  getToolbarHosts(): ToolbarHosts | null {
    return this.toolbarHosts
  }

  /** Subscribe to toolbar-host changes; the header portals while non-null. */
  onToolbarHosts(listener: (hosts: ToolbarHosts | null) => void): () => void {
    this.toolbarListeners.add(listener)
    return () => { this.toolbarListeners.delete(listener) }
  }
}
