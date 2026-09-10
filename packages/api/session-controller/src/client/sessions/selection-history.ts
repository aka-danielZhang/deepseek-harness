/**
 * Bounded transient selection history behind the desktop toolbar's
 * back/forward navigation. Entries record WHICH selection was made — a
 * listed session, an addressed subagent, or the cleared no-session state —
 * never when, and never any session content. Browser-local and transient by
 * design: nothing here is persisted, so a reload starts empty.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'

/** One selection-history entry; `sessionId: undefined` is the cleared state. */
export interface SelectionEntry {
  readonly sessionId?: SessionId
  /** Retained direct-parent address for an addressed subagent selection. */
  readonly address?: SubagentAddress
}

function sameSelection(left: SelectionEntry, right: SelectionEntry): boolean {
  return left.sessionId === right.sessionId
    && left.address?.parentSessionId === right.address?.parentSessionId
    && left.address?.childSessionId === right.address?.childSessionId
}

/**
 * Bounded LIFO-with-cursor history. Recording a selection made outside
 * navigation collapses consecutive repeats, truncates the forward tail after
 * a backtrack, and drops the oldest entry past the bound. Pruning removes
 * deleted sessions wherever they sit and re-points the cursor onto the same
 * logical position.
 */
export class SelectionHistory {
  /** Oldest-first; the cursor sits ON the current entry (-1 while empty). */
  readonly #entries: SelectionEntry[] = []
  #cursor = -1

  constructor(private readonly limit = 50) {}

  get entries(): readonly SelectionEntry[] {
    return this.#entries
  }

  get cursor(): number {
    return this.#cursor
  }

  /** Whether an older entry exists to go back to. */
  canBack(): boolean {
    return this.#cursor > 0
  }

  /** Whether a newer entry exists to go forward to. */
  canForward(): boolean {
    return this.#cursor < this.#entries.length - 1
  }

  /**
   * Record one selection made outside history navigation.
   * @param entry - the selection (session, addressed subagent, or clear).
   */
  record(entry: SelectionEntry): void {
    const current = this.#entries[this.#cursor]
    if (current !== undefined && sameSelection(current, entry)) return
    this.#entries.length = this.#cursor + 1
    this.#entries.push(entry)
    if (this.#entries.length > this.limit) this.#entries.shift()
    this.#cursor = this.#entries.length - 1
  }

  /**
   * Step one entry back.
   * @returns the entry to replay, or undefined at the oldest bound.
   */
  back(): SelectionEntry | undefined {
    if (!this.canBack()) return undefined
    this.#cursor -= 1
    const entry = this.#entries[this.#cursor]
    return entry
  }

  /**
   * Step one entry forward.
   * @returns the entry to replay, or undefined at the newest bound.
   */
  forward(): SelectionEntry | undefined {
    if (!this.canForward()) return undefined
    this.#cursor += 1
    const entry = this.#entries[this.#cursor]
    return entry
  }

  /**
   * Drop every entry referencing the removed session wherever it sits,
   * keeping the cursor on the same logical position.
   * @param sessionId - the removed session.
   */
  prune(sessionId: SessionId): void {
    let removedBeforeCursor = 0
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index]
      if (entry === undefined || entry.sessionId !== sessionId) continue
      this.#entries.splice(index, 1)
      if (index <= this.#cursor) removedBeforeCursor += 1
    }
    this.#cursor -= removedBeforeCursor
    if (this.#cursor > this.#entries.length - 1) this.#cursor = this.#entries.length - 1
  }
}
