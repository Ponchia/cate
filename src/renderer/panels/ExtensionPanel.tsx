// =============================================================================
// ExtensionPanel — minimal webview host for a frontend extension panel.
//
// Modeled on BrowserPanel's <webview> usage (ref typing, dom-ready, stable
// src, keyed remount) but stripped of all browser chrome: no URL bar, no
// navigation, no proxy. On mount it asks the main process for the proxied URL
// + preload script that serve this extension's panel, then renders an Electron
// <webview> pointed at it. The session partition is keyed to the extension id
// so each extension gets its own persistent storage, stable across restarts.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { PuzzlePiece } from '@phosphor-icons/react'
import { portalRegistry } from '../lib/portalRegistry'
import { useExtensionsStore, ensureExtensionsStarted } from '../stores/extensionsStore'
import { CATE_HOST_EVENT } from '../../shared/ipc-channels'
import type { CateDroppedFile } from '../../shared/cate-host-api'
import type { ExtensionPanelProps } from './types'

// Cap forwarded file content so a huge drop can't choke the IPC bridge / guest.
const MAX_DROP_BYTES = 32 * 1024 * 1024

// -----------------------------------------------------------------------------
// Type declarations for Electron's <webview> element (mirrors BrowserPanel).
// -----------------------------------------------------------------------------

interface WebviewElement extends HTMLElement {
  reload(): void
  getWebContentsId(): number
  send(channel: string, ...args: unknown[]): void
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
}

// -----------------------------------------------------------------------------
// File-drop forwarding. A Cate file-explorer drag is an in-renderer DnD the
// isolated guest <webview> can never see, AND an HTML overlay can't reliably sit
// above a webview to catch it. So when the extension declares `files.drop` we
// catch the drop at the WINDOW capture phase, hit-test it against this panel's
// rect, read the file host-side (the user's drag authorises it — the guest never
// touches the filesystem), and push the content to the guest on the same
// `cate:event` channel its preload already listens on. OS-file drops are NOT
// handled here: they reach the guest's own DOM natively, so the extension reads
// them itself (file.text()) without any host involvement.
// -----------------------------------------------------------------------------

/** True when the manifest's declared scopes grant file drops. */
function grantsFileDrop(scopes: string[] | undefined): boolean {
  return !!scopes && scopes.some((s) => s === 'files' || s === 'files.drop')
}

function clampText(text: string): { text: string; truncated: boolean } {
  // Byte-aware clamp: most session files are ASCII-ish, but guard multi-byte.
  if (text.length <= MAX_DROP_BYTES) return { text, truncated: false }
  return { text: text.slice(0, MAX_DROP_BYTES), truncated: true }
}

/** Resolve a drop event into the files to hand the guest. OS drops carry File
 *  objects we read in-renderer (any path, no workspace restriction); Cate
 *  file-explorer drops carry in-workspace paths read over IPC.
 *  Exported for unit testing. */
export async function readDroppedFiles(
  dt: DataTransfer,
  workspaceId: string,
): Promise<CateDroppedFile[]> {
  const out: CateDroppedFile[] = []

  // 1. OS files: content is already in the renderer — read it directly so paths
  //    outside the workspace (e.g. ~/.claude/projects) work without a grant.
  for (const file of Array.from(dt.files ?? [])) {
    try {
      const raw = await file.text()
      const { text, truncated } = clampText(raw)
      let filePath: string | null = null
      try { filePath = window.electronAPI.getPathForFile(file) || null } catch { filePath = null }
      out.push({ name: file.name, path: filePath, text, size: file.size, truncated })
    } catch { /* unreadable file — skip */ }
  }
  if (out.length > 0) return out

  // 2. Cate file-explorer drag: a path (or JSON array of paths) we read via IPC.
  const paths: string[] = []
  const many = dt.getData('application/cate-files')
  if (many) {
    try { for (const p of JSON.parse(many)) if (typeof p === 'string') paths.push(p) } catch { /* ignore */ }
  }
  if (paths.length === 0) {
    const one = dt.getData('application/cate-file')
    if (one) paths.push(one)
  }
  for (const p of paths) {
    try {
      const raw = await window.electronAPI.fsReadFile(p, workspaceId)
      const { text, truncated } = clampText(raw)
      out.push({ name: p.split('/').pop() || p, path: p, text, truncated })
    } catch { /* denied / unreadable — skip */ }
  }
  return out
}

