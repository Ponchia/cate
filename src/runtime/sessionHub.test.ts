// SessionHub — detach-survival registry + replay-ring semantics. Uses in-proc
// fake ProcessHost/AgentHost leaves so no pty/pi is spawned; asserts the tmux
// contract: create registers a session, a dropped subscriber doesn't kill it,
// attach replays exactly the missed bytes/lines, exit fans out to every
// subscriber and removes the session, and duplicate ids are rejected.

import { describe, it, expect } from 'vitest'
import { createSessionHub } from './sessionHub'
import type { ProcessHost, AgentHost, PtyCreateOptions } from '../main/runtime/types'

function makeFakes(): {
  proc: ProcessHost
  agent: AgentHost
  emitData: (id: string, data: string) => void
  emitExit: (id: string, code: number) => void
  emitLine: (id: string, line: string) => void
  emitAgentExit: (id: string, code: number) => void
} {
  let procData: (id: string, data: string) => void = () => {}
  let procExit: (id: string, code: number) => void = () => {}
  let agentLine: (id: string, line: string) => void = () => {}
  let agentExit: (id: string, code: number, stderr?: string) => void = () => {}
  const proc: ProcessHost = {
    create: async (opts: PtyCreateOptions, onData, onExit) => {
      procData = onData
      procExit = onExit
      return { id: opts.id ?? 'pty-x', pid: 4242, shell: '/bin/fake' }
    },
    write: () => {},
    resize: () => {},
    kill: () => {},
    getCwd: async () => null,
    setVisibility: () => {},
    scanActivity: async () => ({}),
    scanPorts: async () => ({}),
  }
  const agent: AgentHost = {
    ensurePi: async () => {},
    start: async (opts, onLine, onExit) => {
      agentLine = onLine
      agentExit = onExit
      return { id: opts.id, pid: 777 }
    },
    writeLine: () => {},
    stop: () => {},
  }
  return {
    proc,
    agent,
    emitData: (id, data) => procData(id, data),
    emitExit: (id, code) => procExit(id, code),
    emitLine: (id, line) => agentLine(id, line),
    emitAgentExit: (id, code) => agentExit(id, code),
  }
}

const noop = (): void => {}

describe('SessionHub ptys', () => {
  it('survives subscriber drop, replays since a byte cursor, fans out exit', async () => {
    const f = makeFakes()
    const hub = createSessionHub(f.proc, f.agent)

    const aData: string[] = []
    const aOnData = (_id: string, d: string): void => { aData.push(d) }
    await hub.process.create({ id: 't1', cols: 80, rows: 24, cwd: '/w' }, aOnData, noop)
    f.emitData('t1', 'hello ')
    f.emitData('t1', 'world')
    expect(aData.join('')).toBe('hello world')

    // Connection A goes away — the session must remain listed and buffering.
    await hub.detachPty('t1', aOnData)
    f.emitData('t1', '!afterA')
    expect((await hub.listPtys()).map((s) => s.id)).toEqual(['t1'])

    // B attaches from byte 0: full ring. C attaches from B's offset: only new.
    const bData: string[] = []
    const bOnData = (_id: string, d: string): void => { bData.push(d) }
    let bExit: number | null = null
    const att = await hub.attachPty('t1', bOnData, (_id, code) => { bExit = code }, 0)
    expect(att.replay).toBe('hello world!afterA')

    const cData: string[] = []
    let cExit: number | null = null
    const attC = await hub.attachPty('t1', (_id, d) => { cData.push(d) }, (_id, code) => { cExit = code }, att.offset)
    expect(attC.replay).toBe('')

    // Fan-out to both, replay cursor slices mid-stream correctly.
    f.emitData('t1', 'live')
    expect(bData.join('')).toBe('live')
    expect(cData.join('')).toBe('live')
    const attMid = await hub.attachPty('t1', noop, noop, att.offset)
    expect(attMid.replay).toBe('live')

    // Exit reaches every subscriber and unlists the session.
    f.emitExit('t1', 3)
    expect(bExit).toBe(3)
    expect(cExit).toBe(3)
    expect(await hub.listPtys()).toEqual([])
  })

  it('rejects a duplicate pty id instead of double-spawning', async () => {
    const f = makeFakes()
    const hub = createSessionHub(f.proc, f.agent)
    await hub.process.create({ id: 'dup', cols: 80, rows: 24, cwd: '/w' }, noop, noop)
    await expect(
      hub.process.create({ id: 'dup', cols: 80, rows: 24, cwd: '/w' }, noop, noop),
    ).rejects.toThrow(/already exists/)
  })

  it('attach to an unknown session throws', async () => {
    const f = makeFakes()
    const hub = createSessionHub(f.proc, f.agent)
    await expect(hub.attachPty('ghost', noop, noop)).rejects.toThrow(/No live pty session/)
  })
})

describe('SessionHub agents', () => {
  it('replays missed lines since a line cursor and fans out exit', async () => {
    const f = makeFakes()
    const hub = createSessionHub(f.proc, f.agent)

    const aLines: string[] = []
    const aOnLine = (_id: string, l: string): void => { aLines.push(l) }
    await hub.agent.start({ id: 'ag1', cwd: '/w' }, aOnLine, noop)
    f.emitLine('ag1', '{"n":1}')
    f.emitLine('ag1', '{"n":2}')
    await hub.detachAgent('ag1', aOnLine)
    f.emitLine('ag1', '{"n":3}')

    expect((await hub.listAgents()).map((s) => `${s.id}:${s.lines}`)).toEqual(['ag1:3'])
    const att = await hub.attachAgent('ag1', noop, noop, 2)
    expect(att.replay).toEqual(['{"n":3}'])
    expect(att.offset).toBe(3)

    let exitCode: number | null = null
    await hub.attachAgent('ag1', noop, (_id, code) => { exitCode = code }, att.offset)
    f.emitAgentExit('ag1', 0)
    expect(exitCode).toBe(0)
    expect(await hub.listAgents()).toEqual([])
  })
})
