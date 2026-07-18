// =============================================================================
// WsRuntimeTransport — attaches to an ALREADY-RUNNING persistent daemon over a
// WebSocket, instead of launching one per connection the way the SSH/local
// transports do. This is the client half of the tmux model: the daemon is a
// long-lived service on the host (`cate-runtime --listen`), sessions live
// there, and this transport merely opens/closes a window onto it — so
// "bootstrap" and "uninstall" are meaningless here, and dispose() closes the
// socket without touching the daemon.
//
// URL shape: ws://host:port/?token=<secret> (or wss:// behind a TLS proxy).
// The token rides the query string; privacy comes from the overlay network
// (Tailscale) or TLS — same trust model as the daemon's listener.
// =============================================================================

import type { RuntimeTransport, RuntimeChannel } from './transport'

export class WsRuntimeTransport implements RuntimeTransport {
  // 'server' keeps the manager's phase mapping (a ws daemon IS a server host);
  // the transport's behavior differences are all internal.
  readonly kind = 'server'
  private ws: WebSocket | null = null

  constructor(private readonly url: string) {}

  // No isInstalled probe: launch() either connects (installed & running) or
  // fails (the manager maps that to `unreachable`, which is accurate — the
  // service isn't reachable; there is nothing this client could install).

  async bootstrap(): Promise<void> {
    // Nothing to install from here — the persistent daemon is provisioned on
    // the host (systemd unit). Reaching this path means the manager was asked
    // to install over a ws URL; make the misuse loud instead of silent.
    throw new Error('A persistent runtime (ws://) is provisioned on the host itself, not from the client.')
  }

  async launch(): Promise<RuntimeChannel> {
    // Electron main's Node ships the WHATWG WebSocket client (Node ≥ 22).
    const ws = new WebSocket(this.url)
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => { cleanup(); resolve() }
      const onError = (): void => { cleanup(); reject(new Error(`Could not reach the persistent runtime at ${redact(this.url)}`)) }
      const onClose = (ev: CloseEvent): void => {
        cleanup()
        reject(new Error(ev.code === 4401
          ? 'The persistent runtime rejected the auth token.'
          : `Connection to the persistent runtime closed (code ${ev.code}).`))
      }
      const cleanup = (): void => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onError)
        ws.removeEventListener('close', onClose)
      }
      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onError)
      ws.addEventListener('close', onClose)
    })

    let onData: ((chunk: string | Buffer) => void) | null = null
    let onClose: ((info: { code: number | null }) => void) | null = null
    ws.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf-8')
      onData?.(data)
    })
    ws.addEventListener('close', (ev) => { onClose?.({ code: ev.code ?? null }) })
    ws.addEventListener('error', () => { /* close follows */ })

    return {
      write: (line: string) => { ws.send(line) },
      onData: (cb) => { onData = cb },
      onClose: (cb) => { onClose = cb },
      kill: () => { try { ws.close() } catch { /* already closed */ } },
    }
  }

  async dispose(): Promise<void> {
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
  }
}

/** The url with its token elided — for error messages and logs. */
function redact(url: string): string {
  return url.replace(/([?&]token=)[^&]*/, '$1…')
}
