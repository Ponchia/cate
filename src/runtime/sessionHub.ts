// =============================================================================
// SessionHub — the tmux-server half of the persistent daemon. Owns the registry
// of live pty and agent sessions, a bounded replay ring per session, and the
// per-session subscriber fan-out. Capabilities stay dumb: the hub wraps the leaf
// ProcessHost/AgentHost create/start so ALL output flows through it — into the
// ring (for attach replay) and out to every subscribed connection.
//
// Lifecycle contract:
//   - create/start registers the caller's callbacks as the first subscriber.
//   - A connection closing detaches its subscribers; the session KEEPS RUNNING.
//   - attach subscribes another callback pair and returns buffered replay since
//     a byte/line cursor (0 → the whole ring), atomically with the subscription
//     (both happen in one synchronous block, so no output is lost or doubled).
//   - Process exit broadcasts the exit payload to every subscriber and removes
//     the session. Explicit kill/stop flows through unchanged (exit does the
//     bookkeeping when the process actually dies).
//
// The hub is electron-free and runs in both daemon modes; in stdio mode it is
// inert extra bookkeeping (the daemon dies with its single connection).
// =============================================================================

import type {
  ProcessHost,
  AgentHost,
  PtyCreateOptions,
  PtyHandle,
  AgentStartOptions,
  AgentHandle,
  PtySessionInfo,
  AgentSessionInfo,
  PtyAttachResult,
  AgentAttachResult,
  SessionsHost,
} from '../main/runtime/types'

/** Byte-capped chunk ring with an absolute offset, so a reattaching client can
 *  ask for "everything since byte N" and get exactly the missed tail (clipped
 *  to what the ring still holds). */
class ChunkRing {
  private chunks: string[] = []
  private bytes = 0
  /** Absolute offset of the FIRST byte still held in the ring. */
  private start = 0
  /** Absolute offset one past the LAST byte held (== total bytes ever pushed). */
  end = 0

  constructor(private readonly capBytes: number) {}

  push(data: string): void {
    const len = Buffer.byteLength(data, 'utf-8')
    this.chunks.push(data)
    this.bytes += len
    this.end += len
    while (this.bytes > this.capBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!
      const droppedLen = Buffer.byteLength(dropped, 'utf-8')
      this.bytes -= droppedLen
      this.start += droppedLen
    }
  }

  /** Everything from absolute byte `since` on (clipped to the ring's start). */
  replaySince(since: number): string {
    if (since >= this.end) return ''
    if (since <= this.start) return this.chunks.join('')
    // Walk chunks tracking absolute offsets; slice inside the boundary chunk.
    let offset = this.start
    const parts: string[] = []
    for (const chunk of this.chunks) {
      const len = Buffer.byteLength(chunk, 'utf-8')
      if (offset + len <= since) { offset += len; continue }
      if (offset >= since) { parts.push(chunk) }
      else {
        // The boundary falls inside this chunk. Byte-slice via Buffer so a
        // multi-byte codepoint at the boundary can't corrupt the count (worst
        // case the client renders one broken glyph at the seam).
        parts.push(Buffer.from(chunk, 'utf-8').subarray(since - offset).toString('utf-8'))
      }
      offset += len
    }
    return parts.join('')
  }
}

/** Count-and-byte-capped line ring (agent stdout is JSONL; lines are the unit). */
class LineRing {
  private lines: string[] = []
  private bytes = 0
  private start = 0
  end = 0

  constructor(private readonly capLines: number, private readonly capBytes: number) {}

  push(line: string): void {
    this.lines.push(line)
    this.bytes += line.length
    this.end += 1
    while ((this.lines.length > this.capLines || this.bytes > this.capBytes) && this.lines.length > 1) {
      this.bytes -= this.lines.shift()!.length
      this.start += 1
    }
  }

  replaySince(since: number): string[] {
    if (since >= this.end) return []
    const from = Math.max(since, this.start)
    return this.lines.slice(from - this.start)
  }
}

interface PtySession {
  info: PtySessionInfo
  ring: ChunkRing
  subscribers: Map<(id: string, data: string) => void, (id: string, exitCode: number) => void>
}

interface AgentSession {
  info: AgentSessionInfo
  ring: LineRing
  subscribers: Map<(id: string, line: string) => void, (id: string, code: number, stderr?: string) => void>
}

const PTY_RING_BYTES = 1024 * 1024 // 1 MiB of scrollback per pty
const AGENT_RING_LINES = 10_000
const AGENT_RING_BYTES = 8 * 1024 * 1024

export interface SessionHub extends SessionsHost {
  /** ProcessHost facade — same contract, but output fans out through the hub. */
  process: ProcessHost
  /** AgentHost facade — same contract, but lines fan out through the hub. */
  agent: AgentHost
  /** Drop every subscription owned by the given callbacks (connection closed).
   *  Sessions keep running; only the fan-out entries go away. */
  dropSubscribers(ptyOnData: Set<(id: string, data: string) => void>, agentOnLine: Set<(id: string, line: string) => void>): void
}