type ResolveState =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string; preloadPath: string }
  | { phase: 'error'; message?: string }

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export default function ExtensionPanel({
  panelId,
  workspaceId,
  extensionId,
  extensionPanelId,
}: ExtensionPanelProps) {
  const webviewRef = useRef<WebviewElement | null>(null)
  const [state, setState] = useState<ResolveState>({ phase: 'loading' })
  // Bumped by Retry to force the resolve effect to re-run.
  const [retryNonce, setRetryNonce] = useState(0)

  // Ensure the extension registry is loaded so the manifest (and its scopes) is
  // available even when this panel was opened without going through the toolbar.
  useEffect(() => { ensureExtensionsStarted() }, [])

  // The wrapper element, used to hit-test window-level drops against this panel.
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Does this extension accept file drops? (manifest `files.drop` scope). When it
  // does, the wrapper is a [data-filedrop] target (so the shared indicator shows)
  // and a window-capture listener forwards in-app drops to the guest.
  const acceptsDrops = useExtensionsStore((s) =>
    grantsFileDrop(s.entries.find((e) => e.manifest.id === extensionId)?.manifest.cateApi),
  )

  // workspaceId comes from the panel props (renderPanelComponent passes the
  // owning window's workspace). It is NOT read from window.location.search —
  // the main window has no workspaceId query param, so that yielded '' and every
  // reverse-API call (and the server's CATE_API session) resolved no workspace:
  // storage returned `no-storage`, openFile/createPanel targeted nothing.

  // Resolve the proxied URL + preload for this extension panel. Re-runs if the
  // slot is reused for a different extension/panel (deps below). A missing
  // extensionId, or a null reply (extension not enabled / not found), lands in
  // the error state. For a server-backed extension this also spawns + awaits the
  // server; a spawn/ready failure returns { error }, rendered as the error state.
  useEffect(() => {
    if (!extensionId) {
      setState({ phase: 'error' })
      return
    }
    let cancelled = false
    setState({ phase: 'loading' })
    window.electronAPI
      .extensionProxyUrl({ extensionId, workspaceId, panelId })
      .then((res) => {
        if (cancelled) return
        if (res && 'url' in res) setState({ phase: 'ready', url: res.url, preloadPath: res.preloadPath })
        else if (res && 'error' in res) setState({ phase: 'error', message: res.error })
        else setState({ phase: 'error' })
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' })
      })
    return () => { cancelled = true }
  }, [extensionId, extensionPanelId, panelId, workspaceId, retryNonce])

  // On unmount, tell main this server-backed panel closed so it can start the
  // grace timer (and stop the server when the last panel leaves). Harmless for
  // frontend-only extensions (main ignores unknown sessions).
  useEffect(() => {
    return () => {
      if (!extensionId) return
      try { window.electronAPI.extensionPanelClosed({ extensionId, workspaceId, panelId }) } catch { /* ignore */ }
    }
  }, [extensionId, workspaceId, panelId])

  const onRetry = (): void => {
    if (!extensionId) return
    void window.electronAPI
      .extensionServerRestart({ extensionId, workspaceId })
      .catch(() => undefined)
      .finally(() => setRetryNonce((n) => n + 1))
  }

  // In-app (Cate file-explorer) drags are an HTML5 DnD the isolated guest
  // <webview> can't see — and while the cursor is over the webview it captures
  // the drag, so neither the host's drop handler nor the shared drop indicator
  // ever fire over the panel. Fix: while a Cate drag is in flight, make the
  // webview transparent to hit-testing (pointer-events:none) so dragover/drop
  // fall through to the host DOM. The shared tracker can then find this panel's
  // [data-filedrop] wrapper (indicator shows), and we hit-test the drop against
  // it, read the file host-side, and push it to the guest on the `cate:event`
  // channel its preload listens on. OS-file drags (types are just 'Files') are
  // left alone — the guest handles those natively via its own DOM.
  useEffect(() => {
    if (!acceptsDrops || state.phase !== 'ready') return

    const isCateDrag = (dt: DataTransfer | null): boolean =>
      !!dt && (dt.types.includes('application/cate-file') || dt.types.includes('application/cate-files'))

    const setPassthrough = (on: boolean): void => {
      const webview = webviewRef.current
      if (webview) webview.style.pointerEvents = on ? 'none' : ''
    }

    const onDragOver = (e: DragEvent): void => {
      if (isCateDrag(e.dataTransfer)) setPassthrough(true)
    }
    const onDragLeave = (e: DragEvent): void => {
      // relatedTarget null === cursor left the window entirely.
      if (!e.relatedTarget) setPassthrough(false)
    }
    const onDragEnd = (): void => setPassthrough(false)
    const onWindowDrop = (e: DragEvent): void => {
      setPassthrough(false)
      const dt = e.dataTransfer
      const root = rootRef.current
      const webview = webviewRef.current
      if (!dt || !root || !webview || !isCateDrag(dt)) return
      const r = root.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
      // The drop is over this panel: claim it so the canvas/dock doesn't also open
      // the file, then forward the content to the guest.
      e.preventDefault()
      e.stopPropagation()
      void readDroppedFiles(dt, workspaceId).then((files) => {
        if (files.length === 0) return
        try {
          webview.send(CATE_HOST_EVENT, { panelId, topic: 'files.drop', payload: { files } })
        } catch { /* guest gone */ }
      })
    }

    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('dragend', onDragEnd, true)
    window.addEventListener('drop', onWindowDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('dragend', onDragEnd, true)
      window.removeEventListener('drop', onWindowDrop, true)
      setPassthrough(false)
    }
  }, [acceptsDrops, state.phase, workspaceId, panelId])

  // Register the live guest webContents with the portal registry once it's up
  // (mirrors BrowserPanel) so cross-window/portal machinery can find it.
  useEffect(() => {
    if (state.phase !== 'ready') return
    const webview = webviewRef.current
    if (!webview) return
    const onDomReady = (): void => {
      try { portalRegistry.register(panelId, webview as any) } catch { /* ignore */ }
    }
    webview.addEventListener('dom-ready', onDomReady)
    return () => {
      try { portalRegistry.unregister(panelId) } catch { /* ignore */ }
      webview.removeEventListener('dom-ready', onDomReady)
    }
  }, [state.phase, panelId])

  if (state.phase === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-surface-4 text-secondary">
        <PuzzlePiece size={28} className="mb-2 text-muted animate-pulse" />
        <p className="text-xs text-muted">Loading extension…</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-surface-4 text-secondary p-4 text-center">
        <PuzzlePiece size={28} className="mb-2 text-muted" />
        <p className="text-sm font-medium mb-1">Extension unavailable</p>
        <p className="text-xs text-muted whitespace-pre-wrap max-w-md max-h-40 overflow-auto">
          {state.message ?? 'This extension is not enabled or could not be found.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 px-3 py-1 text-xs rounded bg-surface-2 hover:bg-surface-1 text-secondary"
        >
          Retry
        </button>
      </div>
    )
  }

  // src is frozen at the value resolved above (a re-render won't re-navigate).
  // Keyed by panelId + extensionId so a reused slot pointed at a different
  // extension remounts with a fresh webContents. Security-conscious attributes
  // match BrowserPanel: no nodeintegration; per-extension persistent partition.
  // data-filedrop on the wrapper (not an overlay) lets the shared drag tracker
  // find this target; the drop effect above toggles the webview to
  // pointer-events:none during a Cate drag so hit-testing reaches the wrapper.
  return (
    <div
      ref={rootRef}
      className="w-full h-full"
      {...(acceptsDrops ? { 'data-filedrop': 'extension', 'data-filedrop-id': panelId } : {})}
    >
      <webview
        key={`${panelId}:${extensionId}`}
        ref={webviewRef as any}
        src={state.url}
        preload={`file://${state.preloadPath}`}
        className="w-full h-full"
        partition={`persist:ext-${extensionId}`}
      />
    </div>
  )
}
