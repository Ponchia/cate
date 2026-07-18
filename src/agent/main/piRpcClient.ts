// =============================================================================
// PiRpcClient — drives a pi `--mode rpc` process over a Runtime's agent
// channel (local in-process or remote over the daemon). It speaks pi's stdio
// JSONL protocol — requests carry an id, `{type:"response",id,success,data|error}`
// frames are correlated responses, everything else is an event — but the
// transport is `runtime.agent` instead of a child process pi-coding-agent
// owns. This is a standalone reimplementation so the desktop app no longer
// imports (or bundles) pi: pi ships only as the on-demand tarball the runtime
// installs on the host.
// =============================================================================

import type { Runtime } from '../../main/runtime/types'

export interface PiImageContent {
  type: 'image'
  data: string
  mimeType: string
}

interface PiResponse {
  type: 'response'
  id: string
  success: boolean
  data?: unknown
  error?: string
}

type PiEventListener = (event: unknown) => void

export interface PiRpcClientOptions {
  cwd: string
  env?: Record<string, string>
  provider?: string
  model?: string
  args?: string[]
  /** Explicit agent-session id. A DETERMINISTIC id (derived from the panel) is
   *  what makes persistent-runtime reattach possible: the next app run asks the
   *  daemon for the same id and rebinds to the surviving pi instead of spawning
   *  a second process onto the same session jsonl. */
  id?: string
}

let seq = 0

export class PiRpcClient {
  private readonly aid: string
  private readonly pending = new Map<string, { resolve: (r: PiResponse) => void; reject: (e: Error) => void }>()
  private readonly listeners: PiEventListener[] = []
  private readonly exitListeners: Array<(code: number, stderr?: string) => void> = []
  private reqId = 0
  // Request ids are unique ACROSS client instances (random component): after a
  // reattach, pi may still emit responses to the PREVIOUS client's in-flight
  // requests — a plain counter would restart at req_1 and mis-correlate them.
  private readonly reqPrefix = `req_${Math.random().toString(36).slice(2, 8)}`
  private started = false
  /** Set by stop()/dispose so an expected exit isn't reported as a crash. */
  private disposing = false
  private stderr = ''

  constructor(
    private readonly runtime: Runtime,
    private readonly options: PiRpcClientOptions,
  ) {
    this.aid = options.id ?? `pi-${++seq}-${runtime.id}`
  }

  get id(): string {
    return this.aid
  }

  /** The line/exit handlers shared by start (fresh spawn) and attach (rebind). */
  private handlers(): [(id: string, line: string) => void, (id: string, code: number, stderr?: string) => void] {
    return [
      (_id, line) => this.handleLine(line),
      (_id, code, stderr) => {
        if (stderr) this.stderr = stderr
        const detail = stderr ? `:\n${stderr}` : ''
        this.rejectAllPending(`pi process exited (code ${code})${detail}`)
        this.started = false
        if (!this.disposing) {
          for (const l of this.exitListeners) { try { l(code, stderr) } catch { /* noop */ } }
        }
      },
    ]
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('PiRpcClient already started')
    this.started = true
    const [onLine, onExit] = this.handlers()
    await this.runtime.agent.start(
      {
        id: this.aid,
        cwd: this.options.cwd,
        env: this.options.env,
        provider: this.options.provider,
        model: this.options.model,
        args: this.options.args,
      },
      onLine,
      onExit,
    )
  }

  /**
   * Rebind to a pi session that is ALREADY RUNNING on a persistent daemon
   * (detach-survival). No replay is requested — pi owns all conversation state,
   * and the agent layer reconstructs UI state through normal RPCs (get_state /
   * get_fork_messages); replayed historical lines would only risk confusing
   * response correlation. Throws when the daemon has no such live session —
   * the caller falls back to a fresh start().
   */
  async attach(): Promise<void> {
    if (this.started) throw new Error('PiRpcClient already started')
    const sessions = this.runtime.sessions
    if (!sessions) throw new Error('This runtime has no session registry')
    const [onLine, onExit] = this.handlers()
    await sessions.attachAgent(this.aid, onLine, onExit, Number.MAX_SAFE_INTEGER)
    this.started = true
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.disposing = true
    this.runtime.agent.stop(this.aid)
    this.rejectAllPending('pi session stopped')
    this.started = false
  }

  /**
   * Release this client WITHOUT stopping pi — the persistent daemon keeps the
   * process running (detach-survival) and a later client reattaches by the
   * same deterministic id. Used on window close / app quit for sessions hosted
   * on a persistent runtime; explicit panel close still uses stop().
   */
  async detach(): Promise<void> {
    if (!this.started) return
    this.disposing = true
    try { await this.runtime.sessions?.detachAgent(this.aid, () => {}) } catch { /* connection may be gone */ }
    this.rejectAllPending('pi session detached')
    this.started = false
  }

