/**
 * Observable connection state of one mcp-client instance and the Cordis event
 * that publishes it. Types only — the connection supervisor in `connection.ts`
 * owns the runtime state and emits at each commit point.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

/** Connection state of one supervised MCP server connection. */
export type McpClientStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'disposed'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One MCP server connection reached a new committed state, or its live
     * tool registration count changed. Emitted only after the supervisor
     * mutated its state, never before. The emitting fiber's context and every
     * ancestor context observe this through the shared event bus; `serverName`
     * disambiguates concurrent instances. Listener failures are contained and
     * logged by the emitter, so an observer defect cannot disrupt the
     * supervisor's own state machine.
     * @param serverName - the configured namespace of the emitting instance.
     * @param status - the connection state at this commit point.
     * @param toolCount - number of tools this server currently has registered on `ctx.tools`.
     * @mode emit
     */
    'mcp-client/status'(serverName: string, status: McpClientStatus, toolCount: number): void
  }
}
