// =============================================================================
// wsServer — the persistent daemon's listener. Where the stdio entry serves ONE
// client for the daemon's lifetime, this serves any number of concurrent
// connections, each with its own RpcServer over the shared Runtime. A closing
// connection disposes only its RpcServer (detaching its stream subscriptions);
// the Runtime — and every pty/agent session in its hub — keeps running.
//
// Auth: every connection must present the daemon's token, either as a
// `?token=` query parameter or an `x-cate-token` header. Compared in constant
// time. The listener is expected to bind a private address (a tailnet IP or
// loopback) — it speaks plain ws; transport privacy comes from the overlay
// network (Tailscale/WireGuard) or a TLS-terminating proxy in front.
// =============================================================================

import { createHash, timingSafeEqual } from 'crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { RpcServer } from './rpcServer'
import type { Runtime } from '../main/runtime/types'

export interface WsServerOptions {
  host: string
  port: number
  token: string
  api: Runtime
  log?: (msg: string) => void
}

export interface WsServerHandle {
  close(): void
  /** Number of currently-open client connections (introspection/tests). */
  connectionCount(): number
}

/** Constant-time token check (hash both sides so lengths never leak). */
function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

const HEARTBEAT_MS = 30_000

export function startWsServer(opts: WsServerOptions): WsServerHandle {
  const log = opts.log ?? ((msg: string) => process.stderr.write(msg + '\n'))
  const wss = new WebSocketServer({ host: opts.host, port: opts.port })
  const live = new Map<WebSocket, { server: RpcServer; alive: boolean }>()

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const presented = url.searchParams.get('token') ?? (req.headers['x-cate-token'] as string | undefined)
    if (!tokenMatches(presented ?? undefined, opts.token)) {
      log(`[ws] rejected connection from ${req.socket.remoteAddress ?? '?'} (bad token)`)
      ws.close(4401, 'unauthorized')
      return
    }

    const server = new RpcServer(opts.api, (line) => {
      // ws.send after close throws synchronously in some states — a dead peer
      // must never take down the daemon or the other connections' fan-out.
      try { ws.send(line) } catch { /* peer gone; close handler cleans up */ }
    })
    const entry = { server, alive: true }
    live.set(ws, entry)
    log(`[ws] client connected (${req.socket.remoteAddress ?? '?'}); ${live.size} attached`)

    ws.on('message', (data) => {
      server.handleChunk(typeof data === 'string' ? data : data.toString())
    })
    ws.on('pong', () => { entry.alive = true })
    ws.on('close', () => {
      live.delete(ws)
      server.dispose() // detaches this connection's subscriptions; sessions live on
      log(`[ws] client detached; ${live.size} attached`)
    })
    ws.on('error', () => { /* close follows; handled there */ })

    server.start() // hello
  })

  // Heartbeat: terminate peers that miss a ping round-trip, so a silently-dead
  // link (laptop lid closed mid-connection) frees its subscriptions promptly
  // instead of fanning output into a black hole until TCP notices.
  const heartbeat = setInterval(() => {
    for (const [ws, entry] of live) {
      if (!entry.alive) { ws.terminate(); continue }
      entry.alive = false
      try { ws.ping() } catch { /* close follows */ }
    }
  }, HEARTBEAT_MS)
  if (heartbeat.unref) heartbeat.unref()

  wss.on('listening', () => log(`[ws] listening on ${opts.host}:${opts.port}`))
  wss.on('error', (err) => log(`[ws] server error: ${err.message}`))

  return {
    close: () => {
      clearInterval(heartbeat)
      for (const [ws, entry] of live) {
        entry.server.dispose()
        try { ws.close() } catch { /* ignore */ }
      }
      live.clear()
      wss.close()
    },
    connectionCount: () => live.size,
  }
}
