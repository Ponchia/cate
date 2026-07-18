// =============================================================================
// Web client entry — polyfills, the electronAPI shim, then the REAL renderer
// <App/>. When no runtime is configured yet (bare visit, no stored config), a
// minimal connect form collects the ws URL + token + workspace path and
// reloads with them as URL params (which config.ts persists + scrubs).
// =============================================================================

// Buffer polyfill FIRST — the shared RPC/locator stack uses Buffer.
import { Buffer } from 'buffer'
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
;(globalThis as unknown as { process?: { env: Record<string, string> } }).process ??= { env: {} }

// crypto.randomUUID exists only in secure contexts; a tailnet-served page is
// plain http, so polyfill it from getRandomValues (RFC 4122 v4).
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  ;(crypto as { randomUUID?: () => string }).randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`
  }
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import { IconContext } from '@phosphor-icons/react'
import { loadConfig } from './config'
import { installElectronApiShim } from './electronApiShim'
import '../renderer/styles/globals.css'
import '@xterm/xterm/css/xterm.css'

const config = loadConfig()

function ConnectForm(): React.ReactElement {
  const [ws, setWs] = React.useState('wss://')
  const [token, setToken] = React.useState('')
  const [path, setPath] = React.useState('')
  const submit = (): void => {
    const params = new URLSearchParams({ ws, token, path })
    window.location.search = params.toString()
  }
  const input: React.CSSProperties = {
    display: 'block', width: '100%', margin: '6px 0 14px', padding: '10px 12px',
    background: '#2a2926', color: '#e8e6e3', border: '1px solid #3a3835', borderRadius: 8, fontSize: 14,
  }
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1f1e1c', color: '#e8e6e3', fontFamily: '-apple-system, system-ui, sans-serif' }}>
      <div style={{ width: 'min(420px, 90vw)' }}>
        <h1 style={{ fontSize: 18, marginBottom: 4 }}>Connect to your Cate runtime</h1>
        <p style={{ fontSize: 12, color: '#8b8781', marginBottom: 20 }}>
          The persistent daemon keeps your terminals and agents running; this device is just a window onto it.
        </p>
        <label style={{ fontSize: 12 }}>Runtime URL</label>
        <input style={input} value={ws} onChange={(e) => setWs(e.target.value)} placeholder="ws://100.64.0.7:7777" />
        <label style={{ fontSize: 12 }}>Token</label>
        <input style={input} value={token} onChange={(e) => setToken(e.target.value)} type="password" />
        <label style={{ fontSize: 12 }}>Workspace path</label>
        <input style={input} value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/ubuntu/bronto" />
        <button
          onClick={submit}
          disabled={!ws || !token || !path}
          style={{ padding: '10px 18px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', opacity: !ws || !token || !path ? 0.5 : 1 }}
        >
          Connect
        </button>
      </div>
    </div>
  )
}

async function boot(): Promise<void> {
  const rootEl = document.getElementById('root')!
  if (!config) {
    ReactDOM.createRoot(rootEl).render(<ConnectForm />)
    return
  }

  const { client } = installElectronApiShim(config)
  client.start()

  // Import the real renderer ONLY after the shim exists — module init across
  // the renderer tree reads window.electronAPI freely.
  const [{ default: App }, { default: log }] = await Promise.all([
    import('../renderer/App'),
    import('../renderer/lib/logger'),
  ])

  log.info('Web client starting (runtime %s, root %s)', config.wsUrl, config.rootPath)

  class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null }
    static getDerivedStateFromError(error: Error): { error: Error } {
      return { error }
    }
    render(): React.ReactNode {
      if (this.state.error) {
        return (
          <div style={{ color: 'red', padding: 20, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            <h2>Render Error</h2>
            <p>{this.state.error.message}</p>
            <pre>{this.state.error.stack}</pre>
          </div>
        )
      }
      return this.props.children
    }
  }

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <IconContext.Provider value={{ weight: 'regular' }}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </IconContext.Provider>
    </React.StrictMode>,
  )
}

void boot()
