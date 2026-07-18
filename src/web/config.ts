// =============================================================================
// Web client config — which persistent runtime to attach to and which
// workspace root to open. Sourced from URL parameters on first visit
// (`?ws=ws://host:port&token=…&path=/home/user/proj`), then persisted to
// localStorage so later visits (and the installed PWA / Android app, which
// launch with a bare URL) reconnect without re-entering anything. The token is
// scrubbed from the address bar immediately.
// =============================================================================

export interface WebConfig {
  /** ws:// or wss:// URL of the persistent daemon (no token). */
  wsUrl: string
  token: string
  /** Host-absolute workspace root on the daemon. */
  rootPath: string
  /** Display name for the workspace. */
  name: string
}

const KEY = 'cate-web-config'

export function loadConfig(): WebConfig | null {
  const params = new URLSearchParams(window.location.search)
  const stored = ((): WebConfig | null => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as WebConfig) : null
    } catch {
      return null
    }
  })()

  const ws = params.get('ws') ?? stored?.wsUrl
  const token = params.get('token') ?? stored?.token
  const rootPath = params.get('path') ?? stored?.rootPath
  if (!ws || !token || !rootPath) return stored
  const name = params.get('name') ?? stored?.name ?? rootPath.split('/').filter(Boolean).pop() ?? 'workspace'

  const config: WebConfig = { wsUrl: ws, token, rootPath, name }
  try { localStorage.setItem(KEY, JSON.stringify(config)) } catch { /* private mode */ }

  // Scrub the sensitive parts out of the visible URL/history.
  if (params.has('token') || params.has('ws') || params.has('path')) {
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
  }
  return config
}

export function clearConfig(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
