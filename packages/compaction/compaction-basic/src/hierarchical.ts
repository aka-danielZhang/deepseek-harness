/** Bounded map-reduce fallback for oversized compaction inputs. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  BlockAssembler,
  contentHasImage,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  createUserMessage,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  Message,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type {
  ResolvedConfig,
  ResolvedHierarchyConfig,
  ResolvedTargetPolicy,
} from './types.ts'
import { COMPACTION_INSTRUCTION } from './summarizer.ts'
import type { SummarizationInput, SummaryResult } from './summarizer.ts'
import {
  estimateMessages,
  OversizedCompactionUnitError,
  planMessageChunks,
  splitMessageChunk,
  toolBalancedUnits,
} from './hierarchical-planner.ts'
import {
  framePartialSummary,
  mapInstruction,
  reduceInstruction,
  validateStructuredSummary,
} from './hierarchical-prompts.ts'

const PLUGIN_ID = 'dsh-compaction-basic'
const CHARS_PER_TOKEN = 4
const ENVELOPE_OVERHEAD = 4

type TextBlock = Extract<ContentBlock, { type: 'text' }>

type OneShotSummarize = () => Promise<SummaryResult>

interface SummaryTarget {
  readonly provider: string
  readonly model: string
  readonly oneShotMaxTokens: number
}

interface StageResult {
  readonly summary: TextBlock[]
  readonly rawOutput: ContentBlock[]
  readonly usage?: TokenUsage
}

interface SourceSpan {
  readonly messages: Message[]
  readonly start: number
  readonly end: number
}

interface PartialSummary {
  readonly message: Message
  readonly result: StageResult
  readonly start: number
  readonly end: number
}

/**
 * Preserve the cache-reusing one-shot path when it fits and otherwise summarize
 * bounded chronological chunks followed by recursive reductions.
 * @param ctx - compaction provider context.
 * @param config - resolved basic and hierarchy policy.
 * @param input - selected replay input owned by the stock region transaction.
 * @param agent - agent whose route and session own the auxiliary calls.
 * @param oneShot - existing stock summarizer used for fitting inputs.
 * @param signal - optional operation cancellation.
 * @returns one final checkpoint summary for the stock transaction.
 */
export async function summarizeWithHierarchy(
  ctx: Context,
  config: ResolvedConfig | ResolvedTargetPolicy,
  input: SummarizationInput,
  agent: Agent,
  oneShot: OneShotSummarize,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const summarizer = new HierarchicalSummarizer(ctx, config)
  return summarizer.run(input, agent, oneShot, signal)
}

