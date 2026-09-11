/**
 * Default model selection for an Agent without a session-specific selection,
 * plus the per-route reasoning-effort memory that restores the effort the user
 * last explicitly chose when a model is selected again.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Default model selection for Agents created without an explicit model,
     * plus the per-route reasoning-effort memory for model switches.
     */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'

/** Settings namespace carrying the per-route reasoning-effort memory. */
export const AGENT_MODEL_EFFORTS_SETTINGS_NAMESPACE = 'agent-model-efforts'

/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** One remembered per-route effort: the level the user last explicitly chose. */
export interface AgentModelEffortEntry {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned effort id as it was when the choice was made. */
  effort: string
}

/** Stored per-route reasoning-effort memory; the service is its only writer. */
export interface AgentModelEffortsSettings {
  /** Remembered choices; at most one entry per provider/model route. */
  entries: AgentModelEffortEntry[]
}

/** Schema of the per-route reasoning-effort memory section. */
export const AGENT_MODEL_EFFORTS_SETTINGS_SCHEMA: z<AgentModelEffortsSettings> = z.object({
  entries: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    effort: z.string().required(),
  })).default([]),
})

/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: AgentDefaultModelSettings): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection and the per-route reasoning-effort memory,
 * each independently of any Host or transport. The composition entries remain
 * usable without a settings provider; when one is mounted, the user layer of
 * each namespace is read live.
 */
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  private source: () => AgentDefaultModelSettings
  private effortsSource: () => AgentModelEffortsSettings

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentDefaultModel')
    const entry: AgentDefaultModelSettings = { provider: config.provider, model: config.model }
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
        setSource: (current) => { this.source = current },
        // Every consumer reads through currentSelection(), so no registration-level fact
        // needs rebuilding when the settings document changes.
        onChange: () => {},
      })
    })
    const effortsEntry: AgentModelEffortsSettings = { entries: [] }
    this.effortsSource = () => effortsEntry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, AGENT_MODEL_EFFORTS_SETTINGS_NAMESPACE, AGENT_MODEL_EFFORTS_SETTINGS_SCHEMA, effortsEntry, {
        setSource: (current) => { this.effortsSource = current },
        // recallEffort() reads through effortsSource(), so no registration-level
        // fact needs rebuilding when the settings document changes.
        onChange: () => {},
      })
    })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    return selection(this.source())
  }

  /**
   * Save the complete default model selection. A deployment without a settings
   * provider keeps its composition entry.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    })
  }

  /**
   * Recall the effort last explicitly chosen on one provider/model route.
   * A hand-edited document may carry duplicate entries; the last match wins,
   * matching the append order {@link rememberEffort} maintains.
   * @param provider - registered provider route.
   * @param model - provider-owned model id.
   * @returns the remembered effort, or undefined when the route has none.
   */
  recallEffort(provider: string, model: string): ReasoningEffortId | undefined {
    let found: string | undefined
    for (const entry of this.effortsSource().entries) {
      if (entry.provider === provider && entry.model === model) found = entry.effort
    }
    return found === undefined ? undefined : ReasoningEffortId(found)
  }

  /**
   * Record the remembered effort for one route, or clear it when `effort` is
   * undefined. A deployment without a settings provider keeps its composition
   * entry, so the call fulfills with no stored effect.
   * @param provider - registered provider route.
   * @param model - provider-owned model id.
   * @param effort - the explicitly chosen effort, or undefined to clear.
   * @returns fulfillment after the optional settings write settles.
   */
  async rememberEffort(provider: string, model: string, effort: ReasoningEffortId | undefined): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_MODEL_EFFORTS_SETTINGS_NAMESPACE, {
      entries: [
        ...this.effortsSource().entries.filter(entry => entry.provider !== provider || entry.model !== model),
        ...effort === undefined ? [] : [{ provider, model, effort: String(effort) }],
      ],
    })
  }
}

export default AgentDefaultModelConfig
