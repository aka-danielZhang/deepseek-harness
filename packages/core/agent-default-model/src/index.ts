/**
 * Default model selection for an Agent without a session-specific selection,
 * plus the per-route reasoning-effort memory that restores the effort the user
 * last explicitly chose when a model is selected again.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-config-editor'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Default model selection for Agents created without an explicit model,
     * plus the per-route reasoning-effort memory for model switches.
     */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** One remembered per-route effort: the level the user last explicitly chose. */
export interface AgentModelEffortEntry {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned effort id as it was when the choice was made. */
  effort: string
}

/** Default model selection supplied by plugin configuration. */
export interface Config {
  /** Registered provider route. */
  provider: Volatile<string>
  /** Provider-owned model id. */
  model: Volatile<string>
  /** Adapter-owned reasoning effort; omission follows the provider default. */
  reasoningEffort: Volatile<string | undefined>
  /** Remembered per-route efforts; the service is its only writer. */
  rememberedEfforts: Volatile<AgentModelEffortEntry[]>
}

/** Schema of one remembered route effort. */
const RememberedEffortSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  effort: z.string().required(),
})

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: { provider: string; model: string; reasoningEffort?: string }): ModelSelection {
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
 * each independently of any Host or transport. Each operation reads the owning
 * Config references; writes go through the configuration editor.
 */
export class AgentDefaultModelConfig extends Service {
  private saves: Promise<void> = Promise.resolve()

  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
    reasoningEffort: z.string().volatile(),
    rememberedEfforts: z.array(RememberedEffortSchema).default([]).volatile(),
  })

  constructor(private readonly ownerContext: Context, private config: Config) {
    super(ownerContext, 'agentDefaultModel')

    ownerContext.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber)) })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    const reasoningEffort = this.config.reasoningEffort.get()
    return selection({
      provider: this.config.provider.get(), model: this.config.model.get(),
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    })
  }

  /**
   * Save the complete default model selection. A deployment without a configuration
   * editor keeps its composition entry. Saves commit in submission order; a failed
   * save rejects its caller without blocking later saves. Remembered efforts ride
   * the same entry, so the write carries them through unchanged.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional profile write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const saved = this.saves.then(() => editor.edit(entry, (current) => {
      const merged: Record<string, unknown> = { ...current, provider: next.provider, model: next.model }
      if (next.reasoningEffort === undefined) delete merged.reasoningEffort
      else merged.reasoningEffort = String(next.reasoningEffort)
      return merged
    }))
    this.saves = saved.catch(() => {})
    await saved
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
    for (const remembered of this.config.rememberedEfforts.get()) {
      if (remembered.provider === provider && remembered.model === model) found = remembered.effort
    }
    return found === undefined ? undefined : ReasoningEffortId(found)
  }

  /**
   * Record the remembered effort for one route, or clear it when `effort` is
   * undefined. A deployment without a configuration editor keeps its
   * composition entry, so the call fulfills with no stored effect.
   * @param provider - registered provider route.
   * @param model - provider-owned model id.
   * @param effort - the explicitly chosen effort, or undefined to clear.
   * @returns fulfillment after the optional profile write settles.
   */
  async rememberEffort(provider: string, model: string, effort: ReasoningEffortId | undefined): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const saved = this.saves.then(() => editor.edit(entry, (current) => {
      const previous = Array.isArray(current.rememberedEfforts) ? current.rememberedEfforts : []
      const kept = previous.filter((row: { provider: string, model: string }) =>
        row.provider !== provider || row.model !== model)
      return {
        ...current,
        rememberedEfforts: effort === undefined ? kept : [...kept, { provider, model, effort: String(effort) }],
      }
    }))
    this.saves = saved.catch(() => {})
    await saved
  }
}

export default AgentDefaultModelConfig
