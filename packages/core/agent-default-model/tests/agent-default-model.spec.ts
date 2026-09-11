/** Default Agent model settings layered over a real settings provider. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentDefaultModelConfig, {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_MODEL_EFFORTS_SETTINGS_NAMESPACE,
} from '../src/index.ts'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}
  failNext = false

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      return Promise.reject(new Error('synthetic settings failure'))
    }
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(): Promise<{
  ctx: Context
  settingsFiber: Context['fiber']
  settings: MemorySettings
  defaultModel: AgentDefaultModelConfig
}> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
  return {
    ctx,
    settingsFiber,
    settings: settingsFiber.ctx.settings as MemorySettings,
    defaultModel: ctx.agentDefaultModel,
  }
}

describe('AgentDefaultModelConfig', () => {
  it('resolves the user layer over the composition entry', async () => {
    const bench = await boot()
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })

    await bench.defaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: 'high',
    })
    await bench.ctx.fiber.dispose()
  })

  it('clears a stored effort when the saved selection has none', async () => {
    const bench = await boot()
    await bench.defaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    await bench.defaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-plain' })
    expect(bench.defaultModel.currentSelection()).toEqual({ provider: 'acme-gateway', model: 'acme-plain' })
    await bench.ctx.fiber.dispose()
  })

  it('layers a hand-written partial section over the entry', async () => {
    const bench = await boot()
    await bench.settingsFiber.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      model: 'deepseek-reasoner',
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-reasoner',
    })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.defaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-large' })
    expect(bench.defaultModel.currentSelection().provider).toBe('acme-gateway')
    await bench.settingsFiber.dispose()
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })
    await bench.ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })
    await ctx.agentDefaultModel.saveSelection({ provider: 'other', model: 'other' })
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'p', model: 'm' })
    await ctx.fiber.dispose()
  })
})

describe('per-route effort memory', () => {
  it('remembers and recalls an explicit effort per provider/model route', async () => {
    const bench = await boot()
    expect(bench.defaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    await bench.defaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('max'))
    await bench.defaultModel.rememberEffort('acme-gateway', 'acme-large', ReasoningEffortId('high'))
    expect(bench.defaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBe('max')
    expect(bench.defaultModel.recallEffort('acme-gateway', 'acme-large')).toBe('high')
    await bench.ctx.fiber.dispose()
  })

  it('preserves concurrent writes for different routes', async () => {
    const bench = await boot()
    await Promise.all([
      bench.defaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('max')),
      bench.defaultModel.rememberEffort('acme-gateway', 'acme-large', ReasoningEffortId('high')),
    ])
    expect(bench.defaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBe('max')
    expect(bench.defaultModel.recallEffort('acme-gateway', 'acme-large')).toBe('high')
    await bench.ctx.fiber.dispose()
  })

  it('continues the write queue after a storage failure', async () => {
    const bench = await boot()
    bench.settings.failNext = true
    await expect(bench.defaultModel.rememberEffort(
      'deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('max'),
    )).rejects.toThrow('synthetic settings failure')
    await bench.defaultModel.rememberEffort('acme-gateway', 'acme-large', ReasoningEffortId('high'))
    expect(bench.defaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    expect(bench.defaultModel.recallEffort('acme-gateway', 'acme-large')).toBe('high')
    await bench.ctx.fiber.dispose()
  })

  it('clears one route without touching the others', async () => {
    const bench = await boot()
    await bench.defaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('max'))
    await bench.defaultModel.rememberEffort('acme-gateway', 'acme-large', ReasoningEffortId('high'))
    await bench.defaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', undefined)
    expect(bench.defaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    expect(bench.defaultModel.recallEffort('acme-gateway', 'acme-large')).toBe('high')
    await bench.ctx.fiber.dispose()
  })

  it('keeps at most one entry per route and lets a hand-written duplicate last-match win', async () => {
    const bench = await boot()
    await bench.defaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('max'))
    await bench.defaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('high'))
    const stored = bench.settingsFiber.ctx.settings.get(AGENT_MODEL_EFFORTS_SETTINGS_NAMESPACE) as {
      entries: { provider: string; model: string; effort: string }[]
    }
    expect(stored.entries).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high' },
    ])
    await bench.settingsFiber.ctx.settings.replace(AGENT_MODEL_EFFORTS_SETTINGS_NAMESPACE, {
      entries: [
        { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'off' },
        { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'max' },
      ],
    })
    expect(bench.defaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBe('max')
    await bench.ctx.fiber.dispose()
  })

  it('falls back to no memory when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.defaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('max'))
    await bench.settingsFiber.dispose()
    expect(bench.defaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('keeps no memory when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })
    await ctx.agentDefaultModel.rememberEffort('p', 'm', ReasoningEffortId('high'))
    expect(ctx.agentDefaultModel.recallEffort('p', 'm')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
