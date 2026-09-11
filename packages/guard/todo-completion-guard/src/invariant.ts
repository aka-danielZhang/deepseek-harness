/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-todo-completion-guard`.
 * @module @deepseek-ai/dsh-todo-completion-guard/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-todo-completion-guard'

/** Cordis companion plugin name. */
export const name = 'todo-completion-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the reminded-turn state is private to one turn-stopping
 * listener, and the steered notices it produces are already source-attributed
 * `user/message` events in the session log — no package-owned event or snapshot
 * exists for an independent companion to observe.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
