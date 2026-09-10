import { describe, expect, it } from 'vitest'
import { SelectionHistory } from '../src/client/sessions/selection-history.ts'

describe('SelectionHistory', () => {
  it('records selections and walks back and forward over them', () => {
    const history = new SelectionHistory()
    history.record({ sessionId: 's1' as never })
    history.record({ sessionId: 's2' as never })
    history.record({})
    expect(history.canBack()).toBe(true)
    expect(history.canForward()).toBe(false)
    expect(history.back()?.sessionId).toBe('s2')
    expect(history.back()?.sessionId).toBe('s1')
    expect(history.canBack()).toBe(false)
    expect(history.forward()?.sessionId).toBe('s2')
    expect(history.forward()).toEqual({})
    expect(history.canForward()).toBe(false)
  })

  it('collapses consecutive duplicate selections', () => {
    const history = new SelectionHistory()
    history.record({ sessionId: 's1' as never })
    history.record({ sessionId: 's1' as never })
    history.record({})
    history.record({})
    expect(history.entries).toHaveLength(2)
    expect(history.back()?.sessionId).toBe('s1')
  })

  it('truncates the forward tail when a fresh selection follows a backtrack', () => {
    const history = new SelectionHistory()
    history.record({ sessionId: 's1' as never })
    history.record({ sessionId: 's2' as never })
    history.record({ sessionId: 's3' as never })
    expect(history.back()?.sessionId).toBe('s2')
    history.record({ sessionId: 's4' as never })
    expect(history.canForward()).toBe(false)
    expect(history.entries.map(entry => entry.sessionId)).toEqual(['s1', 's2', 's4'])
    expect(history.back()?.sessionId).toBe('s2')
  })

  it('keeps the bounded window, dropping the oldest entries', () => {
    const history = new SelectionHistory(3)
    for (const id of ['s1', 's2', 's3', 's4']) history.record({ sessionId: id as never })
    expect(history.entries.map(entry => entry.sessionId)).toEqual(['s2', 's3', 's4'])
    expect(history.back()?.sessionId).toBe('s3')
    expect(history.canBack()).toBe(true)
  })

  it('prunes a removed session wherever it sits and keeps the cursor position', () => {
    const history = new SelectionHistory()
    history.record({ sessionId: 's1' as never })
    history.record({ sessionId: 's2' as never })
    history.record({ sessionId: 's3' as never })
    expect(history.back()?.sessionId).toBe('s2')
    history.prune('s2' as never)
    expect(history.entries.map(entry => entry.sessionId)).toEqual(['s1', 's3'])
    expect(history.entries[history.cursor]?.sessionId).toBe('s1')
    expect(history.canBack()).toBe(false)
    expect(history.forward()?.sessionId).toBe('s3')
  })

  it('starts empty without a record and stays no-op at the bounds', () => {
    const history = new SelectionHistory()
    expect(history.canBack()).toBe(false)
    expect(history.canForward()).toBe(false)
    expect(history.back()).toBeUndefined()
    expect(history.forward()).toBeUndefined()
  })
})