  onEvent(listener: PiEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i !== -1) this.listeners.splice(i, 1)
    }
  }

  /** Notified when pi exits UNEXPECTEDLY (not via stop()), with its exit code and
   *  recent stderr — so the agent layer can show the user why the agent died. */
  onExit(listener: (code: number, stderr?: string) => void): () => void {
    this.exitListeners.push(listener)
    return () => {
      const i = this.exitListeners.indexOf(listener)
      if (i !== -1) this.exitListeners.splice(i, 1)
    }
  }

  getStderr(): string {
    return this.stderr
  }

  /** Reject every in-flight request (session disposed / pi exited). */
  rejectAllPending(reason = 'pi session disposed'): void {
    const err = new Error(reason)
    for (const { reject } of this.pending.values()) {
      try { reject(err) } catch { /* noop */ }
    }
    this.pending.clear()
  }

  /** Write a raw object to pi's stdin (extension UI sub-protocol). */
  writeRaw(obj: unknown): void {
    this.runtime.agent.writeLine(this.aid, JSON.stringify(obj))
  }

  // ---- Command methods (1:1 with pi's RpcClient) --------------------------

  async prompt(message: string, images?: PiImageContent[]): Promise<void> { await this.send({ type: 'prompt', message, images }) }
  async steer(message: string, images?: PiImageContent[]): Promise<void> { await this.send({ type: 'steer', message, images }) }
  async followUp(message: string, images?: PiImageContent[]): Promise<void> { await this.send({ type: 'follow_up', message, images }) }
  async abort(): Promise<void> { await this.send({ type: 'abort' }) }

  async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
    return this.data(await this.send({ type: 'new_session', parentSession }))
  }
  async getState(): Promise<unknown> { return this.data(await this.send({ type: 'get_state' })) }
  async setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> {
    return this.data(await this.send({ type: 'set_model', provider, modelId }))
  }
  async setThinkingLevel(level: string): Promise<void> { await this.send({ type: 'set_thinking_level', level }) }
  async setSteeringMode(mode: 'all' | 'one-at-a-time'): Promise<void> { await this.send({ type: 'set_steering_mode', mode }) }
  async setFollowUpMode(mode: 'all' | 'one-at-a-time'): Promise<void> { await this.send({ type: 'set_follow_up_mode', mode }) }
  async compact(customInstructions?: string): Promise<unknown> { return this.data(await this.send({ type: 'compact', customInstructions })) }
  async setAutoCompaction(enabled: boolean): Promise<void> { await this.send({ type: 'set_auto_compaction', enabled }) }
  async setAutoRetry(enabled: boolean): Promise<void> { await this.send({ type: 'set_auto_retry', enabled }) }
  async abortRetry(): Promise<void> { await this.send({ type: 'abort_retry' }) }
  async bash(command: string): Promise<unknown> { return this.data(await this.send({ type: 'bash', command })) }
  async abortBash(): Promise<void> { await this.send({ type: 'abort_bash' }) }
  async getSessionStats(): Promise<unknown> { return this.data(await this.send({ type: 'get_session_stats' })) }
  async exportHtml(outputPath?: string): Promise<{ path: string }> { return this.data(await this.send({ type: 'export_html', outputPath })) }
  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> { return this.data(await this.send({ type: 'switch_session', sessionPath })) }
  async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> { return this.data(await this.send({ type: 'fork', entryId })) }
  async clone(): Promise<{ cancelled: boolean }> { return this.data(await this.send({ type: 'clone' })) }
  async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
    return this.data<{ messages: Array<{ entryId: string; text: string }> }>(await this.send({ type: 'get_fork_messages' })).messages
  }
  async setSessionName(name: string): Promise<void> { await this.send({ type: 'set_session_name', name }) }
  async getMessages(): Promise<unknown[]> {
    return this.data<{ messages: unknown[] }>(await this.send({ type: 'get_messages' })).messages
  }
  async getCommands(): Promise<Array<{ name: string; description: string; source: 'extension' | 'prompt' | 'skill'; sourceInfo?: { path?: string; scope?: 'user' | 'project' | 'temporary' } }>> {
    return this.data<{ commands: Array<{ name: string; description: string; source: 'extension' | 'prompt' | 'skill'; sourceInfo?: { path?: string; scope?: 'user' | 'project' | 'temporary' } }> }>(
      await this.send({ type: 'get_commands' }),
    ).commands
  }

  // ---- Internal -----------------------------------------------------------

  private handleLine(line: string): void {
    let data: unknown
    try { data = JSON.parse(line) } catch { return }
    const frame = data as PiResponse
    if (frame && frame.type === 'response' && frame.id && this.pending.has(frame.id)) {
      const p = this.pending.get(frame.id)!
      this.pending.delete(frame.id)
      p.resolve(frame)
      return
    }
    for (const listener of this.listeners) {
      try { listener(data) } catch { /* a bad listener must not break the pipe */ }
    }
  }

  private send(command: Record<string, unknown>): Promise<PiResponse> {
    if (!this.started) return Promise.reject(new Error('PiRpcClient not started'))
    const id = `${this.reqPrefix}_${++this.reqId}`
    return new Promise<PiResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout waiting for response to ${String(command.type)}`))
      }, 30000)
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.runtime.agent.writeLine(this.aid, JSON.stringify({ ...command, id }))
    })
  }

  private data<T = unknown>(response: PiResponse): T {
    if (!response.success) throw new Error(response.error ?? 'pi rpc error')
    return response.data as T
  }
}