export function createSessionHub(leafProcess: ProcessHost, leafAgent: AgentHost): SessionHub {
  const ptys = new Map<string, PtySession>()
  const agents = new Map<string, AgentSession>()

  const broadcastPtyData = (id: string, data: string): void => {
    const s = ptys.get(id)
    if (!s) return
    s.ring.push(data)
    s.info.bytes = s.ring.end
    for (const onData of s.subscribers.keys()) {
      try { onData(id, data) } catch { /* one dead sink must not break the rest */ }
    }
  }

  const broadcastPtyExit = (id: string, exitCode: number): void => {
    const s = ptys.get(id)
    if (!s) return
    ptys.delete(id)
    for (const onExit of s.subscribers.values()) {
      try { onExit(id, exitCode) } catch { /* ignore */ }
    }
  }

  const broadcastAgentLine = (id: string, line: string): void => {
    const s = agents.get(id)
    if (!s) return
    s.ring.push(line)
    s.info.lines = s.ring.end
    for (const onLine of s.subscribers.keys()) {
      try { onLine(id, line) } catch { /* ignore */ }
    }
  }

  const broadcastAgentExit = (id: string, code: number, stderr?: string): void => {
    const s = agents.get(id)
    if (!s) return
    agents.delete(id)
    for (const onExit of s.subscribers.values()) {
      try { onExit(id, code, stderr) } catch { /* ignore */ }
    }
  }

  const process: ProcessHost = {
    async create(opts: PtyCreateOptions, onData, onExit): Promise<PtyHandle> {
      if (opts.id && ptys.has(opts.id)) {
        // A surviving session already owns this id — the caller meant attach
        // (or its id generator repeated). Never silently double-spawn.
        throw new Error(`pty session "${opts.id}" already exists; attach instead`)
      }
      const handle = await leafProcess.create(opts, broadcastPtyData, broadcastPtyExit)
      const session: PtySession = {
        info: {
          id: handle.id,
          pid: handle.pid,
          shell: handle.shell,
          cwd: opts.cwd || undefined,
          createdAt: Date.now(),
          bytes: 0,
        },
        ring: new ChunkRing(PTY_RING_BYTES),
        subscribers: new Map([[onData, onExit]]),
      }
      ptys.set(handle.id, session)
      return handle
    },
    write: (id, data) => leafProcess.write(id, data),
    resize: (id, cols, rows) => leafProcess.resize(id, cols, rows),
    kill: (id) => leafProcess.kill(id),
    getCwd: (id) => leafProcess.getCwd(id),
    setVisibility: (id, visible) => leafProcess.setVisibility(id, visible),
    scanActivity: (ids) => leafProcess.scanActivity(ids),
    scanPorts: (ids) => leafProcess.scanPorts(ids),
  }

  const agent: AgentHost = {
    ensurePi: () => leafAgent.ensurePi(),
    async start(opts: AgentStartOptions, onLine, onExit): Promise<AgentHandle> {
      if (agents.has(opts.id)) {
        throw new Error(`agent session "${opts.id}" already exists; attach instead`)
      }
      const handle = await leafAgent.start(opts, broadcastAgentLine, broadcastAgentExit)
      const session: AgentSession = {
        info: { id: opts.id, pid: handle.pid, cwd: opts.cwd, createdAt: Date.now(), lines: 0 },
        ring: new LineRing(AGENT_RING_LINES, AGENT_RING_BYTES),
        subscribers: new Map([[onLine, onExit]]),
      }
      agents.set(opts.id, session)
      return handle
    },
    writeLine: (id, line) => leafAgent.writeLine(id, line),
    stop: (id) => leafAgent.stop(id),
  }

  return {
    process,
    agent,

    async listPtys(): Promise<PtySessionInfo[]> {
      return [...ptys.values()].map((s) => ({ ...s.info }))
    },

    async attachPty(id, onData, onExit, sinceByte = 0): Promise<PtyAttachResult> {
      const s = ptys.get(id)
      if (!s) throw new Error(`No live pty session "${id}"`)
      // Subscribe and snapshot in one synchronous block: every byte is either
      // in the replay or delivered live, never both, never neither.
      s.subscribers.set(onData, onExit)
      return { replay: s.ring.replaySince(sinceByte), offset: s.ring.end, info: { ...s.info } }
    },

    async detachPty(id, onData): Promise<void> {
      ptys.get(id)?.subscribers.delete(onData)
    },

    async listAgents(): Promise<AgentSessionInfo[]> {
      return [...agents.values()].map((s) => ({ ...s.info }))
    },

    async attachAgent(id, onLine, onExit, sinceLine = 0): Promise<AgentAttachResult> {
      const s = agents.get(id)
      if (!s) throw new Error(`No live agent session "${id}"`)
      s.subscribers.set(onLine, onExit)
      return { replay: s.ring.replaySince(sinceLine), offset: s.ring.end, info: { ...s.info } }
    },

    async detachAgent(id, onLine): Promise<void> {
      agents.get(id)?.subscribers.delete(onLine)
    },

    dropSubscribers(ptyOnData, agentOnLine): void {
      for (const s of ptys.values()) {
        for (const fn of ptyOnData) s.subscribers.delete(fn)
      }
      for (const s of agents.values()) {
        for (const fn of agentOnLine) s.subscribers.delete(fn)
      }
    },
  }
}
