// =============================================================================
// Adaptive string dispatcher — interactive fast path vs flood coalescing.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdaptiveStringDispatcher } from './batchedDispatcher'

describe('createAdaptiveStringDispatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('emits a lone small chunk synchronously (zero added latency)', () => {
    const emits: string[] = []
    const d = createAdaptiveStringDispatcher(16, 2048, (s) => emits.push(s))
    d.push('j')
    expect(emits).toEqual(['j'])
  })

  it('spaced keystrokes each take the fast path', () => {
    const emits: string[] = []
    const d = createAdaptiveStringDispatcher(16, 2048, (s) => emits.push(s))
    d.push('a')
    vi.advanceTimersByTime(100)
    d.push('b')
    vi.advanceTimersByTime(100)
    d.push('c')
    expect(emits).toEqual(['a', 'b', 'c'])
  })

  it('a burst after the first emit coalesces into one trailing batch', () => {
    const emits: string[] = []
    const d = createAdaptiveStringDispatcher(16, 2048, (s) => emits.push(s))
    d.push('1') // fast path
    d.push('2') // within delayMs of the last emit → timer path
    d.push('3')
    d.push('4')
    expect(emits).toEqual(['1'])
    vi.advanceTimersByTime(16)
    expect(emits).toEqual(['1', '234'])
  })

  it('a large chunk always takes the timer path', () => {
    const emits: string[] = []
    const d = createAdaptiveStringDispatcher(16, 8, (s) => emits.push(s))
    d.push('0123456789') // > interactiveMaxBytes
    expect(emits).toEqual([])
    vi.advanceTimersByTime(16)
    expect(emits).toEqual(['0123456789'])
  })

  it('cancel with resetPending drops unflushed data', () => {
    const emits: string[] = []
    const d = createAdaptiveStringDispatcher(16, 8, (s) => emits.push(s))
    d.push('0123456789')
    d.cancel({ resetPending: true })
    vi.advanceTimersByTime(50)
    expect(emits).toEqual([])
  })
})
