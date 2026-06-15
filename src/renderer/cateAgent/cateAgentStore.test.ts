import { describe, it, expect, beforeEach } from 'vitest'
import { useCateAgentStore, DEFAULT_CATE_AGENT_WS } from './cateAgentStore'

const WS = 'ws-1'

describe('cateAgentStore — feedback + control state', () => {
  beforeEach(() => {
    useCateAgentStore.setState({ byWs: {} })
  })

  it('defaults include inputOpen=false, empty feed and controlled terminals', () => {
    expect(DEFAULT_CATE_AGENT_WS.inputOpen).toBe(false)
    expect(DEFAULT_CATE_AGENT_WS.feed).toEqual([])
    expect(DEFAULT_CATE_AGENT_WS.controlledTerminalIds).toEqual([])
  })

  it('setInputOpen toggles per workspace', () => {
    useCateAgentStore.getState().setInputOpen(WS, true)
    expect(useCateAgentStore.getState().get(WS).inputOpen).toBe(true)
    useCateAgentStore.getState().setInputOpen(WS, false)
    expect(useCateAgentStore.getState().get(WS).inputOpen).toBe(false)
  })

  it('appendFeed adds items newest-last and caps at 50', () => {
    for (let i = 0; i < 55; i++) useCateAgentStore.getState().appendFeed(WS, 'agent', `m${i}`)
    const feed = useCateAgentStore.getState().get(WS).feed
    expect(feed.length).toBe(50)
    expect(feed[0].text).toBe('m5') // oldest 5 dropped
    expect(feed[feed.length - 1].text).toBe('m54')
    expect(feed[feed.length - 1].kind).toBe('agent')
  })

  it('clearFeed empties the feed', () => {
    useCateAgentStore.getState().appendFeed(WS, 'user', 'hi')
    useCateAgentStore.getState().clearFeed(WS)
    expect(useCateAgentStore.getState().get(WS).feed).toEqual([])
  })

  it('addControlledTerminal is idempotent; removeControlledTerminal removes one', () => {
    const s = useCateAgentStore.getState()
    s.addControlledTerminal(WS, 'p1')
    s.addControlledTerminal(WS, 'p1')
    s.addControlledTerminal(WS, 'p2')
    expect(useCateAgentStore.getState().get(WS).controlledTerminalIds).toEqual(['p1', 'p2'])
    s.removeControlledTerminal(WS, 'p1')
    expect(useCateAgentStore.getState().get(WS).controlledTerminalIds).toEqual(['p2'])
  })

  it('clearControlledTerminals empties the set', () => {
    useCateAgentStore.getState().addControlledTerminal(WS, 'p1')
    useCateAgentStore.getState().clearControlledTerminals(WS)
    expect(useCateAgentStore.getState().get(WS).controlledTerminalIds).toEqual([])
  })

  it('reset restores all new fields to defaults', () => {
    const s = useCateAgentStore.getState()
    s.setInputOpen(WS, true)
    s.appendFeed(WS, 'agent', 'x')
    s.addControlledTerminal(WS, 'p1')
    s.reset(WS)
    const after = useCateAgentStore.getState().get(WS)
    expect(after.inputOpen).toBe(false)
    expect(after.feed).toEqual([])
    expect(after.controlledTerminalIds).toEqual([])
  })
})

describe('cateAgentStore — appendFeed kinds', () => {
  beforeEach(() => useCateAgentStore.setState({ byWs: {} }))

  it('records distinct kinds in order', () => {
    const s = useCateAgentStore.getState()
    s.appendFeed('w', 'user', 'do the thing')
    s.appendFeed('w', 'agent', 'on it')
    s.appendFeed('w', 'error', 'boom')
    expect(useCateAgentStore.getState().get('w').feed.map((f) => f.kind)).toEqual(['user', 'agent', 'error'])
  })
})