/** Operation-local bounded summarizer with no durable mutation ownership. */
class HierarchicalSummarizer {
  private readonly hierarchy: ResolvedHierarchyConfig

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig | ResolvedTargetPolicy,
  ) {
    this.hierarchy = {
      chunkInputRatio: config.chunkInputRatio,
      mapMaxTokens: config.mapMaxTokens,
      reduceMaxTokens: config.reduceMaxTokens,
      maxDepth: config.maxDepth,
      replayTools: config.replayTools,
    }
  }

  /** Run one complete one-shot or map-reduce summary attempt. */
  async run(
    input: SummarizationInput,
    agent: Agent,
    oneShot: OneShotSummarize,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    signal?.throwIfAborted()
    const target = this.resolveSummaryTarget(agent)
    if (target === undefined) return oneShot()
    const model = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)
    const contextWindow = model.context?.contextWindow
    if (contextWindow === undefined) {
      try {
        return await oneShot()
      } catch (error) {
        if (!hasErrorCode(error, CONTEXT_WINDOW_EXCEEDED_CODE)) throw error
        throw new Error(
          `hierarchical compaction: summary target ${target.provider}/${target.model} overflowed `
          + 'but declares no positive integer context capacity for bounded recovery',
          { cause: error },
        )
      }
    }
    /* v8 ignore next -- LlmRuntime validates defined capacity before returning model info. */
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 1) {
      throw new Error(
        `hierarchical compaction: no positive integer context capacity for summary target ${target.provider}/${target.model}`,
      )
    }

    const estimate = (message: Message): number => this.ctx.tokenMeter.estimateMessage(message)
    const oneShotTokens = this.estimateCallInput(
      input,
      COMPACTION_INSTRUCTION,
      true,
      estimate,
    )
    let hadFailedLlmAttempt = false
    if (oneShotTokens + target.oneShotMaxTokens <= contextWindow) {
      try {
        return await oneShot()
      } catch (error) {
        if (!hasErrorCode(error, CONTEXT_WINDOW_EXCEEDED_CODE)) throw error
        hadFailedLlmAttempt = true
      }
    }

    const inputBudget = Math.floor(contextWindow * this.hierarchy.chunkInputRatio)
    this.assertStageOutputReserve(
      contextWindow,
      inputBudget,
      this.hierarchy.mapMaxTokens,
      'map',
    )
    const systemMessage = input.messages[0]?.role === 'system' ? input.messages[0] : undefined
    const sourceMessages = systemMessage === undefined ? input.messages : input.messages.slice(1)
    const units = toolBalancedUnits(sourceMessages)
    const totalUnits = units.length
    const mapReserve = this.estimateFixedInput(
      input,
      mapInstruction(totalUnits, totalUnits, totalUnits),
      this.hierarchy.replayTools,
      estimate,
    )
    const mapMessageBudget = this.messageBudget(inputBudget, mapReserve, 'map')
    const chunks = planMessageChunks(sourceMessages, mapMessageBudget, estimate)
    /* v8 ignore next -- stock range selection never submits an empty shadowed region. */
    if (chunks.length === 0) {
      throw new Error('hierarchical compaction: oversized input produced no map chunks')
    }

    const calls: StageResult[] = []
    const pendingMap = this.sourceSpans(chunks)
    let partials: PartialSummary[] = []
    while (pendingMap.length > 0) {
      signal?.throwIfAborted()
      const span = pendingMap.shift()
      /* v8 ignore next -- the loop condition proves shift has an entry. */
      if (span === undefined) break
      try {
        const result = await this.runStage(
          {
            ...input,
            messages: systemMessage === undefined ? span.messages : [systemMessage, ...span.messages],
          },
          mapInstruction(span.start, span.end, totalUnits),
          target,
          this.hierarchy.mapMaxTokens,
          agent,
          signal,
        )
        calls.push(result)
        partials.push(this.partial(
          result,
          span.start,
          span.end,
          `map source units ${span.start}-${span.end}`,
        ))
      } catch (error) {
        if (signal?.aborted || !hasErrorCode(error, CONTEXT_WINDOW_EXCEEDED_CODE)) throw error
        hadFailedLlmAttempt = true
        const split = this.splitMapSpan(span, estimate)
        if (split === null) throw indivisibleOverflow(`map source unit ${span.start}`, error)
        pendingMap.unshift(split[1])
        pendingMap.unshift(split[0])
      }
    }
    this.assertCoverage(partials, totalUnits, 'map stage')
    if (partials.length > 1) {
      this.assertStageOutputReserve(
        contextWindow,
        inputBudget,
        this.hierarchy.reduceMaxTokens,
        'reduce',
      )
    }

    let usedReduce = false
    for (let round = 1; partials.length > 1; round += 1) {
      if (round > this.hierarchy.maxDepth) {
        throw new Error(
          `hierarchical compaction: reduction did not converge within ${this.hierarchy.maxDepth} round(s)`,
        )
      }
      const reduceReserve = this.estimateFixedInput(
        input,
        reduceInstruction(round, totalUnits, totalUnits, totalUnits),
        this.hierarchy.replayTools,
        estimate,
      )
      const reduceMessageBudget = this.messageBudget(inputBudget, reduceReserve, `reduce round ${round}`)
      let groups: Message[][]
      try {
        groups = planMessageChunks(
          partials.map(partial => partial.message),
          reduceMessageBudget,
          estimate,
        )
      } catch (error) {
        const cause = error as Error
        cause.message = `hierarchical compaction: reduce round ${round}: ${cause.message}`
        throw cause
      }
      /* v8 ignore next -- defensive progress guard for future planner changes. */
      if (groups.length >= partials.length) {
        throw new Error(
          `hierarchical compaction: reduce round ${round} cannot combine any partial summaries; `
          + 'increase chunkInputRatio or lower mapMaxTokens/reduceMaxTokens',
        )
      }

      const byMessage = new Map<string, PartialSummary>(
        partials.map(partial => [partial.message.id, partial]),
      )
      const pendingReduce = groups.map(group => this.reduceSpan(group, byMessage))
      const next: PartialSummary[] = []
      while (pendingReduce.length > 0) {
        signal?.throwIfAborted()
        const span = pendingReduce.shift()
        /* v8 ignore next -- the loop condition proves shift has an entry. */
        if (span === undefined) break
        try {
          const result = await this.runStage(
            {
              ...input,
              messages: systemMessage === undefined ? span.messages : [systemMessage, ...span.messages],
            },
            reduceInstruction(round, span.start, span.end, totalUnits),
            target,
            this.hierarchy.reduceMaxTokens,
            agent,
            signal,
          )
          calls.push(result)
          next.push(this.partial(
            result,
            span.start,
            span.end,
            `reduce round ${round} source units ${span.start}-${span.end}`,
          ))
        } catch (error) {
          if (signal?.aborted || !hasErrorCode(error, CONTEXT_WINDOW_EXCEEDED_CODE)) throw error
          hadFailedLlmAttempt = true
          const splitMessages = splitMessageChunk(span.messages, estimate)
          if (splitMessages === null) {
            throw indivisibleOverflow(
              `reduce round ${round} partial ${span.start}-${span.end}`,
              error,
            )
          }
          if (next.length + pendingReduce.length + 2 >= partials.length) {
            throw new Error(
              `hierarchical compaction: reduce round ${round} made no progress after adaptive splitting `
              + `(${partials.length} -> ${next.length + pendingReduce.length + 2})`,
              { cause: error },
            )
          }
          pendingReduce.unshift(this.reduceSpan(splitMessages[1], byMessage))
          pendingReduce.unshift(this.reduceSpan(splitMessages[0], byMessage))
        }
      }
      /* v8 ignore next -- adaptive splitting rejects this condition before enqueueing children. */
      if (next.length >= partials.length) {
        throw new Error(
          `hierarchical compaction: reduce round ${round} made no progress after adaptive splitting `
          + `(${partials.length} -> ${next.length})`,
        )
      }
      partials = next
      usedReduce = true
      this.assertCoverage(partials, totalUnits, `reduce round ${round}`)
    }

    const final = partials[0]
    /* v8 ignore next -- map coverage proves at least one partial and reductions preserve it. */
    if (final === undefined) throw new Error('hierarchical compaction: map stage produced no summaries')
    const usage = hadFailedLlmAttempt
      ? undefined
      : aggregateUsage(calls.map(call => call.usage))
    const result = {
      summary: final.result.summary,
      rawOutput: final.result.rawOutput,
      provider: target.provider,
      model: target.model,
      maxTokens: usedReduce ? this.hierarchy.reduceMaxTokens : this.hierarchy.mapMaxTokens,
      ...(usage === undefined ? {} : { usage }),
    }
    if (!hadFailedLlmAttempt && calls.length === 1) return { ...result, llmStreamCall: true }
    return result
  }

  /** Assign stable source-unit ranges to the initial greedy map chunks. */
  private sourceSpans(chunks: readonly Message[][]): SourceSpan[] {
    let start = 1
    return chunks.map((messages) => {
      const unitCount = toolBalancedUnits(messages).length
      const span = { messages, start, end: start + unitCount - 1 }
      start = span.end + 1
      return span
    })
  }

  /** Bisect one failed map span while preserving its stable source coordinates. */
  private splitMapSpan(
    span: SourceSpan,
    estimate: (message: Message) => number,
  ): [SourceSpan, SourceSpan] | null {
    const split = splitMessageChunk(span.messages, estimate)
    if (split === null) return null
    const leftEnd = span.start + toolBalancedUnits(split[0]).length - 1
    return [
      { messages: split[0], start: span.start, end: leftEnd },
      { messages: split[1], start: leftEnd + 1, end: span.end },
    ]
  }

  /** Recover one reduce group's stable source range from its partial identities. */
  private reduceSpan(
    messages: Message[],
    byMessage: ReadonlyMap<string, PartialSummary>,
  ): SourceSpan {
    const represented = messages.map((message) => {
      const partial = byMessage.get(message.id)
      /* v8 ignore next -- groups are planned only from keys used to build this map. */
      if (partial === undefined) {
        throw new Error('hierarchical compaction: reducer group lost partial-summary identity')
      }
      return partial
    })
    const first = represented[0]
    const last = represented.at(-1)
    /* v8 ignore next -- planner groups are non-empty by construction. */
    if (first === undefined || last === undefined) {
      throw new Error('hierarchical compaction: reducer produced an empty work group')
    }
    return { messages, start: first.start, end: last.end }
  }

  /** Prove adaptive children preserve complete ordered source coverage. */
  private assertCoverage(
    partials: readonly PartialSummary[],
    totalUnits: number,
    stage: string,
  ): void {
    let expected = 1
    for (const partial of partials) {
      /* v8 ignore next -- spans derive from ordered planner groups and stable source coordinates. */
      if (partial.start !== expected || partial.end < partial.start) {
        throw new Error(`hierarchical compaction: ${stage} lost chronological source coverage`)
      }
      expected = partial.end + 1
    }
    /* v8 ignore next -- successful stage insertion preserves complete planned coverage. */
    if (partials.length === 0 || expected !== totalUnits + 1) {
      throw new Error(`hierarchical compaction: ${stage} did not cover every source unit`)
    }
  }

  /** Resolve the same configured/latest/agent summary route precedence as basic. */
  private resolveSummaryTarget(agent: Agent): SummaryTarget | undefined {
    const header = agent.session.requestHeader()?.config
    const routed = header !== undefined
      && header.provider.length > 0
      && header.model.length > 0
      ? { provider: header.provider, model: header.model }
      : undefined
    const agentTarget = agent.options.provider !== undefined
      && agent.options.provider.length > 0
      && agent.options.model !== undefined
      && agent.options.model.length > 0
      ? { provider: agent.options.provider, model: agent.options.model }
      : undefined
    const provider = this.config.summarizationProvider
    const model = this.config.summarizationModel
    const configured = provider.length === 0 ? undefined : { provider, model }
    const target = configured ?? routed ?? agentTarget
    if (target === undefined) return undefined
    return {
      provider: target.provider,
      model: target.model,
      oneShotMaxTokens: this.config.maxTokens,
    }
  }

  /** Ensure one stage generation cap fits outside its input budget. */
  private assertStageOutputReserve(
    contextWindow: number,
    inputBudget: number,
    outputTokens: number,
    stage: string,
  ): void {
    if (inputBudget + outputTokens > contextWindow) {
      throw new Error(
        `hierarchical compaction: ${stage} input budget ${inputBudget} plus output reserve ${outputTokens} `
        + `exceeds summary context ${contextWindow}`,
      )
    }
  }

  /** Price a complete auxiliary call input. */
  private estimateCallInput(
    input: SummarizationInput,
    instruction: string,
    includeTools: boolean,
    estimate: (message: Message) => number,
  ): number {
    const sourceMessages = input.messages[0]?.role === 'system' ? input.messages.slice(1) : input.messages
    return this.estimateFixedInput(input, instruction, includeTools, estimate)
      + estimateMessages(sourceMessages, estimate)
  }

  /** Price the repeated header and final instruction for one stage. */
  private estimateFixedInput(
    input: SummarizationInput,
    instruction: string,
    includeTools: boolean,
    estimate: (message: Message) => number,
  ): number {
    const systemTokens = input.messages[0]?.role === 'system' ? estimate(input.messages[0]) : 0
    const toolsTokens = !includeTools || input.tools === undefined || input.tools.length === 0
      ? 0
      : Math.ceil(JSON.stringify(input.tools).length / CHARS_PER_TOKEN) + ENVELOPE_OVERHEAD
    return systemTokens + toolsTokens + estimate(this.instructionMessage(instruction))
  }

  /** Derive positive room for stage messages after fixed input. */
  private messageBudget(inputBudget: number, fixedTokens: number, stage: string): number {
    const budget = inputBudget - fixedTokens
    if (budget < 1) {
      throw new Error(
        `hierarchical compaction: ${stage} system/tools/instruction need ~${fixedTokens} tokens, `
        + `above the ${inputBudget}-token call input budget`,
      )
    }
    return budget
  }

  /** Run one private map or reduce model call and require structured text. */
  private async runStage(
    input: SummarizationInput,
    instruction: string,
    target: SummaryTarget,
    maxTokens: number,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<StageResult> {
    signal?.throwIfAborted()
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: target.provider,
      model: target.model,
      messages: [...input.messages, this.instructionMessage(instruction)],
      ...this.hierarchy.replayTools && input.tools !== undefined ? { tools: [...input.tools] } : {},
      maxTokens,
      sessionId: agent.session.id,
      purpose: 'compaction',
      ...signal === undefined ? {} : { signal },
    }
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)
    const finishFailure = finishError(assembler.finish)
    if (finishFailure !== undefined) throw finishFailure

    const rawOutput = assembler.blocks()
    if (contentHasImage(rawOutput)) {
      throw new LlmError('hierarchical compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
    }
    const summary = rawOutput.filter((block): block is TextBlock => block.type === 'text')
    validateStructuredSummary(summary, 'hierarchical compaction stage')
    return {
      summary,
      rawOutput,
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    }
  }

  /** Convert one validated stage result into immutable reducer data. */
  private partial(result: StageResult, start: number, end: number, stage: string): PartialSummary {
    const text = validateStructuredSummary(result.summary, stage)
    return {
      message: createUserMessage({
        content: [{ type: 'text', text: framePartialSummary(text, start, end) }],
        source: { kind: 'plugin', plugin: PLUGIN_ID },
      }),
      result,
      start,
      end,
    }
  }

  /** Create the final user instruction for an auxiliary call. */
  private instructionMessage(text: string): Message {
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: PLUGIN_ID },
    })
  }
}

