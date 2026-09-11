import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import { aggregateUsage } from '@deepseek-ai/dsh-compaction-basic/src/hierarchical.ts'
import {
  mapInstruction,
  reduceInstruction,
  SUMMARY_SECTIONS,
} from '@deepseek-ai/dsh-compaction-basic/src/hierarchical-prompts.ts'
import LlmRuntime, {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  createSystemMessage,
  createUserMessage,
  LlmAdapter,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmResolvedModelInfo,
  Message,
  StreamChunk,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'

const PROVIDER = 'hierarchy-test'
const MODEL = 'small-context'
const SIGNAL = new AbortController().signal
const STRUCTURED = SUMMARY_SECTIONS.map(section => `## ${section}\n- retained`).join('\n\n')

type OverflowWhen = (options: GenerateOptions, index: number) => boolean

class SummaryAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = []
  readonly outcomes: Array<'overflow' | 'success'> = []
  private remainingOverflows: number

  constructor(
    private readonly contextWindow: number | undefined,
    private readonly output = STRUCTURED,
    overflows = 0,
    private readonly overflowWhen: OverflowWhen = () => false,
    private readonly behavior: {
      failureCode?: string
      finish?: 'stop' | 'max-tokens'
      image?: boolean
      omitUsage?: boolean
    } = {},
  ) {
    super()
    this.remainingOverflows = overflows
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.contextWindow === undefined ? {} : { context: { contextWindow: this.contextWindow } },
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const index = this.calls.length
    this.calls.push(options)
    if (this.remainingOverflows > 0 || this.overflowWhen(options, index)) {
      this.remainingOverflows -= this.remainingOverflows > 0 ? 1 : 0
      this.outcomes.push('overflow')
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: CONTEXT_WINDOW_EXCEEDED_CODE,
            message: 'simulated context overflow',
          },
        },
      }
      return
    }
    if (this.behavior.failureCode !== undefined) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { code: this.behavior.failureCode, message: 'simulated stage failure' },
        },
      }
      return
    }
    this.outcomes.push('success')
    if (this.behavior.image === true) {
      yield { type: 'block-start', index: 0, blockType: 'image' }
      yield {
        type: 'block-end',
        index: 0,
        block: {
          type: 'image',
          attachment: {
            attachmentId: AttachmentId(`sha256:${'d'.repeat(64)}`),
            mediaType: 'image/png',
            bytes: 1,
            width: 1,
            height: 1,
          },
        },
      }
    } else {
      yield { type: 'text-delta', index: 0, text: this.output }
    }
    if (this.behavior.omitUsage !== true) {
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 } }
    }
    yield { type: 'finish', reason: { kind: this.behavior.finish ?? 'stop' } }
  }
}

class ExposedEngine extends BasicCompactionEngine {
  run(messages: readonly Message[], owner: Agent) {
    return this.summarize({ messages }, owner, SIGNAL)
  }

  runInput(input: {
    messages: readonly Message[]
    tools?: readonly ToolSchema[]
  }, owner: Agent) {
    return this.summarize(input, owner, SIGNAL)
  }

  runWithoutSignal(messages: readonly Message[], owner: Agent) {
    return this.summarize({ messages }, owner)
  }

  runWithSignal(messages: readonly Message[], owner: Agent, signal: AbortSignal) {
    return this.summarize({ messages }, owner, signal)
  }
}

