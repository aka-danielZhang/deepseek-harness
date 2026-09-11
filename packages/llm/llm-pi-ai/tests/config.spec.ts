import { describe, expect, it } from 'vitest'
import { assertServiceable, Config, resolveProfiles } from '../src/config.ts'
import type { PiAiProviderProfile } from '../src/config.ts'

/** Validate one hand-declared route, with the caller's fields layered onto it. */
const routeWith = (profile: Record<string, unknown>): (() => unknown) =>
  () => Config({
    providers: {
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'm' }],
        ...profile,
      },
    },
  })

/** Validate that route with the caller's fields on its single model entry. */
const configWith = (model: Record<string, unknown>): (() => unknown) =>
  routeWith({ models: [{ id: 'm', ...model }] })

describe('reasoning schema boundary', () => {
  it('accepts an empty provider section and propagates unexpected catalog failures', () => {
    expect(() => { assertServiceable({}) }).not.toThrow()
    const failure = new TypeError('model metadata lookup failed')
    expect(() => resolveProfiles({ openrouter: { models: [{
      id: '111',
      get name(): string { throw failure },
    }], api: 'openai-completions' } }, 'deferred')).toThrow(failure)
  })

  it('rejects a level pi-ai does not know at the write that produced it', () => {
    expect(configWith({ reasoningEfforts: { ultra: 'x' } })).toThrow(/"off"/)
    expect(configWith({ reasoningEfforts: { high: 42 } })).toThrow()
  })

  it('keeps false distinguishable from an absent declaration', () => {
    type Materialized = { providers: Record<string, { models?: { reasoningEfforts?: unknown }[] }> }
    const withFalse = configWith({ reasoningEfforts: false })() as Materialized
    expect(withFalse.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBe(false)
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBeUndefined()
  })

  it('rejects a thinking format outside the offered set', () => {
    expect(configWith({ compat: { thinkingFormat: 'quantum' } })).toThrow(/expected/)
  })

  it('accepts Baseten template arguments and completion controls', () => {
    expect(configWith({
      compat: {
        supportsFinishReason: false,
        thinkingFormat: 'baseten',
        chatTemplateArgs: { enable_thinking: { $var: 'thinking.enabled' } },
        supportsThinkingTokenBudget: true,
      },
    })).not.toThrow()
  })
})

describe('modality schema boundary', () => {
  it('rejects a modality pi-ai does not know, at either level', () => {
    expect(configWith({ input: ['audio'] })).toThrow(/expected/)
    expect(routeWith({ defaultInput: ['text', 'audio'] })).toThrow(/expected/)
  })

  it('refuses a route whose models could accept nothing', () => {
    // The pair the settings seam runs: the schema accepts the empty list as
    // well-typed, and the namespace validator is what refuses it. Asserting
    // only the schema would report this route as writable.
    expect(routeWith({ defaultInput: [] })).not.toThrow()
    expect(() => { assertServiceable(routeWith({ defaultInput: [] })() as Config) })
      .toThrow(/defaultInput must name at least one modality/)
  })

  type Materialized = {
    providers: Record<string, { defaultInput?: unknown; models?: { input?: unknown }[] }>
  }

  it('materializes an absent entry list as empty and an absent route list as text', () => {
    // The empty-list inheritance rule exists because of exactly this: an entry
    // that declares nothing reaches resolution as `[]`, not as `undefined`.
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.input).toEqual([])
    expect(absent.providers['acme-gateway']?.defaultInput).toEqual(['text'])
  })
})

describe('request image policy bounds', () => {
  it.each([
    ['requestImagePixelBudget', 0, /requestImagePixelBudget must be a positive safe integer/],
    ['requestImagePixelBudget', Number.MAX_SAFE_INTEGER + 1, /requestImagePixelBudget must be a positive safe integer/],
    ['requestImageMaxBytes', 0, /requestImageMaxBytes must be a positive safe integer/],
    ['requestImageMaxBytes', 1.5, /requestImageMaxBytes must be a positive safe integer/],
  ] as const)('rejects %s=%s at service resolution', (field, value, message) => {
    const programmatic = {
      providers: {
        'acme-gateway': {
          api: 'openai-completions',
          baseURL: 'https://acme.test',
          models: [{ id: 'm' }],
          [field]: value,
        },
      },
    } as unknown as Config
    expect(() => {
      assertServiceable(programmatic)
    }).toThrow(message)
  })
})


