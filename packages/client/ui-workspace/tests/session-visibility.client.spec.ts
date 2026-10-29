import { describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceSessionVisibility } from '../src/client/session-visibility.ts'

const session = (preset: string): SessionSummary => ({
  id: preset as SessionId,
  title: preset,
  displayTitle: preset,
  running: false,
  blank: false,
  updatedAt: 0,
  retainedBy: {},
  projectionValues: { agentPreset: preset },
})

describe('WorkspaceSessionVisibility', () => {
  it('combines registered predicates and publishes idempotent disposal', () => {
    const visibility = new WorkspaceSessionVisibility()
    const revisions = vi.fn()
    const unsubscribe = visibility.revision.subscribe(revisions)
    const quno = session('quno')
    const ordinary = session('default')
    expect(visibility.accept(quno)).toBe(true)

    const hideQuno = visibility.register(row => row.projectionValues?.agentPreset !== 'quno')
    expect(visibility.accept(quno)).toBe(false)
    expect(visibility.accept(ordinary)).toBe(true)
    expect(visibility.revision.getSnapshot()).toBe(1)

    const hideDefault = visibility.register(row => row.projectionValues?.agentPreset !== 'default')
    expect(visibility.accept(ordinary)).toBe(false)
    hideQuno()
    hideQuno()
    expect(visibility.accept(quno)).toBe(true)
    expect(visibility.accept(ordinary)).toBe(false)
    expect(visibility.revision.getSnapshot()).toBe(3)

    hideDefault()
    expect(visibility.accept(ordinary)).toBe(true)
    expect(visibility.revision.getSnapshot()).toBe(4)
    expect(revisions).toHaveBeenCalledTimes(4)
    unsubscribe()
  })

  it('keeps duplicate predicate registrations independent', () => {
    const visibility = new WorkspaceSessionVisibility()
    const hideQuno = (row: SessionSummary): boolean => row.projectionValues?.agentPreset !== 'quno'
    const first = visibility.register(hideQuno)
    const second = visibility.register(hideQuno)
    first()
    expect(visibility.accept(session('quno'))).toBe(false)
    second()
    expect(visibility.accept(session('quno'))).toBe(true)
  })
})