/** Build the terminal diagnostic for a provider-rejected atomic span. */
function indivisibleOverflow(stage: string, cause: unknown): Error {
  const error = new OversizedCompactionUnitError(
    `hierarchical compaction: ${stage} still exceeds the provider context window and is indivisible`,
    { cause },
  ) as OversizedCompactionUnitError & { code?: string }
  error.code = CONTEXT_WINDOW_EXCEEDED_CODE
  return error
}

/** Match a structured error code without depending on an error class instance. */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}

/** Map a terminal stage finish to a fail-closed error. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error = new Error(
        'hierarchical compaction stage truncated at the token cap',
      ) as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/**
 * Sum disjoint provider usage across every successful map and reduce call.
 * @param usages - stage usage values in call order.
 * @returns aggregate usage, or undefined when any stage omitted usage.
 */
export function aggregateUsage(usages: readonly (TokenUsage | undefined)[]): TokenUsage | undefined {
  if (usages.length === 0 || usages.some(usage => usage === undefined)) return undefined
  const present = usages as readonly TokenUsage[]
  const total: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  for (const usage of present) {
    total.inputTokens += usage.inputTokens
    total.outputTokens += usage.outputTokens
    if (usage.cacheReadTokens !== undefined) {
      total.cacheReadTokens = (total.cacheReadTokens ?? 0) + usage.cacheReadTokens
    }
    if (usage.cacheWriteTokens !== undefined) {
      total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + usage.cacheWriteTokens
    }
    if (usage.reasoningTokens !== undefined) {
      total.reasoningTokens = (total.reasoningTokens ?? 0) + usage.reasoningTokens
    }
  }
  return total
}
