// =============================================================================
// window.electronAPI for the browser — the web client's stand-in for the whole
// Electron main process. Everything the renderer asks for is served from ONE of:
//
//   - the persistent daemon, over the WS RPC (fs, git, terminals, search,
//     project state stored in the workspace's own .cate/) — the real data path;
//   - localStorage (settings, remote-workspace registry, sidebar session) —
//     device-local UI state;
//   - a typed stub (dialogs, updater, native menus, multi-window, extensions,
//     agents) — desktop-only affordances the web build deliberately drops.
//
// Terminals implement the SAME persistent-session semantics as the desktop
// main process (see src/main/ipc/terminal.ts): create carries attachPtyId so a
// restored panel reattaches to its surviving server-side session, byte cursors
// replay exactly the missed output after a reconnect, and the auto-reconnect
// hook re-subscribes every live terminal.
//
// Unknown methods are Proxy-stubbed (async undefined + one console.debug per
// name) so a renderer path we haven't exercised degrades instead of crashing.
// =============================================================================

import { Buffer } from 'buffer'
import { formatLocator, parseLocator, LOCAL_RUNTIME_ID } from '../main/runtime/locator'
import { DEFAULT_SETTINGS } from '../shared/types'
import type {
  AppSettings,
  RemoteProjectEntry,
  RuntimeConnection,
  WorkspaceInfo,
  ProjectWorkspaceFile,
  ProjectSessionFile,
} from '../shared/types'
import type { RemoteRuntime } from '../main/runtime/RemoteRuntime'
import { WebRuntimeClient, WEB_RUNTIME_ID } from './runtimeClient'
import type { WebConfig } from './config'
import log from '../renderer/lib/logger'

type AnyFn = (...args: never[]) => unknown

// -----------------------------------------------------------------------------
// Event bus (the stand-in for main→renderer IPC broadcasts)
// -----------------------------------------------------------------------------

class Emitter<Args extends unknown[]> {
  private subs = new Set<(...args: Args) => void>()
  subscribe(cb: (...args: Args) => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }
  emit(...args: Args): void {
    for (const cb of this.subs) {
      try { cb(...args) } catch (err) { console.error('[shim] event listener failed', err) }
    }
  }
}

// -----------------------------------------------------------------------------
// The shim
// -----------------------------------------------------------------------------

