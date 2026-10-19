/** Default model references remain live without a settings service. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import DefaultModel from '../src/index.ts'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

it('reads complete selections from volatile config and clears omitted reasoning effort', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const live = await liveConfig(ctx, DefaultModel, { provider: 'p', model: 'm' })
  const consumer = ctx.agentDefaultModel
  await live.update({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  expect(consumer.currentSelection()).toEqual({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  await live.replace({ provider: 'p', model: 'm' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
  await consumer.saveSelection({ provider: 'unsaved', model: 'unsaved' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
})

it('persists complete selections through its owning profile entry', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ctx } = await configurationFixture({ hmr: false })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'next', reasoningEffort: ReasoningEffortId('high') })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'next', reasoningEffort: 'high' })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'final' })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
  const standalone = new Context()
  onTestFinished(() => standalone.fiber.dispose())
  await standalone.plugin(DefaultModel, { provider: 'test', model: 'original' })
  await standalone.agentDefaultModel.saveSelection({ provider: 'test', model: 'ignored' })
  expect(standalone.agentDefaultModel.currentSelection().model).toBe('original')
})

it('serializes overlapping saves and continues after a rejected write', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ctx } = await configurationFixture({ hmr: false })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const editor = ctx.configEditor
  const edit = editor.edit.bind(editor)
  const calls: string[] = []
  const intercepted = vi.spyOn(editor, 'edit').mockImplementationOnce(async () => {
    calls.push('rejected')
    entered.resolve(undefined)
    await release.promise
    throw new Error('read-only document')
  }).mockImplementation(async (entry, change) => {
    calls.push('saved')
    await edit(entry, change)
  })
  const first = ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'rejected' })
  const failed = expect(first).rejects.toThrow('read-only document')
  const lastSelection = { provider: 'test', model: 'final' }
  const last = ctx.agentDefaultModel.saveSelection(lastSelection)
  onTestFinished(async () => {
    release.resolve(undefined)
    await Promise.allSettled([failed, last])
    intercepted.mockRestore()
  })
  lastSelection.model = 'mutated'
  await entered.promise
  expect(calls).toEqual(['rejected'])
  release.resolve(undefined)
  await failed
  await last
  expect(calls).toEqual(['rejected', 'saved'])
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
})

describe('per-route effort memory', () => {
  it('remembers and recalls an explicit effort per provider/model route', async () => {
    const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
    const { ctx } = await configurationFixture({ hmr: false })
    expect(ctx.agentDefaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    await ctx.agentDefaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('max'))
    await ctx.agentDefaultModel.rememberEffort('acme-gateway', 'acme-large', ReasoningEffortId('high'))
    expect(ctx.agentDefaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBe('max')
    expect(ctx.agentDefaultModel.recallEffort('acme-gateway', 'acme-large')).toBe('high')
  })

  it('clears one route without touching the others', async () => {
    const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
    const { ctx } = await configurationFixture({ hmr: false })
    await ctx.agentDefaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', ReasoningEffortId('max'))
    await ctx.agentDefaultModel.rememberEffort('acme-gateway', 'acme-large', ReasoningEffortId('high'))
    await ctx.agentDefaultModel.rememberEffort('deepseek-official', 'deepseek-v4-pro', undefined)
    expect(ctx.agentDefaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    expect(ctx.agentDefaultModel.recallEffort('acme-gateway', 'acme-large')).toBe('high')
  })

  it('reads hand-written duplicate entries with the last match winning', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await liveConfig(ctx, DefaultModel, {
      provider: 'p', model: 'm',
      rememberedEfforts: [
        { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'off' },
        { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'max' },
      ],
    })
    expect(ctx.agentDefaultModel.recallEffort('deepseek-official', 'deepseek-v4-pro')).toBe('max')
  })

  it('keeps no memory without a configuration editor', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(DefaultModel, { provider: 'p', model: 'm' })
    await ctx.agentDefaultModel.rememberEffort('p', 'm', ReasoningEffortId('high'))
    expect(ctx.agentDefaultModel.recallEffort('p', 'm')).toBeUndefined()
  })
})