function fixture(options: {
  contextWindow?: number
  output?: string
  overflows?: number
  replayTools?: boolean
  overflowWhen?: OverflowWhen
  maxDepth?: number
  behavior?: {
    failureCode?: string
    finish?: 'stop' | 'max-tokens'
    image?: boolean
    omitUsage?: boolean
  }
} = {}) {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  new SessionProjectionRegistry(ctx)
  void new TokenMeter(ctx)
  const adapter = new SummaryAdapter(
    options.contextWindow === undefined ? 1800 : options.contextWindow,
    options.output,
    options.overflows,
    options.overflowWhen,
    options.behavior,
  )
  ctx.llm.registerAdapter([PROVIDER], adapter)
  const engine = new ExposedEngine(ctx, {
    auto: false,
    summarizationProvider: PROVIDER,
    summarizationModel: MODEL,
    chunkInputRatio: 0.5,
    maxTokens: 256,
    mapMaxTokens: 128,
    reduceMaxTokens: 256,
    maxDepth: options.maxDepth ?? 3,
    replayTools: options.replayTools ?? false,
  })
  const session = Session.create(SessionId('hierarchical-engine-test'))
  const owner = {
    session,
    options: { provider: PROVIDER, model: MODEL },
  } as Agent
  return { adapter, engine, owner, session }
}

function noCapacityFixture(overflows = 0, failureCode?: string) {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  new SessionProjectionRegistry(ctx)
  void new TokenMeter(ctx)
  const adapter = new SummaryAdapter(
    undefined,
    STRUCTURED,
    overflows,
    undefined,
    failureCode === undefined ? {} : { failureCode },
  )
  ctx.llm.registerAdapter([PROVIDER], adapter)
  const engine = new ExposedEngine(ctx, {
    auto: false,
    summarizationProvider: PROVIDER,
    summarizationModel: MODEL,
  })
  const owner = {
    session: Session.create(SessionId('no-capacity')),
    options: { provider: PROVIDER, model: MODEL },
  } as Agent
  return { adapter, engine, owner }
}

