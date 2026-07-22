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
import http from 'http'
import fs from 'fs'
import path from 'path'
import { WebSocketServer, type WebSocket } from 'ws'
import { RpcServer } from './rpcServer'
import type { Runtime } from '../main/runtime/types'

export interface WsServerOptions {
  host: string
  port: number
  token: string
  api: Runtime
  /** Directory of the built web client. When set, plain HTTP GETs serve it
   *  (SPA-style: unknown paths fall back to index.html), so ONE tailnet port
   *  carries both the app and its RPC. The assets are public on the bind
   *  address; the RPC still requires the token. */
  webRoot?: string
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

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

/** Static handler for the built web client. Path-traversal-safe (resolved
 *  target must stay inside webRoot); unknown paths fall back to the SPA
 *  index so client-side routing / bookmarked URLs work. */
function serveStatic(webRoot: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const target = path.resolve(webRoot, '.' + path.posix.normalize(url.pathname))
  if (!target.startsWith(path.resolve(webRoot))) {
    res.writeHead(403).end()
    return
  }
  const tryFiles = [target, path.join(webRoot, 'index.html'), path.join(webRoot, 'web.html')]
  for (const file of tryFiles) {
    let stat: fs.Stats
    try { stat = fs.statSync(file) } catch { continue }
    const resolved = stat.isDirectory() ? path.join(file, 'index.html') : file
    let body: Buffer
    try { body = fs.readFileSync(resolved) } catch { continue }
    res.writeHead(200, {
      'content-type': MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': resolved.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
    return
  }
  res.writeHead(404).end('not found')
}

export function startWsServer(opts: WsServerOptions): WsServerHandle {
  const log = opts.log ?? ((msg: string) => process.stderr.write(msg + '\n'))
  const httpServer = http.createServer((req, res) => {
    if (opts.webRoot) serveStatic(opts.webRoot, req, res)
    else res.writeHead(426, { 'content-type': 'text/plain' }).end('cate-runtime: WebSocket endpoint')
  })
  const wss = new WebSocketServer({ server: httpServer })
  httpServer.listen(opts.port, opts.host)
  const live = new Map<WebSocket, { server: RpcServer; alive: boolean }>()

  wss.on('connection', (ws, req) => {
    // Interactive terminal echo rides this socket as a stream of tiny frames.
    // With Nagle enabled the kernel holds each one until the previous segment
    // is ACKed — up to a full extra RTT of typing latency on a WAN link. ssh
    // sets TCP_NODELAY for interactive sessions for exactly this reason.
    req.socket.setNoDelay(true)
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

  httpServer.on('listening', () => log(`[ws] listening on ${opts.host}:${opts.port}${opts.webRoot ? ` (web root ${opts.webRoot})` : ''}`))
  httpServer.on('error', (err) => log(`[ws] server error: ${err.message}`))
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
      httpServer.close()
    },
    connectionCount: () => live.size,
  }
}