describe('sessionAffinityHeaders profile field', () => {
  const route = (profile: Record<string, unknown>): Record<string, PiAiProviderProfile> => ({
    gateway: {
      api: 'openai-completions',
      baseURL: 'https://acme.test',
      models: [{ id: 'm' }],
      ...profile,
    } as unknown as PiAiProviderProfile,
  })

  it('accepts valid Fetch header names and copies the list', () => {
    const source: PiAiProviderProfile = {
      api: 'openai-completions',
      baseURL: 'https://acme.test',
      models: [{ id: 'm' }],
      sessionAffinityHeaders: ['x-opencode-session', 'x-client-request-id'],
    }
    const resolved = resolveProfiles({ gateway: source })
    const profile = resolved.get('gateway')
    expect(profile?.sessionAffinityHeaders).toEqual(['x-opencode-session', 'x-client-request-id'])
    source.sessionAffinityHeaders?.push('mutated-after')
    expect(profile?.sessionAffinityHeaders).toEqual(['x-opencode-session', 'x-client-request-id'])
  })

  it('rejects names Fetch cannot send', () => {
    expect(() => resolveProfiles(route({ sessionAffinityHeaders: ['x bad header!'] })))
      .toThrow(/not valid for Fetch/)
  })

  it('rejects the attribution reserved set, case-insensitively', () => {
    expect(() => resolveProfiles(route({ sessionAffinityHeaders: ['user-agent'] })))
      .toThrow(/reserved/)
    expect(() => resolveProfiles(route({ sessionAffinityHeaders: ['User-Agent'] })))
      .toThrow(/reserved/)
  })

  it('parses through the settings schema', () => {
    const parsed = routeWith({ sessionAffinityHeaders: ['x-opencode-session'] })() as {
      providers: Record<string, { sessionAffinityHeaders?: string[] }>
    }
    expect(parsed.providers['acme-gateway']?.sessionAffinityHeaders).toEqual(['x-opencode-session'])
  })
})

describe('opencode-go default affinity headers', () => {
  const goRoute = (profile: Record<string, unknown>): Record<string, PiAiProviderProfile> => ({
    'opencode-go': {
      apiKeyEnv: 'OPENCODE_API_KEY',
      ...profile,
    } as unknown as PiAiProviderProfile,
  })

  it('defaults the catalog opencode-go route to both affinity headers', () => {
    const resolved = resolveProfiles(goRoute({ models: [{ id: 'minimax-m3' }], api: 'anthropic-messages' }))
    expect(resolved.get('opencode-go')?.sessionAffinityHeaders).toEqual([
      'x-opencode-session',
      'x-client-request-id',
    ])
  })

  it('defaults a custom-keyed route whose endpoint is opencode.ai', () => {
    const resolved = resolveProfiles(goRoute({
      baseURL: 'https://opencode.ai/zen/go/v1',
      models: [{ id: 'glm-5' }],
      api: 'openai-completions',
    }))
    expect(resolved.get('opencode-go')?.sessionAffinityHeaders).toEqual([
      'x-opencode-session',
      'x-client-request-id',
    ])
  })

  it('an explicit empty array opts the route out', () => {
    const resolved = resolveProfiles(goRoute({
      models: [{ id: 'minimax-m3' }],
      api: 'anthropic-messages',
      sessionAffinityHeaders: [],
    }))
    expect(resolved.get('opencode-go')?.sessionAffinityHeaders).toEqual([])
  })

  it('routes unrelated to opencode keep sending nothing', () => {
    const resolved = resolveProfiles({ deepseek: { models: [{ id: 'm' }], api: 'openai-completions' } })
    expect(resolved.get('deepseek')?.sessionAffinityHeaders).toBeUndefined()
  })
})