function user(text: string): Message {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function instruction(options: GenerateOptions): string {
  const block = options.messages.at(-1)?.content.find(candidate => candidate.type === 'text')
  return block?.type === 'text' ? block.text : ''
}

function sourceRange(options: GenerateOptions): [number, number] | null {
  const match = /source units (\d+)-(\d+) of \d+/.exec(instruction(options))
  return match === null ? null : [Number(match[1]), Number(match[2])]
}

function isReduce(options: GenerateOptions): boolean {
  return instruction(options).includes('reduce round')
}

function partialCount(options: GenerateOptions): number {
  return options.messages.filter(message => message.content.some(block => (
    block.type === 'text' && block.text.includes('<partial-summary')
  ))).length
}

describe('hierarchical compaction fallback', () => {
  it('preserves the stock one-shot request for fitting input', async () => {
    const { adapter, engine, owner, session } = fixture()
    const result = await engine.run([user('small')], owner)
    expect(adapter.calls).toHaveLength(1)
    expect(result.llmStreamCall).toBe(true)
    expect(adapter.calls[0]?.purpose).toBe('compaction')
    expect(adapter.calls[0]?.sessionId).toBe(session.id)
    expect(instruction(adapter.calls[0] as GenerateOptions)).toContain('acting as a compaction engine')
  })

  it('preserves one system head exactly once on the fitting one-shot path', async () => {
    const { adapter, engine, owner } = fixture()
    const systemHead = createSystemMessage('fixed system head', 'test-system')
    await engine.runInput({ messages: [systemHead, user('small')] }, owner)

    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]).not.toHaveProperty('system')
    expect(adapter.calls[0]?.messages[0]).toBe(systemHead)
    expect(adapter.calls[0]?.messages.filter(message => message.id === systemHead.id)).toHaveLength(1)
  })

  it('preserves one-shot behavior when the adapter omits capacity metadata', async () => {
    const { adapter, engine, owner } = noCapacityFixture()
    await expect(engine.run([user('small')], owner)).resolves.toMatchObject({ llmStreamCall: true })
    expect(adapter.calls).toHaveLength(1)
  })

  it('reports missing capacity only after an unbounded one-shot overflows', async () => {
    const { adapter, engine, owner } = noCapacityFixture(1)
    await expect(engine.run([user('small')], owner)).rejects.toThrow(/declares no positive integer context capacity/)
    expect(adapter.calls).toHaveLength(1)
  })

  it('preserves non-overflow failures when capacity is missing or one-shot fits', async () => {
    const missing = noCapacityFixture(0, 'SERVER')
    await expect(missing.engine.run([user('small')], missing.owner)).rejects.toMatchObject({
      code: 'SERVER',
    })
    const fitting = fixture({ behavior: { failureCode: 'SERVER' } })
    await expect(fitting.engine.run([user('small')], fitting.owner)).rejects.toMatchObject({
      code: 'SERVER',
    })
  })

  it('rejects invalid capacity metadata and already-aborted work before streaming', async () => {
    const invalid = fixture({ contextWindow: 0 })
    await expect(invalid.engine.run([user('small')], invalid.owner)).rejects.toThrow(/invalid context metadata/)
    expect(invalid.adapter.calls).toHaveLength(0)

    const aborted = fixture()
    const controller = new AbortController()
    controller.abort(new Error('cancelled before compaction'))
    await expect(aborted.engine.runWithSignal([user('small')], aborted.owner, controller.signal))
      .rejects.toThrow(/cancelled before compaction/)
    expect(aborted.adapter.calls).toHaveLength(0)
  })

  it('runs hierarchy without an optional cancellation signal', async () => {
    const { adapter, engine, owner } = fixture()
    const messages = Array.from({ length: 5 }, () => user('x'.repeat(1200)))
    await expect(engine.runWithoutSignal(messages, owner)).resolves.toBeDefined()
    expect(adapter.calls.length).toBeGreaterThan(1)
    expect(adapter.calls.every(call => call.signal === undefined)).toBe(true)
  })

  it('falls back after provider-confirmed one-shot overflow without claiming complete usage', async () => {
    const { adapter, engine, owner } = fixture({ overflows: 1 })
    const result = await engine.run([user('small')], owner)
    expect(adapter.calls).toHaveLength(2)
    expect(result.llmStreamCall).toBeUndefined()
    expect(result.maxTokens).toBe(128)
    expect(result.usage).toBeUndefined()
  })

  it('terminates when one provider-rejected map unit is indivisible', async () => {
    const { adapter, engine, owner } = fixture({ overflows: 2 })
    await expect(engine.run([user('small')], owner))
      .rejects.toThrow(/map source unit 1.*provider context window.*indivisible/)
    expect(adapter.outcomes).toEqual(['overflow', 'overflow'])
  })

  it('maps oversized input, reduces partials, and aggregates complete usage', async () => {
    const { adapter, engine, owner, session } = fixture()
    const messages = Array.from({ length: 5 }, (_, index) => user(`${index}: ${'x'.repeat(1200)}`))
    const result = await engine.run(messages, owner)

    expect(adapter.calls.length).toBeGreaterThanOrEqual(3)
    expect(result.llmStreamCall).toBeUndefined()
    expect(result.usage).toEqual({
      inputTokens: adapter.calls.length * 10,
      outputTokens: adapter.calls.length * 5,
      cacheReadTokens: adapter.calls.length * 2,
    })
    expect(result).toMatchObject({ provider: PROVIDER, model: MODEL, maxTokens: 256 })
    expect(adapter.calls.every(call => call.purpose === 'compaction')).toBe(true)
    expect(adapter.calls.every(call => call.sessionId === session.id)).toBe(true)
    expect(adapter.calls.some(call => isReduce(call))).toBe(true)
  })

  it('replays the fixed system head once per stage without promoting a later system update', async () => {
    const { adapter, engine, owner } = fixture()
    const systemHead = createSystemMessage('fixed system head', 'test-system')
    const dynamicSystem = createSystemMessage('dynamic system update '.repeat(50), 'test-system')
    const source = [
      user(`first ${'x'.repeat(1200)}`),
      dynamicSystem,
      ...Array.from({ length: 4 }, (_, index) => user(`${index}: ${'x'.repeat(1200)}`)),
    ]
    await engine.runInput({ messages: [systemHead, ...source] }, owner)

    expect(adapter.calls.length).toBeGreaterThan(1)
    for (const call of adapter.calls) {
      expect(call).not.toHaveProperty('system')
      expect(call.messages[0]).toBe(systemHead)
      expect(call.messages.filter(message => message.id === systemHead.id)).toHaveLength(1)
    }
    const mapCalls = adapter.calls.filter(call => !isReduce(call))
    expect(mapCalls.flatMap(call => call.messages)
      .filter(message => message.id === dynamicSystem.id)).toEqual([dynamicSystem])
    const dynamicCall = mapCalls.find(call => call.messages.some(message => message.id === dynamicSystem.id))
    expect(dynamicCall?.messages[0]).toBe(systemHead)
    expect(dynamicCall?.messages.indexOf(dynamicSystem)).toBeGreaterThan(0)
    expect(adapter.calls.filter(isReduce)
      .some(call => call.messages.some(message => message.id === dynamicSystem.id))).toBe(false)
  })

  it('splits provider-rejected map spans without replaying successful leaves', async () => {
    const { adapter, engine, owner } = fixture({
      overflowWhen: options => !isReduce(options)
        && (sourceRange(options)?.[1] ?? 0) > (sourceRange(options)?.[0] ?? 0),
    })
    const messages = Array.from({ length: 5 }, (_, index) => user(`${index}: ${'x'.repeat(1200)}`))
    const result = await engine.run(messages, owner)
    const attempts = adapter.calls.map((call, index) => ({
      range: sourceRange(call),
      outcome: adapter.outcomes[index],
      reduce: isReduce(call),
    })).filter(attempt => !attempt.reduce && attempt.range !== null)
    expect(attempts.filter(attempt => attempt.outcome === 'success').map(attempt => attempt.range))
      .toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]])
    expect(attempts.filter(attempt => attempt.range?.[0] === 1 && attempt.range[1] === 1))
      .toHaveLength(1)
    expect(result.usage).toBeUndefined()
  })

  it('replays tool schemas only when configured', async () => {
    const tools: ToolSchema[] = [{
      name: 'read',
      description: 'Read one file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }]
    const messages = Array.from({ length: 5 }, () => user('x'.repeat(1200)))
    const omitted = fixture()
    await omitted.engine.runInput({
      messages: [createSystemMessage('hierarchy system', 'test'), ...messages],
      tools,
    }, omitted.owner)
    expect(omitted.adapter.calls.every(call => call.tools === undefined)).toBe(true)
    expect(omitted.adapter.calls.every(call => call.messages[0]?.role === 'system')).toBe(true)

    const replayed = fixture({ replayTools: true })
    await replayed.engine.runInput({ messages, tools }, replayed.owner)
    expect(replayed.adapter.calls.every(call => call.tools?.[0]?.name === 'read')).toBe(true)
  })

  it('splits a provider-rejected reduce span and stops a no-progress retry', async () => {
    let rejected = false
    const recoverable = fixture({
      overflowWhen: (options) => {
        if (!rejected && isReduce(options)) {
          rejected = true
          return true
        }
        return false
      },
    })
    const messages = Array.from({ length: 5 }, (_, index) => user(`${index}: ${'x'.repeat(1200)}`))
    const result = await recoverable.engine.run(messages, recoverable.owner)
    expect(rejected).toBe(true)
    expect(result.usage).toBeUndefined()

    const blocked = fixture({ overflowWhen: options => isReduce(options) && partialCount(options) > 1 })
    await expect(blocked.engine.run(messages, blocked.owner))
      .rejects.toThrow(/reduce round 1 made no progress after adaptive splitting/)
    expect(blocked.adapter.calls.some(call => instruction(call).includes('reduce round 2'))).toBe(false)
  })

  it('lets cancellation win over an overflow during a reduce stage', async () => {
    const controller = new AbortController()
    const subject = fixture({
      overflowWhen: (options) => {
        if (!isReduce(options)) return false
        controller.abort(new Error('cancelled during reduce'))
        return true
      },
    })
    const messages = Array.from({ length: 5 }, () => user('x'.repeat(1200)))
    await expect(subject.engine.runWithSignal(messages, subject.owner, controller.signal))
      .rejects.toThrow(/simulated context overflow/)
  })

  it('rejects malformed hierarchy output before returning a checkpoint', async () => {
    const { engine, owner } = fixture({ output: 'not a structured checkpoint' })
    const messages = Array.from({ length: 5 }, () => user('x'.repeat(1200)))
    await expect(engine.run(messages, owner)).rejects.toThrow(/required heading/)
  })

  it('identifies a reduce round whose partial output exceeds its input budget', async () => {
    const oversized = SUMMARY_SECTIONS
      .map(section => `## ${section}\n${'x'.repeat(2000)}`)
      .join('\n\n')
    const { engine, owner } = fixture({ output: oversized })
    const messages = Array.from({ length: 5 }, () => user('x'.repeat(1200)))
    await expect(engine.run(messages, owner)).rejects.toThrow(/reduce round 1:.*indivisible/)
  })

  it('fails closed on truncated or image hierarchy output', async () => {
    const messages = Array.from({ length: 5 }, () => user('x'.repeat(1200)))
    const truncated = fixture({ behavior: { finish: 'max-tokens' } })
    await expect(truncated.engine.run(messages, truncated.owner)).rejects.toMatchObject({
      code: 'MAX_TOKENS',
    })
    const image = fixture({ behavior: { image: true } })
    await expect(image.engine.run(messages, image.owner)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    })
  })

  it('omits aggregate usage when one successful hierarchy stage omits it', async () => {
    const { engine, owner } = fixture({ behavior: { omitUsage: true } })
    const messages = Array.from({ length: 5 }, () => user('x'.repeat(1200)))
    const result = await engine.run(messages, owner)
    expect(result.usage).toBeUndefined()
  })

  it('bounds recursive reduction depth and indivisible reduce overflow', async () => {
    const messages = Array.from({ length: 30 }, () => user('x'.repeat(1200)))
    const shallow = fixture({ maxDepth: 1 })
    await expect(shallow.engine.run(messages, shallow.owner)).rejects.toThrow(/did not converge within 1 round/)

    const atomic = fixture({ overflowWhen: options => isReduce(options) })
    await expect(atomic.engine.run(messages, atomic.owner))
      .rejects.toThrow(/reduce round 1 partial.*provider context window.*indivisible/)
  })

  it('fails when fixed hierarchy input leaves no message budget', async () => {
    const { engine, owner } = fixture({ replayTools: true })
    const messages = Array.from({ length: 5 }, () => user('x'.repeat(1200)))
    await expect(engine.runInput({
      messages: [createSystemMessage('s'.repeat(20_000), 'test'), ...messages],
    }, owner)).rejects.toThrow(/system\/tools\/instruction.*above/)
  })

  it('prices the widest source coordinates for multi-digit map spans', async () => {
    const totalUnits = 12
    const { adapter, engine, owner } = fixture()
    const messages = Array.from(
      { length: totalUnits },
      (_, index) => user(`${index}: ${'x'.repeat(1200)}`),
    )
    await engine.run(messages, owner)
    let sawDoubleDigit = false
    for (const call of adapter.calls) {
      const text = instruction(call)
      const range = /source units (\d+)-(\d+) of (\d+)/.exec(text)
      expect(range).not.toBeNull()
      const start = Number(range?.[1])
      const end = Number(range?.[2])
      const total = Number(range?.[3])
      expect(total).toBe(totalUnits)
      sawDoubleDigit ||= start >= 10 || end >= 10
      const round = /reduce round (\d+)/.exec(text)?.[1]
      const widest = round === undefined
        ? mapInstruction(totalUnits, totalUnits, totalUnits)
        : reduceInstruction(Number(round), totalUnits, totalUnits, totalUnits)
      expect(text.length).toBeLessThanOrEqual(widest.length)
    }
    expect(sawDoubleDigit).toBe(true)
  })

  it('fails an incompatible stage output reserve before streaming hierarchy calls', async () => {
    const ctx = new Context()
    void new LlmRuntime(ctx)
    new SessionProjectionRegistry(ctx)
    void new TokenMeter(ctx)
    const adapter = new SummaryAdapter(1000)
    ctx.llm.registerAdapter([PROVIDER], adapter)
    const engine = new ExposedEngine(ctx, {
      auto: false,
      summarizationProvider: PROVIDER,
      summarizationModel: MODEL,
      chunkInputRatio: 0.9,
      maxTokens: 200,
      mapMaxTokens: 200,
      reduceMaxTokens: 200,
    })
    const owner = {
      session: Session.create(SessionId('bad-reserve')),
      options: { provider: PROVIDER, model: MODEL },
    } as Agent
    await expect(engine.run([user('x'.repeat(5000))], owner)).rejects.toThrow(/output reserve/)
    expect(adapter.calls).toHaveLength(0)
  })

  it('does not require an unused reduce reserve for a single map result', async () => {
    const ctx = new Context()
    void new LlmRuntime(ctx)
    new SessionProjectionRegistry(ctx)
    void new TokenMeter(ctx)
    const adapter = new SummaryAdapter(1000)
    ctx.llm.registerAdapter([PROVIDER], adapter)
    const engine = new ExposedEngine(ctx, {
      auto: false,
      summarizationProvider: PROVIDER,
      summarizationModel: MODEL,
      chunkInputRatio: 0.5,
      maxTokens: 900,
      mapMaxTokens: 100,
      reduceMaxTokens: 600,
    })
    const owner = {
      session: Session.create(SessionId('single-map-reserve')),
      options: { provider: PROVIDER, model: MODEL },
    } as Agent
    await expect(engine.run([user('small')], owner)).resolves.toMatchObject({
      maxTokens: 100,
      llmStreamCall: true,
    })
    expect(adapter.calls).toHaveLength(1)
  })

  it('uses model-specific hierarchy and one-shot caps', async () => {
    const ctx = new Context()
    void new LlmRuntime(ctx)
    new SessionProjectionRegistry(ctx)
    void new TokenMeter(ctx)
    const adapter = new SummaryAdapter(2400)
    ctx.llm.registerAdapter([PROVIDER], adapter)
    const engine = new ExposedEngine(ctx, {
      auto: false,
      summarizationProvider: PROVIDER,
      summarizationModel: MODEL,
      chunkInputRatio: 0.5,
      maxTokens: 256,
      mapMaxTokens: 128,
      reduceMaxTokens: 256,
      modelPolicies: [{
        provider: PROVIDER,
        model: MODEL,
        maxTokens: 2300,
        chunkInputRatio: 0.4,
        mapMaxTokens: 64,
      }],
    })
    const owner = {
      session: Session.create(SessionId('model-policy-reserve')),
      options: { provider: PROVIDER, model: MODEL },
    } as Agent
    const result = await engine.run([user('small')], owner)
    expect(adapter.calls).toHaveLength(1)
    expect(result.llmStreamCall).toBe(true)
    expect(result.maxTokens).toBe(64)
  })

  it('aggregates usage only when every stage reports it', () => {
    expect(aggregateUsage([])).toBeUndefined()
    expect(aggregateUsage([{ inputTokens: 2, outputTokens: 3 }, undefined])).toBeUndefined()
    expect(aggregateUsage([
      { inputTokens: 2, outputTokens: 3, cacheWriteTokens: 13 },
      { inputTokens: 5, outputTokens: 7, reasoningTokens: 11, cacheWriteTokens: 17 },
    ])).toEqual({
      inputTokens: 7,
      outputTokens: 10,
      reasoningTokens: 11,
      cacheWriteTokens: 30,
    })
  })
})