export function installElectronApiShim(config: WebConfig): { client: WebRuntimeClient } {
  const tokenUrl = new URL(config.wsUrl)
  tokenUrl.searchParams.set('token', config.token)
  const client = new WebRuntimeClient(tokenUrl.toString())

  const rootLocator = formatLocator({ runtimeId: WEB_RUNTIME_ID, path: config.rootPath })
  const connection: RuntimeConnection = {
    kind: 'server',
    runtimeId: WEB_RUNTIME_ID,
    host: config.wsUrl,
    user: '',
    remotePath: config.rootPath,
  } as RuntimeConnection

  // --- events ---------------------------------------------------------------
  const terminalData = new Emitter<[string, string]>()
  const terminalExit = new Emitter<[string, number]>()
  const fsWatchEvent = new Emitter<[{ type: 'create' | 'update' | 'delete'; path: string }]>()
  const searchResult = new Emitter<[{ searchId: string; files: unknown[] }]>()
  const searchDone = new Emitter<[{ searchId: string; stats: unknown; error?: string }]>()
  const runtimeStatus = new Emitter<[{ runtimeId: string; phase: string; message?: string }]>()
  const workspacesChanged = new Emitter<[WorkspaceInfo[]]>()

  client.onPhase((phase, message) => {
    runtimeStatus.emit({ runtimeId: WEB_RUNTIME_ID, phase, message })
  })

  // --- workspaces (in-page registry; the daemon only sees scope ids) --------
  const workspaces = new Map<string, WorkspaceInfo>()

  const replayRoots = async (runtime: RemoteRuntime): Promise<void> => {
    const roots = new Set<string>([config.rootPath])
    const scopes: Array<[string, string]> = [[config.rootPath, WEB_RUNTIME_ID]]
    for (const ws of workspaces.values()) {
      const loc = parseLocator(ws.rootPath)
      if (!loc.path) continue
      roots.add(loc.path)
      scopes.push([loc.path, ws.id], [loc.path, WEB_RUNTIME_ID])
    }
    await Promise.all(scopes.map(([root, scope]) => runtime.addAllowedRoot(root, scope).catch(() => {})))
  }
  client.onConnected(replayRoots)

  // --- terminals (persistent-session layer, mirroring main/ipc/terminal.ts) --
  const termWiring = new Map<string, { onData: (id: string, data: string) => void; onExit: (id: string, code: number) => void }>()
  const termBytes = new Map<string, number>()
  // Restore-attach replay, buffered until the renderer pulls it via
  // terminalLogRead(ptyId) — pushing through the data stream would race the
  // renderer wiring its listeners after terminalCreate resolves.
  const pendingReplays = new Map<string, string>()

  const makeTermWiring = (): { onData: (id: string, data: string) => void; onExit: (id: string, code: number) => void } => ({
    onData: (id, data) => {
      termBytes.set(id, (termBytes.get(id) ?? 0) + Buffer.byteLength(data, 'utf-8'))
      terminalData.emit(id, data)
    },
    onExit: (id, code) => {
      termWiring.delete(id)
      termBytes.delete(id)
      terminalExit.emit(id, code)
    },
  })

  client.onConnected(async (runtime) => {
    // Reattach every live terminal after a reconnect, replaying missed bytes.
    for (const [ptyId, wiring] of [...termWiring]) {
      try {
        const res = await runtime.sessions.attachPty(ptyId, wiring.onData, wiring.onExit, termBytes.get(ptyId) ?? 0)
        if (res.replay) wiring.onData(ptyId, res.replay)
      } catch {
        wiring.onExit(ptyId, 0) // session died while we were away
      }
    }
  })

  // --- settings / small persisted maps --------------------------------------
  const lsJson = <T,>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch { return fallback }
  }
  const lsSet = (key: string, value: unknown): void => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
  }
  const settings = (): AppSettings => ({ ...DEFAULT_SETTINGS, ...lsJson<Partial<AppSettings>>('cate-web-settings', {}) })

  // --- helpers ---------------------------------------------------------------
  const scopeFor = (workspaceId?: string): { scopeId: string } => ({ scopeId: workspaceId && workspaces.has(workspaceId) ? workspaceId : WEB_RUNTIME_ID })
  const hostPath = (p: string): string => parseLocator(p).path || p
  const relocate = (p: string): string => formatLocator({ runtimeId: WEB_RUNTIME_ID, path: p })
  const rt = (): Promise<RemoteRuntime> => client.ready()

  // .cate project-state files, stored IN the workspace on the daemon — the same
  // files the desktop app reads/writes, so canvas layout is shared across
  // devices by construction.
  const cateFile = (root: string, name: string): string => `${hostPath(root).replace(/\/$/, '')}/.cate/${name}`

  const fsWatchUnsubs = new Map<string, () => void>()

  // Default remote-workspace registry entry, used until the first save.
  const seedRemoteEntry = (): RemoteProjectEntry => ({
    locator: rootLocator,
    connection,
    snapshot: {
      workspaceId: `web-${WEB_RUNTIME_ID}`,
      workspaceName: config.name,
      rootPath: rootLocator,
      connection,
    } as RemoteProjectEntry['snapshot'],
  })

  // --- the implemented surface ----------------------------------------------
  const api: Record<string, unknown> = {
    isE2E: false,
    isPerf: false,
    isWeb: true,
    getPlatform: () => 'web',

    // Terminal ---------------------------------------------------------------
    terminalCreate: async (options: { cols: number; rows: number; cwd?: string; shell?: string; workspaceId?: string; panelId?: string; attachPtyId?: string }): Promise<string> => {
      const runtime = await rt()
      const wiring = makeTermWiring()
      if (options.attachPtyId) {
        try {
          const res = await runtime.sessions.attachPty(options.attachPtyId, wiring.onData, wiring.onExit, 0)
          const id = options.attachPtyId
          termWiring.set(id, wiring)
          termBytes.set(id, res.offset)
          if (res.replay) pendingReplays.set(id, res.replay)
          log.info('[web-term] attached %s (pid %d, %d replay bytes)', id, res.info.pid, res.replay.length)
          return id
        } catch (err) {
          log.info('[web-term] attach %s failed (%s); spawning fresh', options.attachPtyId, err instanceof Error ? err.message : String(err))
        }
      }
      const cwd = options.cwd ? hostPath(options.cwd) : ''
      const handle = await runtime.process.create({ cols: options.cols, rows: options.rows, cwd, shell: options.shell }, wiring.onData, wiring.onExit)
      termWiring.set(handle.id, wiring)
      if (handle.notice) wiring.onData(handle.id, handle.notice)
      return handle.id
    },
    terminalWrite: async (id: string, data: string) => { (await rt()).process.write(id, data) },
    terminalResize: async (id: string, cols: number, rows: number) => { (await rt()).process.resize(id, cols, rows) },
    terminalKill: async (id: string) => { (await rt()).process.kill(id) },
    onTerminalData: (cb: (id: string, data: string) => void) => terminalData.subscribe(cb),
    onTerminalExit: (cb: (id: string, code: number) => void) => terminalExit.subscribe(cb),
    terminalGetCwd: async (id: string): Promise<string | null> => {
      const cwd = await (await rt()).process.getCwd(id)
      return cwd == null ? null : relocate(cwd)
    },
    terminalLogRead: async (terminalId: string) => {
      const replay = pendingReplays.get(terminalId)
      if (replay != null) {
        pendingReplays.delete(terminalId)
        return replay
      }
      return null
    },
    terminalScrollbackSave: async () => {},
    terminalSetVisibility: async (id: string, visible: boolean) => { (await rt()).process.setVisibility(id, visible) },
    terminalClipboardWrite: async (text: string) => { await navigator.clipboard.writeText(text).catch(() => {}) },
    webglRequestGrant: async () => true,
    webglReleaseGrant: async () => {},

    // Filesystem ---------------------------------------------------------------
    fsReadFile: async (p: string, workspaceId?: string) => (await rt()).file.readFile(hostPath(p), scopeFor(workspaceId)),
    fsReadBinary: async (p: string, workspaceId?: string): Promise<ArrayBuffer> => {
      const buf = await (await rt()).file.readBinary(hostPath(p), scopeFor(workspaceId))
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    },
    fsWriteFile: async (p: string, content: string, workspaceId?: string) => { await (await rt()).file.writeFile(hostPath(p), content, scopeFor(workspaceId)) },
    fsReadDir: async (p: string, workspaceId?: string) => {
      const nodes = await (await rt()).file.readDir(hostPath(p), scopeFor(workspaceId))
      // Re-encode child paths as locators so every downstream fs call routes back here.
      const encode = (n: { path: string; children?: unknown[] }): unknown => ({ ...n, path: relocate(n.path), children: n.children?.map((c) => encode(c as { path: string })) })
      return nodes.map((n) => encode(n as unknown as { path: string }))
    },
    fsSearch: async (root: string, query: string, options?: unknown, workspaceId?: string) => {
      const results = await (await rt()).file.search(hostPath(root), query, options as never, scopeFor(workspaceId))
      return (results as Array<{ path: string }>).map((r) => ({ ...r, path: relocate(r.path) }))
    },
    fsStat: async (p: string, workspaceId?: string) => (await rt()).file.stat(hostPath(p), scopeFor(workspaceId)),
    fsDelete: async (p: string, workspaceId?: string) => { await (await rt()).file.remove(hostPath(p), scopeFor(workspaceId)) },
    fsRename: async (oldP: string, newP: string, workspaceId?: string) => relocate(await (await rt()).file.rename(hostPath(oldP), hostPath(newP), scopeFor(workspaceId))),
    fsMkdir: async (p: string, workspaceId?: string) => { await (await rt()).file.mkdir(hostPath(p), scopeFor(workspaceId)) },
    fsCopy: async (src: string, destDir: string, workspaceId?: string) => relocate(await (await rt()).file.copy(hostPath(src), hostPath(destDir), scopeFor(workspaceId))),
    fsWatchStart: async (dirPath: string, workspaceId?: string) => {
      const key = hostPath(dirPath)
      if (fsWatchUnsubs.has(key)) return
      const runtime = await rt()
      const unsub = runtime.file.watch(key, (changedPath, type) => {
        fsWatchEvent.emit({ type, path: relocate(changedPath) })
      }, scopeFor(workspaceId))
      fsWatchUnsubs.set(key, unsub)
    },
    fsWatchStop: async (dirPath: string) => {
      const key = hostPath(dirPath)
      fsWatchUnsubs.get(key)?.()
      fsWatchUnsubs.delete(key)
    },
    onFsWatchEvent: (cb: (e: { type: 'create' | 'update' | 'delete'; path: string }) => void) => fsWatchEvent.subscribe(cb),

    // Content search -----------------------------------------------------------
    searchStart: async (rootPath: string, searchId: string, options: unknown, workspaceId?: string): Promise<string> => {
      const runtime = await rt()
      runtime.file.searchContent(hostPath(rootPath), options as never, {
        onBatch: (files) => searchResult.emit({ searchId, files: (files as Array<{ path: string }>).map((f) => ({ ...f, path: relocate(f.path) })) }),
        onDone: (stats, error) => searchDone.emit({ searchId, stats, error }),
      }, scopeFor(workspaceId))
      return searchId
    },
    searchCancel: async () => { /* per-search cancel not wired in web v1 */ },
    onSearchResult: (cb: (b: { searchId: string; files: unknown[] }) => void) => searchResult.subscribe(cb),
    onSearchDone: (cb: (e: { searchId: string; stats: unknown; error?: string }) => void) => searchDone.subscribe(cb),

    // Git ----------------------------------------------------------------------
    gitIsRepo: async (dir: string, wsId: string) => (await rt()).vcs.isRepo(hostPath(dir), scopeFor(wsId)),
    gitFindRepos: async (dir: string, maxDepth: number | undefined, wsId: string) => ((await (await rt()).vcs.findRepos(hostPath(dir), maxDepth, scopeFor(wsId))) as string[]).map(relocate),
    gitInit: async (dir: string, wsId: string) => (await rt()).vcs.init(hostPath(dir), scopeFor(wsId)),
    gitLsFiles: async (dir: string, wsId: string) => (await rt()).vcs.lsFiles(hostPath(dir), scopeFor(wsId)),
    gitStatus: async (cwd: string, wsId: string) => (await rt()).vcs.status(hostPath(cwd), scopeFor(wsId)),
    gitDiff: async (cwd: string, filePath: string | undefined, wsId: string) => (await rt()).vcs.diff(hostPath(cwd), filePath, scopeFor(wsId)),
    gitDiffStaged: async (cwd: string, filePath: string | undefined, wsId: string) => (await rt()).vcs.diffStaged(hostPath(cwd), filePath, scopeFor(wsId)),
    gitStage: async (cwd: string, filePath: string, wsId: string) => (await rt()).vcs.stage(hostPath(cwd), filePath, scopeFor(wsId)),
    gitUnstage: async (cwd: string, filePath: string, wsId: string) => (await rt()).vcs.unstage(hostPath(cwd), filePath, scopeFor(wsId)),
    gitCommit: async (cwd: string, message: string, wsId: string) => (await rt()).vcs.commit(hostPath(cwd), message, scopeFor(wsId)),
    gitPush: async (cwd: string, remote: string | undefined, branch: string | undefined, wsId: string) => (await rt()).vcs.push(hostPath(cwd), remote, branch, scopeFor(wsId)),
    gitPull: async (cwd: string, remote: string | undefined, branch: string | undefined, wsId: string) => (await rt()).vcs.pull(hostPath(cwd), remote, branch, scopeFor(wsId)),
    gitFetch: async (cwd: string, remote: string | undefined, wsId: string) => (await rt()).vcs.fetch(hostPath(cwd), remote, scopeFor(wsId)),
    gitLog: async (cwd: string, maxCount: number | undefined, wsId: string) => (await rt()).vcs.log(hostPath(cwd), maxCount, scopeFor(wsId)),
    gitBranchList: async (cwd: string, wsId: string) => (await rt()).vcs.branchList(hostPath(cwd), scopeFor(wsId)),
    gitBranchCreate: async (cwd: string, name: string, startPoint: string | undefined, wsId: string) => (await rt()).vcs.branchCreate(hostPath(cwd), name, startPoint, scopeFor(wsId)),
    gitBranchDelete: async (cwd: string, name: string, force: boolean | undefined, wsId: string) => (await rt()).vcs.branchDelete(hostPath(cwd), name, force, scopeFor(wsId)),
    gitCheckout: async (cwd: string, branch: string, wsId: string) => (await rt()).vcs.checkout(hostPath(cwd), branch, scopeFor(wsId)),
    gitStash: async (cwd: string, message: string | undefined, wsId: string) => (await rt()).vcs.stash(hostPath(cwd), message, scopeFor(wsId)),
    gitStashPop: async (cwd: string, wsId: string) => (await rt()).vcs.stashPop(hostPath(cwd), scopeFor(wsId)),
    gitDiscardFile: async (cwd: string, filePath: string, wsId: string) => (await rt()).vcs.discardFile(hostPath(cwd), filePath, scopeFor(wsId)),
    gitWorktreeList: async (cwd: string, wsId: string) => (await rt()).vcs.worktreeList(hostPath(cwd), scopeFor(wsId)),
    gitWorktreeStatus: async (worktreePath: string, wsId: string) => (await rt()).vcs.worktreeStatus(hostPath(worktreePath), scopeFor(wsId)),
    gitPrList: async () => [],
    gitMonitorStart: () => {},
    gitMonitorStop: () => {},

    // Settings -----------------------------------------------------------------
    settingsGet: async <K extends keyof AppSettings>(key: K) => settings()[key],
    settingsGetAll: async () => settings(),
    settingsSet: async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const merged = { ...lsJson<Partial<AppSettings>>('cate-web-settings', {}), [key]: value }
      lsSet('cate-web-settings', merged)
    },

    // Project / session persistence -------------------------------------------
    recentProjectsGet: async () => [],
    recentProjectsAdd: async () => {},
    recentProjectsRemove: async () => {},
    remoteProjectsGet: async (): Promise<RemoteProjectEntry[]> => {
      const entries = lsJson<RemoteProjectEntry[]>('cate-web-remote-projects', [])
      return entries.length ? entries : [seedRemoteEntry()]
    },
    remoteProjectsSet: async (entries: RemoteProjectEntry[]) => { lsSet('cate-web-remote-projects', entries) },
    projectStateSave: async (rootPath: string, workspace: ProjectWorkspaceFile, session: ProjectSessionFile) => {
      const runtime = await rt()
      const scope = { scopeId: WEB_RUNTIME_ID }
      await runtime.file.mkdir(cateFile(rootPath, ''), scope).catch(() => {})
      await runtime.file.writeFile(cateFile(rootPath, 'workspace.json'), JSON.stringify(workspace, null, 2), scope)
      await runtime.file.writeFile(cateFile(rootPath, 'session.json'), JSON.stringify(session, null, 2), scope)
    },
    projectStateLoad: async (rootPath: string) => {
      const runtime = await rt()
      const scope = { scopeId: WEB_RUNTIME_ID }
      try {
        const workspace = JSON.parse(await runtime.file.readFile(cateFile(rootPath, 'workspace.json'), scope)) as ProjectWorkspaceFile
        let session: ProjectSessionFile | null = null
        try { session = JSON.parse(await runtime.file.readFile(cateFile(rootPath, 'session.json'), scope)) as ProjectSessionFile } catch { /* absent */ }
        return { workspace, session }
      } catch {
        return null
      }
    },
    sessionFlushSaveDone: () => {},
    onSessionFlushSave: () => () => {},

    // Workspaces ---------------------------------------------------------------
    workspaceCreate: async (options?: { name?: string; rootPath?: string; id?: string; connection?: RuntimeConnection }) => {
      const id = options?.id ?? `web-ws-${Math.random().toString(36).slice(2, 10)}`
      const ws: WorkspaceInfo = {
        id,
        name: options?.name ?? config.name,
        color: '#8b5cf6',
        rootPath: options?.rootPath ?? rootLocator,
        connection: options?.connection ?? connection,
      }
      workspaces.set(id, ws)
      const runtime = client.runtime
      if (runtime) {
        const loc = parseLocator(ws.rootPath)
        if (loc.path) {
          await runtime.addAllowedRoot(loc.path, id).catch(() => {})
          await runtime.addAllowedRoot(loc.path, WEB_RUNTIME_ID).catch(() => {})
        }
      }
      workspacesChanged.emit([...workspaces.values()])
      return { ok: true, workspace: ws }
    },
    workspaceUpdate: async (id: string, changes: Partial<WorkspaceInfo>) => {
      const existing = workspaces.get(id)
      if (!existing) return { ok: false, error: 'not-found' }
      const next = { ...existing, ...changes, id }
      workspaces.set(id, next)
      workspacesChanged.emit([...workspaces.values()])
      return { ok: true, workspace: next }
    },
    workspaceRemove: async (id: string) => { workspaces.delete(id); workspacesChanged.emit([...workspaces.values()]); return { ok: true } },
    onWorkspacesChanged: (cb: (ws: WorkspaceInfo[]) => void) => workspacesChanged.subscribe(cb),

    // Runtime ------------------------------------------------------------------
    runtimeEnsure: async (conn: RuntimeConnection) => {
      await rt()
      runtimeStatus.emit({ runtimeId: WEB_RUNTIME_ID, phase: 'connected' })
      const remotePath = conn.kind === 'server' ? conn.remotePath : config.rootPath
      return { ok: true, runtimeId: WEB_RUNTIME_ID, rootPath: formatLocator({ runtimeId: WEB_RUNTIME_ID, path: remotePath }), connection: conn }
    },
    runtimeInstall: async () => ({ ok: false, error: 'The persistent runtime is provisioned on the host itself.' }),
    runtimeConnect: async () => ({ ok: false, error: 'The web client is pinned to its configured runtime.' }),
    onRuntimeStatus: (cb: (e: { runtimeId: string; phase: string; message?: string }) => void) => {
      const unsub = runtimeStatus.subscribe(cb)
      // Replay the current phase: the WS usually connects before the renderer
      // subscribes, and a subscriber that missed the transition would show
      // "Connecting…" forever.
      queueMicrotask(() => {
        if (client.runtime) cb({ runtimeId: WEB_RUNTIME_ID, phase: 'connected' })
      })
      return unsub
    },
    runtimeList: async () => (client.runtime ? [WEB_RUNTIME_ID] : []),
    runtimeSshHosts: async () => [],
    runtimeWslDistros: async () => [],

    // Misc UI affordances ------------------------------------------------------
    sidebarSessionGet: async () => lsJson('cate-web-sidebar', null),
    sidebarSessionSet: async (session: unknown) => { lsSet('cate-web-sidebar', session) },
    openExternalUrl: async (url: string) => { window.open(url, '_blank', 'noopener') },
    windowSetTitle: async (title: string) => { document.title = title },
    isMainWindowFullscreen: async () => false,
    isWindowMaximized: async () => false,
    getAppMenuBarItems: async () => [],
    showContextMenu: async () => null,
    uiStateGet: async () => lsJson('cate-web-uistate', null),
    uiStateSet: async (state: unknown) => { lsSet('cate-web-uistate', state) },
  }

  // Shaped defaults for stubs whose callers destructure/iterate the result.
  const stubShapes: Record<string, unknown> = {
    dockWindowsList: [],
    windowPanelsList: [],
    browserHistoryGet: [],
    browserBookmarksGet: [],
    extensionsList: [],
    skillsList: [],
    skillsListSaved: [],
    skillsListInstalled: [],
    agentSessionsList: [],
    agentModelsList: [],
    agentSlashCommands: [],
    authProvidersList: [],
    authStatus: [],
    perfGetSnapshot: null,
    uiStateGetAll: {},
    updateGetStatus: { state: 'idle', version: null },
    getUpdateStatus: { state: 'idle', version: null },
    listSshHosts: [],
    layoutList: [],
    extensionList: [],
    getPendingFeedback: null,
    runtimeLocalStatus: { phase: 'connected' },
    getAppMenuBarItems: [],
  }

  const warned = new Set<string>()
  const proxy = new Proxy(api, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (typeof prop !== 'string') return undefined
      // on* subscription → no-op unsubscriber; everything else → async stub.
      const fn: AnyFn = prop.startsWith('on')
        ? () => () => {}
        : () => Promise.resolve(prop in stubShapes ? stubShapes[prop] : undefined)
      if (!warned.has(prop)) {
        warned.add(prop)
        console.debug(`[shim] stubbed electronAPI.${prop}`)
      }
      target[prop] = fn
      return fn
    },
  })

  ;(window as unknown as { electronAPI: unknown }).electronAPI = proxy
  ;(window as unknown as { __cateWeb: unknown }).__cateWeb = { client, config }
  return { client }
}
