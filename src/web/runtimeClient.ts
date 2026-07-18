// =============================================================================
// Web runtime client — the browser's stand-in for RuntimeManager: ONE
// RemoteRuntime over a WebSocket to the persistent daemon, with mosh-style
// auto-reconnect (exponential backoff, retrying indefinitely) and connect/
// disconnect listeners the shim uses to reattach terminals and refresh state.
//
// Reuses the REAL protocol stack — RuntimeRpcClient + RemoteRuntime — which is
// electron-free TS; only Buffer needs the browser polyfill (installed by
// src/web/main.tsx before anything else loads).
// =============================================================================

import { RuntimeRpcClient } from '../main/runtime/rpcClient'
import { RemoteRuntime } from '../main/runtime/RemoteRuntime'
import log from '../renderer/lib/logger'

/** The single web client's runtime id — locators only live inside this page. */
export const WEB_RUNTIME_ID = 'srv_web'

export type RuntimePhaseCb = (phase: 'connecting' | 'connected' | 'disconnected', message?: string) => void

export class WebRuntimeClient {
  private ws: WebSocket | null = null
  private rpc: RuntimeRpcClient | null = null
  private _runtime: RemoteRuntime | null = null
  private attempt = 0
  private stopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly connectedListeners = new Set<(runtime: RemoteRuntime) => void | Promise<void>>()
  private readonly phaseListeners = new Set<RuntimePhaseCb>()
  /** Resolves (repeatedly re-armed) whenever a live runtime is available. */
  private readyResolvers: Array<(r: RemoteRuntime) => void> = []

  constructor(private readonly url: string) {}

  get runtime(): RemoteRuntime | null {
    return this._runtime
  }

  /** A live runtime, waiting through any in-flight (re)connect. */
  ready(): Promise<RemoteRuntime> {
    if (this._runtime) return Promise.resolve(this._runtime)
    return new Promise((resolve) => { this.readyResolvers.push(resolve) })
  }

  onConnected(cb: (runtime: RemoteRuntime) => void | Promise<void>): () => void {
    this.connectedListeners.add(cb)
    return () => this.connectedListeners.delete(cb)
  }

  onPhase(cb: RuntimePhaseCb): () => void {
    this.phaseListeners.add(cb)
    return () => this.phaseListeners.delete(cb)
  }

  private emitPhase(phase: 'connecting' | 'connected' | 'disconnected', message?: string): void {
    for (const cb of this.phaseListeners) {
      try { cb(phase, message) } catch { /* listener */ }
    }
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  private connect(): void {
    if (this.stopped) return
    this.emitPhase('connecting', this.attempt > 0 ? `Reconnecting (attempt ${this.attempt})…` : undefined)
    const ws = new WebSocket(this.url)
    this.ws = ws
    const rpc = new RuntimeRpcClient((line) => ws.send(line))
    this.rpc = rpc

    ws.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : ''
      if (data) rpc.handleChunk(data)
    })
    ws.addEventListener('close', (ev) => {
      const wasLive = this._runtime !== null
      this._runtime = null
      rpc.dispose(`connection closed (code ${ev.code})`)
      if (this.stopped) return
      if (wasLive) this.emitPhase('disconnected')
      this.scheduleReconnect(ev.code === 4401 ? 'auth rejected' : undefined)
    })
    ws.addEventListener('error', () => { /* close follows */ })

    rpc.ready.then(async (hello) => {
      this.attempt = 0
      const runtime = new RemoteRuntime(WEB_RUNTIME_ID, rpc)
      this._runtime = runtime
      log.info('[web-runtime] connected (daemon %s, node %s)', hello.runtimeVersion, hello.node.version)
      // Run connected hooks (root replay, terminal reattach) BEFORE announcing
      // ready/connected, mirroring the desktop manager's ordering guarantees.
      for (const cb of this.connectedListeners) {
        try { await cb(runtime) } catch (err) { log.warn('[web-runtime] onConnected hook failed:', err) }
      }
      const resolvers = this.readyResolvers
      this.readyResolvers = []
      for (const r of resolvers) r(runtime)
      this.emitPhase('connected')
    }).catch(() => { /* close handler drives the retry */ })
  }

  private scheduleReconnect(reason?: string): void {
    if (this.stopped || this.reconnectTimer) return
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(this.attempt, 4))
    this.attempt++
    log.info('[web-runtime] reconnecting in %dms%s', delay, reason ? ` (${reason})` : '')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
